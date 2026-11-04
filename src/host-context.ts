import type { GenerationStartedPayloadDTO, InterceptorContextDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { InspectionContext } from "./shared";

interface Started extends GenerationStartedPayloadDTO { frontendSessionId?: string }
// Current native assembly carries dryRun/connectionId; generation identity arrives in the lifecycle event.
export type HostContext = Partial<InterceptorContextDTO> & { userId: string; chatId: string; signal: AbortSignal; dryRun?: boolean; connectionId?: string };
export async function connectionDispatch(api: Pick<SpindleAPI, "connections">, connectionId: string | undefined, userId: string, model: string): Promise<InspectionContext["mainDispatch"]> {
  const connection = connectionId ? await api.connections.get(connectionId, userId)
    : (await api.connections.list(userId)).find(connection => connection.is_default);
  if (!connection) throw new Error("LumiCache could not inspect the selected connection.");
  let origin = "Provider default endpoint";
  if (connection.api_url) {
    try { origin = new URL(connection.api_url).origin; }
    catch { throw new Error("LumiCache could not read the selected connection endpoint."); }
  }
  const revision = `${connection.id}:${connection.updated_at}`;
  return { descriptor: { connectionId: connection.id, provider: connection.provider, model, endpointOrigin: origin, connectionDispatchRevision: revision }, connectionDispatchRevision: revision, dispatchKind: "concrete" };
}
export class HostContexts {
  private active = new Map<string, Started>();
  private key(user: string, chat: string) { return JSON.stringify([user, chat]); }
  start(user: string, event: Started) { this.active.set(this.key(user, event.chatId), event); }
  isActive(user: string, chat: string) { return this.active.has(this.key(user, chat)); }
  finish(user: string, event: { chatId: string; generationId: string }) {
    const key = this.key(user, event.chatId);
    if (this.active.get(key)?.generationId === event.generationId) this.active.delete(key);
  }
  async resolve(raw: HostContext, api: Pick<SpindleAPI, "connections">): Promise<InspectionContext> {
    const started = this.active.get(this.key(raw.userId, raw.chatId));
    if (!started || (raw.generationId && raw.generationId !== started.generationId)) throw new Error("LumiCache could not match this prompt to its live generation. Stop and retry the request.");
    const dispatch = raw.mainDispatch ?? await connectionDispatch(api, raw.connectionId, raw.userId, started.model);
    raw.signal.throwIfAborted();
    if (this.active.get(this.key(raw.userId, raw.chatId)) !== started) throw new Error("The generation ended while LumiCache was preparing its check.");
    return { userId: raw.userId, chatId: raw.chatId, generationId: started.generationId, frontendSessionId: raw.frontendSessionId ?? started.frontendSessionId,
      isDryRun: raw.isDryRun === true || raw.dryRun === true, signal: raw.signal,
      interceptorDeadlineAt: raw.interceptorDeadlineAt ?? Date.now() + 295_000, mainDispatch: dispatch };
  }
}
