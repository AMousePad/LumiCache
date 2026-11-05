import type { LlmMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { Guard } from "./guard";
import { connectionDispatch } from "./host-context";
import { errorText, type Settings } from "./shared";

export const CAT_EXTENSION = "another_one";
const REQUEST = `${CAT_EXTENSION}.cache_request`;
const POLICY = { requires: ["generation"] };
const REVIEW_LIMIT_MS = 295_000;

interface CatCheck { op: "check"; id: string; userId: string; chatId: string; slotId: string; label: string; connectionId: string; model: string; session?: string; messages: LlmMessageDTO[] }
interface CatFinish { op: "finish"; id: string; userId: string; success: boolean }
interface CatCancel { op: "cancel"; id: string }
type CatRequest = CatCheck | CatFinish | CatCancel;
type Api = Pick<SpindleAPI, "rpcPool" | "connections">;

/** CAT streams through generate.rawStream, which skips the interceptor, so it hands prompts over here. */
export class CatBridge {
  private queue: CatRequest[] = [];
  private controllers = new Map<string, AbortController>();
  private lastBySlot = new Map<string, string>();
  constructor(private api: Api, private guard: Guard, private settings: (user: string) => Promise<Settings>,
    private epoch: (user: string, chatId: string) => Promise<string | null>) {}
  register(drainMs = 50) {
    this.api.rpcPool.handle("cat", async ctx => {
      if (ctx.requesterExtensionId !== CAT_EXTENSION) throw new Error("Unauthorized LumiCache caller.");
      const request = await this.api.rpcPool.read<CatRequest | null>(REQUEST);
      if (!request || typeof request !== "object") throw new Error("Invalid CAT cache request.");
      this.queue.push(request);
      return { accepted: true };
    }, POLICY);
    // A timer registered here runs outside the RPC permission scope, so work can outlive the handler.
    const timer = setInterval(() => this.drain(), drainMs) as unknown as { unref?: () => void };
    timer.unref?.();
    return this;
  }
  drain() {
    for (const request of this.queue.splice(0)) {
      if (request.op === "check") void this.check(request);
      else if (request.op === "cancel") this.controllers.get(request.id)?.abort();
      else this.finish(request);
    }
  }
  private generation(id: string) { return `cat:${id}`; }
  private publish(id: string, value: unknown) { this.api.rpcPool.sync(`cat_result.${id}`, value, POLICY); }
  private async check(request: CatCheck) {
    const controller = new AbortController();
    this.controllers.set(request.id, controller);
    try {
      const settings = await this.settings(request.userId);
      const slot = JSON.stringify([request.userId, request.chatId, request.slotId]);
      // A swipe that never reported back, such as after a CAT restart, must not block its profile.
      const previous = this.lastBySlot.get(slot);
      if (previous) this.guard.finish(request.userId, this.generation(previous), false);
      this.lastBySlot.set(slot, request.id);
      const messages = await this.guard.inspect(request.messages, {
        userId: request.userId, chatId: request.chatId, generationId: this.generation(request.id), frontendSessionId: request.session,
        isDryRun: false, signal: controller.signal, interceptorDeadlineAt: Date.now() + REVIEW_LIMIT_MS,
        mainDispatch: await connectionDispatch(this.api, request.connectionId, request.userId, request.model),
        scope: request.slotId, label: request.label,
      }, settings, await this.epoch(request.userId, request.chatId));
      this.publish(request.id, { status: "done", messages });
    } catch (error) {
      this.publish(request.id, { status: "error", error: errorText(error) });
    } finally { this.controllers.delete(request.id); }
  }
  private finish(request: CatFinish) {
    this.guard.finish(request.userId, this.generation(request.id), request.success);
    this.api.rpcPool.unregister(`cat_result.${request.id}`);
  }
}
