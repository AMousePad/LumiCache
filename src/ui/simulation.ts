import type { AuditInput, SimulationReport, SimulationTicket } from "../health/types";
import { BackendReplyError, type Bridge } from "./bridge";
import { simulationCopy } from "../health/copy";
import { readComposition } from "./composition";

export type NativeAPI = (path: string, method?: string, body?: unknown, allow404?: boolean, timeout?: number) => Promise<any>;
// Copying the chat moves all of it through the browser, which is slow on long chats and remote connections.
const TRANSFER_MS = 600_000;
export async function nativeAPI(path: string, method = "GET", body?: unknown, allow404 = false, timeout = 60_000): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/${path}`, { method, credentials: "same-origin", headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    if ((error as { name?: string })?.name !== "TimeoutError") throw error;
    throw new Error(`Lumiverse did not answer ${method} ${path.split("/")[0]} within ${Math.round(timeout / 1000)} seconds. Your chat was not changed.`);
  }
  if (response.status === 404 && allow404) return null;
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Lumiverse returned ${response.status}.`);
  return value;
}
export async function simulate(bridge: Pick<Bridge, "call">, input: AuditInput & { agentJobId?: string }, prepared: (ticket: SimulationTicket) => void,
  api: NativeAPI = nativeAPI): Promise<SimulationReport> {
  const ticket = await bridge.call("prepareSimulation", { ...input, composition: input.composition ?? await readComposition(api) }); prepared(ticket);
  let scratchId: string | undefined, report: SimulationReport | undefined, primaryError: unknown;
  let profileCopied = false, submitted = false;
  try {
    const profile = await api(`preset-profiles/chat/${encodeURIComponent(input.chatId)}`, "GET", undefined, true);
    if (ticket.copy === "branch") {
      // Lumiverse copies the chat itself, so nothing large crosses the connection.
      const branch = await api(`chats/${encodeURIComponent(input.chatId)}/branch`, "POST", { message_id: ticket.lastMessageId, name: ticket.branchName });
      if (typeof branch?.id === "string" && branch.id !== input.chatId) scratchId = branch.id;
      if (!scratchId || branch.name !== ticket.branchName || branch.metadata?.branched_from !== input.chatId)
        throw new Error("Lumiverse returned an unexpected simulation copy. The source chat was not modified.");
    } else {
      const source = await api(`chats/${encodeURIComponent(input.chatId)}/export`, "GET", undefined, false, TRANSFER_MS);
      const copy = simulationCopy(source, ticket);
      if (JSON.stringify(copy).length > 64_000_000) throw new Error("The conversation is too large to copy for this simulation (64 million characters). Cache health checks are still available.");
      const imported = await api("chats/import", "POST", copy, false, TRANSFER_MS);
      if (typeof imported.chat_id !== "string" || imported.chat_id === input.chatId || imported.name !== ticket.branchName)
        throw new Error("Lumiverse returned an unexpected simulation copy. The source chat was not modified.");
      scratchId = imported.chat_id;
    }
    if (profile) {
      profileCopied = true;
      await api(`preset-profiles/chat/${encodeURIComponent(scratchId!)}`, "PUT", { preset_id: profile.preset_id, block_states: profile.block_states,
        prompt_variables: profile.prompt_variables, linked_to_defaults: profile.linked_to_defaults });
    }
    submitted = true;
    report = await bridge.call("simulate", { id: ticket.id, scratchChatId: scratchId! });
  } catch (error) { primaryError = error; if (error instanceof BackendReplyError) submitted = false; }
  finally {
    const cleanupErrors: string[] = [];
    // Once submitted, the backend owns branch cleanup even if this browser disconnects or times out.
    if (scratchId && !submitted && ticket.copy === "import") {
      try { await api(`chats/${encodeURIComponent(scratchId)}`, "DELETE", undefined, true); }
      catch { cleanupErrors.push(`The temporary branch ${scratchId} could not be removed.`); }
    }
    if (scratchId && profileCopied && (!submitted || report)) {
      try { await api(`preset-profiles/chat/${encodeURIComponent(scratchId)}`, "DELETE", undefined, true); }
      catch { cleanupErrors.push(`The simulation's temporary preset profile ${scratchId} could not be removed.`); }
    }
    if (!submitted && ticket.copy === "branch" && scratchId) {
      try { await bridge.call("cancelSimulation", { id: ticket.id, scratchChatId: scratchId }); }
      catch (error) { cleanupErrors.push(`The temporary branch ${scratchId} could not be removed: ${error instanceof Error ? error.message : String(error)}`); }
    } else if (!submitted) {
      try { await bridge.call("cancelSimulation", { id: ticket.id }); } catch { /* The preparation ticket may have expired already. */ }
    }
    if (cleanupErrors.length) {
      if (report) { report.cleanupError = [report.cleanupError, ...cleanupErrors].filter(Boolean).join("\n"); report.scratchChatId = scratchId; }
      else primaryError = new Error(`${primaryError instanceof Error ? primaryError.message : "Simulation failed."}\n${cleanupErrors.join("\n")}`);
    }
  }
  if (primaryError) throw primaryError;
  return report!;
}
