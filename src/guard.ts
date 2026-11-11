import { buildTimeline, promptOutline } from "./health/timeline";
import type { BaselinePersistence } from "./baseline";
import type { CacheUsage } from "./health/types";
import type { LlmMessageDTO } from "lumiverse-spindle-types";
import { compare, snapshot } from "./compare";
import type { Check, InspectionContext, Settings, Snapshot } from "./shared";
import { validateSettings } from "./settings";
import { historyMessage, preserve, retain, tailStart, type TokenCounter } from "./consistency";
import { uuid } from "./uuid";

interface ChatState { releasedThrough?: number; restored?: boolean; baseline: Snapshot | null; check: Check | null; busy: boolean; retained?: ReturnType<typeof retain>; candidate?: ReturnType<typeof retain>; replies: number; epoch?: string | null; connection?: string; cached?: number }
/** Providers round their counts and cache on a best-effort basis, so a drop this small says nothing. */
const MISS_TOKENS = 1024, MISS_SHARE = 0.05, MAX_RELEASED_CHATS = 256, MAX_RELEASED_MESSAGES = 256;
interface Pending {
  userId: string; session?: string; check: Check;
  settle(allow: boolean, reason?: string): void;
}
export class Guard {
  private chats = new Map<string, ChatState>();
  private pending = new Map<string, Pending>();
  private candidates = new Map<string, { key: string; userId: string; check: Check; retained: ReturnType<typeof retain>; refresh: boolean; epoch: string | null; connection?: string; alarming: boolean; releasedThrough: number }>();
  private released = new Map<string, Map<string, number>>();
  private releaseCount = 0;
  constructor(private onChange: (user: string, chatId: string, session?: string) => void, private countTokens?: TokenCounter,
    private store?: BaselinePersistence, private toast?: (user: string, tone: "warning" | "success", title: string, message: string) => void) {}
  /** Runs beside the send, since a slow token count should not delay it. */
  private async toastBreak(messages: LlmMessageDTO[], check: Check, context: InspectionContext, tone: "warning" | "success", title: (depth: number) => string, message: (tokens: string) => string) {
    if (!this.toast) return;
    // A prompt that only lost its end breaks at its new end.
    const first = Math.max(0, Math.min(check.comparison.firstMessage ?? 0, messages.length - 1));
    let tokens = Math.ceil(check.after.messages.slice(first).reduce((total, message) => total + message.body.length, 0) / 4), approximate = true;
    if (this.countTokens) {
      try { const counted = await this.countTokens(messages.slice(first), context); if (Number.isFinite(counted.total_tokens)) { tokens = counted.total_tokens; approximate = counted.approximate; } }
      catch { /* The estimate above still answers how much is at stake. */ }
    }
    const who = context.label ? `${context.label}: ` : "";
    try { this.toast(context.userId, tone, `${who}${title(messages.length - first)}`, message(`${approximate ? "~" : ""}${tokens.toLocaleString("en-US")}`)); }
    catch (error) { console.warn("[LumiCache] Could not show the cache toast:", error); }
  }
  private notify(user: string, chatId: string, session?: string) {
    // UI delivery must never control a backend generation or its baseline.
    try { this.onChange(user, chatId, session); } catch { /* The next load reads the retained state. */ }
  }
  disconnect(user: string, session: string) {
    for (const pending of this.pending.values()) {
      if (pending.userId !== user || pending.session !== session) continue;
      pending.session = undefined;
      this.notify(user, pending.check.chatId);
    }
  }
  private chatStates(user: string, chat: string): [string, ChatState][] {
    return [...this.chats].filter(([key]) => { const [owner, id] = JSON.parse(key) as string[]; return owner === user && id === chat; });
  }
  /** The waiting review wins, otherwise the most recently inspected sender. */
  private shown(user: string, chat: string): ChatState | undefined {
    const states = this.chatStates(user, chat).map(([, state]) => state);
    return states.find(state => state.check && this.pending.has(state.check.id)) ?? states.at(-1);
  }
  resume(user: string, chat: string, session: string) {
    const check = this.shown(user, chat)?.check;
    const pending = check && this.pending.get(check.id);
    // Only the authenticated browser load path may claim an orphaned review.
    if (pending && pending.userId === user && !pending.session && Date.now() < pending.check.deadline) pending.session = session;
  }
  private reserve(current: ChatState, next: Check) {
    const retained = () => {
      const snapshots = new Set<Snapshot>();
      for (const state of this.chats.values()) {
        const check = state === current ? next : state.check;
        for (const value of [state.baseline, check?.before, check?.after]) if (value) snapshots.add(value);
      }
      let size = 0;
      for (const value of snapshots) for (const message of value.messages) size += message.header.length + message.body.length;
      for (const state of this.chats.values()) size += (state.retained?.size ?? 0) + (state.candidate?.size ?? 0);
      return size;
    };
    while (retained() > 256_000_000) {
      const oldest = [...this.chats].find(([, state]) => state !== current && !state.busy);
      if (!oldest) throw new Error("LumiCache's active prompt memory is full. Finish or stop another generation before retrying.");
      this.chats.delete(oldest[0]);
    }
  }
  private key(user: string, chat: string, scope?: string) { return JSON.stringify(scope ? [user, chat, scope] : [user, chat]); }
  private state(user: string, chat: string, scope?: string): ChatState {
    const key = this.key(user, chat, scope);
    let state = this.chats.get(key);
    if (!state) {
      if (this.chats.size >= 48) {
        const oldest = [...this.chats].find(([, value]) => !value.busy);
        if (!oldest) throw new Error("LumiCache is inspecting too many chats. Finish a pending generation first.");
        this.chats.delete(oldest[0]);
      }
      state = { baseline: null, check: null, busy: false, replies: 0 };
    }
    this.chats.delete(key); this.chats.set(key, state);
    return state;
  }
  chatIds(user: string): string[] { return [...this.chats.keys()].map(key => JSON.parse(key) as string[]).filter(([owner]) => owner === user).map(([, chat]) => chat).filter((chat, index, all) => all.indexOf(chat) === index); }
  view(user: string, chat?: string, session?: string) {
    const state = chat ? this.shown(user, chat) : undefined;
    const pending = state?.check ? this.pending.get(state.check.id) : undefined;
    return { check: state?.check ?? null, hasBaseline: !!state?.baseline, canDecide: !!pending && !!session && pending.session === session };
  }
  /** With monitoring off, replies can pass unseen. The saved file's check then decides if this baseline still holds. */
  unwatched(user: string, chat: string) {
    const state = this.chats.get(this.key(user, chat));
    if (state && !state.busy) { state.baseline = null; state.retained = undefined; state.restored = false; state.replies = 0; }
  }
  /** Every sender of this chat, such as a CAT slot, sends the message's current text once. */
  release(user: string, chat: string, messageId: string) {
    const key = this.key(user, chat), ids = this.released.get(key) ?? new Map<string, number>();
    ids.delete(messageId); ids.set(messageId, ++this.releaseCount);
    if (ids.size > MAX_RELEASED_MESSAGES) ids.delete(ids.keys().next().value!);
    this.released.delete(key); this.released.set(key, ids);
    if (this.released.size > MAX_RELEASED_CHATS) this.released.delete(this.released.keys().next().value!);
  }
  private releasedFor(user: string, chat: string, state: ChatState) {
    const through = state.releasedThrough ?? 0;
    return new Set([...this.released.get(this.key(user, chat)) ?? []].filter(([, count]) => count > through).map(([id]) => id));
  }
  forget(user: string, chat: string) { this.released.delete(this.key(user, chat)); this.store?.clear(user, chat); }
  clear(user: string, chat: string) {
    const states = this.chatStates(user, chat);
    if (states.some(([, state]) => state.busy)) throw new Error("Finish or stop this generation before clearing its baseline.");
    for (const [key] of states) this.chats.delete(key);
    this.store?.clear(user, chat);
    this.notify(user, chat);
  }
  decide(user: string, session: string | undefined, id: string, allow: boolean) {
    const pending = this.pending.get(id);
    if (!pending || !session || pending.userId !== user || pending.session !== session) throw new Error("This review expired or belongs to another browser session.");
    pending.settle(allow);
  }
  /** A changed epoch is a break another extension planned, so it replaces the timed refresh. */
  async inspect(messages: LlmMessageDTO[], context: InspectionContext, settings: Settings, epoch: string | null = null): Promise<LlmMessageDTO[]> {
    if (context.isDryRun || settings.mode === "off") return messages;
    context.signal.throwIfAborted();
    const state = this.state(context.userId, context.chatId, context.scope);
    if (state.busy) throw new Error("LumiCache is already inspecting a generation in this chat. Wait for it to finish or stop it first.");
    state.busy = true;
    let check: Check | undefined;
    try {
    const config = validateSettings(settings);
    if (this.store && !state.restored) {
      state.restored = true;
      try {
        const saved = await this.store.load(context.userId, context.chatId, context.scope);
        if (saved && !state.baseline) {
          state.baseline = { ...snapshot(saved.messages, context), at: saved.at, route: saved.route, model: saved.model };
          state.retained = retain(saved.messages); state.replies = saved.replies; state.epoch = saved.epoch;
        }
      } catch (error) { console.warn("[LumiCache] Could not read the saved baseline:", error); }
      context.signal.throwIfAborted();
    }
    const releasedThrough = this.releaseCount;
    const incoming = snapshot(messages, context);
    const epochChanged = epoch !== (state.epoch ?? null);
    const planned = !!state.baseline && epoch !== null && epochChanged;
    const refresh = !!state.baseline && (epochChanged || epoch === null && config.forceConsistency && config.refreshEnabled && state.replies >= config.refreshEvery);
    const routeChanged = !!state.baseline && state.baseline.route !== incoming.route;
    let policy: Check["policy"];
    if (refresh && !routeChanged) policy = { action: "refresh", restored: 0, relocated: 0, replies: state.replies, approximate: false };
    else if (config.forceConsistency && !routeChanged) {
      const result = await preserve(state.retained?.messages ?? null, messages, config, context, this.countTokens, this.releasedFor(context.userId, context.chatId, state));
      messages = result.messages;
      policy = { action: state.retained ? "preserved" : "seed", restored: result.restored, relocated: result.relocated, replies: state.replies, approximate: result.approximate };
    }
    const checkId = await uuid();
    context.signal.throwIfAborted();
    const after = snapshot(messages, context);
    check = { id: checkId, chatId: context.chatId, generationId: context.generationId,
      deadline: Math.min(Date.now() + 290_000, context.interceptorDeadlineAt - 1000), status: "allowed",
      comparison: compare(state.baseline, after), before: state.baseline, after, policy };
    if (context.label) check.comparison.summary = `${context.label}: ${check.comparison.summary}`;
    let tolerated = false;
    // Everything before the first change is identical, so any change from the tail onward is allowed: edits, swipes and deletions included.
    if (check.comparison.kind === "break" && !routeChanged && state.retained?.messages.some(historyMessage)) {
      const boundary = await tailStart(state.retained.messages, config, context, this.countTokens);
      tolerated = check.comparison.firstMessage !== null && check.comparison.firstMessage >= boundary.index;
      if (tolerated && !policy) check.policy = { action: "tolerated", restored: 0, relocated: 0, replies: state.replies, approximate: boundary.approximate };
    }
    // The inspector is a view of the comparison, so a failure here must never block the send.
    if (state.baseline) {
      try { check.timeline = buildTimeline(state.baseline, promptOutline(state.baseline, state.retained?.messages ?? [], []), after, promptOutline(after, messages, []), check.comparison, tolerated); }
      catch (error) { console.warn("[LumiCache] Could not build the live timeline:", error); }
    }
    const retained = retain(messages); state.candidate = retained;
    if (check.policy) check.policy.accepted = tolerated || (refresh && !routeChanged) || check.comparison.kind !== "break";
    this.reserve(state, check);
    state.check = check;
      const alarming = check.comparison.kind === "break" && !tolerated && !(refresh && !routeChanged);
      if (alarming && settings.mode === "pause") {
        check.status = "waiting";
        const review = check;
        await new Promise<void>((resolve, reject) => {
          const settle = (allow: boolean, reason?: string) => {
            clearTimeout(timer); context.signal.removeEventListener("abort", abort);
            this.pending.delete(review.id);
            if (allow && !context.signal.aborted && Date.now() < review.deadline) resolve();
            else reject(new Error(reason ?? "LumiCache cancelled this request before sending."));
          };
          const abort = () => settle(false, "Generation stopped while reviewing the prompt.");
          const timer = setTimeout(() => settle(false, "LumiCache review expired. Retry sending to review it again."), Math.max(0, review.deadline - Date.now()));
          this.pending.set(review.id, { userId: context.userId, session: context.frontendSessionId, check: review, settle });
          context.signal.addEventListener("abort", abort, { once: true });
          if (context.signal.aborted) abort();
          else this.notify(context.userId, context.chatId, context.frontendSessionId);
        });
      }
      context.signal.throwIfAborted();
      check.status = "allowed";
      if (alarming && settings.mode === "warn") void this.toastBreak(messages, check, context, "warning", depth => `Cache has been broken at depth ${depth}!`, tokens => `${tokens} tokens will be recached 💸.`);
      // LumiBooks already toasted when it finished, so this reports what that costs on the first send to see it.
      else if (planned && check.comparison.kind === "break" && !routeChanged) void this.toastBreak(messages, check, context, "success", () => "LumiBooks Compaction Successful.", tokens => `Gracefully re-caching ${tokens} tokens 💖.`);
      this.candidates.set(this.key(context.userId, context.generationId), { key: this.key(context.userId, context.chatId, context.scope), userId: context.userId, check, retained, refresh, epoch, connection: context.mainDispatch.descriptor?.connectionId, alarming, releasedThrough });
      this.notify(context.userId, context.chatId, context.frontendSessionId);
      return messages;
    } catch (error) {
      if (check) { this.pending.get(check.id)?.settle(false); check.status = "cancelled"; }
      state.busy = false; state.candidate = undefined;
      this.notify(context.userId, context.chatId, context.frontendSessionId);
      throw error;
    }
  }
  /** The prompt the chat's last successful native send used, for replaying it unchanged. */
  prompt(user: string, chat: string) {
    const state = this.chats.get(this.key(user, chat));
    return state?.baseline && state.retained && state.connection ? { messages: state.retained.messages, connectionId: state.connection, model: state.baseline.model } : null;
  }
  /** Compares what the provider read with what the last reply left cached. The prompt comparison then says why it fell short. */
  private reportCache(user: string, state: ChatState, check: Check, alarming: boolean, usage?: Pick<CacheUsage, "read" | "write">) {
    const expected = state.cached, read = usage?.read;
    state.cached = read === undefined ? undefined : read + (usage?.write ?? 0);
    if (!this.toast || !expected || read === undefined) return;
    const lost = expected - read, { kind, routeChanged, firstMessage } = check.comparison;
    if (lost < MISS_TOKENS || lost < expected * MISS_SHARE || kind === "break" && !alarming) return;
    const format = (tokens: number) => tokens.toLocaleString("en-US");
    const cause = routeChanged ? "The model or connection changed."
      : kind === "break" ? `The prompt changed at depth ${check.after.messages.length - Math.min(firstMessage ?? 0, check.after.messages.length - 1)}.`
      : "The prompt didn't change, so the cache likely expired.";
    try { this.toast(user, "warning", `Cache miss: ${format(lost)} tokens`, `The provider read ${format(read)} of ${format(expected)} cached tokens. ${cause}`); }
    catch (error) { console.warn("[LumiCache] Could not show the cache toast:", error); }
  }
  /** Returns whether this send became the new baseline. */
  finish(user: string, generation: string, success: boolean, replyId?: string, usage?: Pick<CacheUsage, "read" | "write">): boolean {
    const key = this.key(user, generation), candidate = this.candidates.get(key);
    if (!candidate) return false;
    this.candidates.delete(key);
    const state = this.chats.get(candidate.key);
    if (!state || state.check !== candidate.check) return false;
    state.busy = false; candidate.check.status = success ? "completed" : "failed";
    state.candidate = undefined;
    if (success) { this.reportCache(user, state, candidate.check, candidate.alarming, usage); state.baseline = candidate.check.after; state.retained = candidate.retained; state.replies = candidate.refresh ? 1 : state.replies + 1; state.epoch = candidate.epoch; state.connection = candidate.connection; state.releasedThrough = candidate.releasedThrough;
      const [, chat, scope] = JSON.parse(candidate.key) as string[], after = candidate.check.after;
      this.store?.save(user, chat, scope, { at: after.at, route: after.route, model: after.model, messages: candidate.retained.messages, replies: state.replies, epoch: state.epoch }, replyId);
    }
    this.notify(user, candidate.check.chatId);
    return success;
  }
}
