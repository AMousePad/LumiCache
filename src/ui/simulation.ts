import type { AuditInput, SimulationReport, SimulationTicket } from "../health/types";
import { BackendReplyError, type Bridge } from "./bridge";
import { simulationCopy } from "../health/copy";
import { readComposition } from "./composition";

export type NativeAPI = (path: string, method?: string, body?: unknown, allow404?: boolean) => Promise<any>;
export async function nativeAPI(path: string, method = "GET", body?: unknown, allow404 = false): Promise<any> {
  const response = await fetch(`/api/v1/${path}`, { method, credentials: "same-origin", headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
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
    const source = await api(`chats/${encodeURIComponent(input.chatId)}/export`);
    const copy = simulationCopy(source, ticket);
    if (JSON.stringify(copy).length > 64_000_000) throw new Error("The conversation is too large to copy for this simulation (64 million characters). Cache health checks are still available.");
    const branch = await api("chats/import", "POST", copy);
    if (typeof branch.chat_id !== "string" || branch.chat_id === input.chatId || branch.name !== ticket.branchName)
      throw new Error("Lumiverse returned an unexpected simulation copy. The source chat was not modified.");
    scratchId = branch.chat_id;
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
    if (scratchId && !submitted) {
      try { await api(`chats/${encodeURIComponent(scratchId)}`, "DELETE", undefined, true); }
      catch { cleanupErrors.push(`The temporary branch ${scratchId} could not be removed.`); }
    }
    if (scratchId && profileCopied && (!submitted || report)) {
      try { await api(`preset-profiles/chat/${encodeURIComponent(scratchId)}`, "DELETE", undefined, true); }
      catch { cleanupErrors.push(`The simulation's temporary preset profile ${scratchId} could not be removed.`); }
    }
    if (!submitted) {
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
