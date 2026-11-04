import type { LlmMessageDTO, SavedBreakdownDTO, SpindleAPI } from "lumiverse-spindle-types";
import { reportedUsage } from "./health/analyze";
import { errorText, type KeepWarmState, type Settings } from "./shared";

/** The final prompt of the last successful send, and where it went. */
export interface RefreshPrompt { messages: LlmMessageDTO[]; connectionId: string; model: string }
interface Job { chat: string; every: number; limit: number; done: number; next?: number; timer?: ReturnType<typeof setTimeout>; request?: AbortController }
export interface AutoRefreshHost {
  generate: Pick<SpindleAPI["generate"], "dryRun" | "quiet">;
  prompt(user: string, chat: string): RefreshPrompt | null;
  busy(user: string, chat: string): boolean;
  toast(user: string, tone: "warning" | "success", title: string, message: string): void;
  changed(user: string, state: KeepWarmState | null): void;
}
/**
 * Replays the last prompt while a chat sits idle, so its cache has not expired when the user returns.
 * Each replay is a billed request, so only the chat sent in last runs, and any failure or cache miss stops it.
 */
export class AutoRefresh {
  private jobs = new Map<string, Job>();
  constructor(private host: AutoRefreshHost, private minute = 60_000) {}
  /** A real send refreshed the cache itself, so the wait and the count both start over. */
  start(user: string, chat: string, settings: Required<Settings>) {
    const replaced = this.drop(user);
    if (!settings.autoRefreshEnabled) { if (replaced) this.host.changed(user, null); return; }
    const job: Job = { chat, every: settings.autoRefreshMinutes * this.minute, limit: settings.autoRefreshLimit, done: 0 };
    this.jobs.set(user, job); this.wait(user, job);
  }
  cancel(user: string, chat?: string) {
    const job = this.jobs.get(user);
    if (!job || chat !== undefined && job.chat !== chat) return;
    this.drop(user); this.host.changed(user, null);
  }
  /** Applies changed settings to a running job. With no job, the next reply picks them up. */
  restart(user: string, settings: Required<Settings>) {
    const job = this.jobs.get(user);
    if (job) this.start(user, job.chat, settings);
  }
  state(user: string): KeepWarmState | null {
    const job = this.jobs.get(user);
    return job ? { chatId: job.chat, done: job.done, limit: job.limit, nextIn: job.next === undefined ? null : Math.max(0, job.next - Date.now()) } : null;
  }
  private drop(user: string): boolean {
    const job = this.jobs.get(user);
    if (!job) return false;
    this.jobs.delete(user); clearTimeout(job.timer); job.request?.abort();
    return true;
  }
  /** A live generation will do the same work, so drop the replay but keep the schedule in case it fails. */
  interrupt(user: string, chat: string) {
    const job = this.jobs.get(user);
    if (job?.chat === chat) job.request?.abort();
  }
  private wait(user: string, job: Job) {
    job.next = Date.now() + job.every;
    job.timer = setTimeout(() => { void this.run(user, job); }, job.every);
    (job.timer as { unref?: () => void }).unref?.();
    this.host.changed(user, this.state(user));
  }
  private async run(user: string, job: Job) {
    const live = () => this.jobs.get(user) === job;
    if (!live()) return;
    if (this.host.busy(user, job.chat)) return this.wait(user, job);
    const prompt = this.host.prompt(user, job.chat);
    if (!prompt) { this.jobs.delete(user); this.host.changed(user, null); return; }
    const request = job.request = new AbortController();
    job.next = undefined; this.host.changed(user, this.state(user));
    try {
      const preview = await this.host.generate.dryRun({ chatId: job.chat, connectionId: prompt.connectionId }, user);
      if (request.signal.aborted) { if (live()) this.wait(user, job); return; }
      if (preview.model !== prompt.model) return this.stop(user, job, "The chat's model changed, so its cached prompt no longer applies.");
      const { max_context_length: _context, model: _model, ...parameters } = preview.parameters;
      // Anthropic requires room for the whole thinking budget, and changing the budget would miss the cache.
      const budget = (parameters.thinking as { budget_tokens?: unknown } | undefined)?.budget_tokens;
      const max_tokens = typeof budget === "number" ? budget + 1 : 1;
      const result = await this.host.generate.quiet({ type: "quiet", messages: prompt.messages, connection_id: prompt.connectionId,
        parameters: { ...parameters, model: prompt.model, max_tokens }, userId: user, signal: request.signal });
      if (!live()) return;
      job.done++;
      const usage = reportedUsage({ usage: (result as { usage?: unknown } | null)?.usage, model: prompt.model } as SavedBreakdownDTO, "");
      // A miss wrote the prompt again at full price. Repeating it would only pay that again.
      if (usage?.read === 0) return this.stop(user, job, "The last refresh missed the cache, so further refreshes would not help. Try a shorter interval, or this chat may use tools that a refresh can't repeat.");
      const read = usage?.read === undefined ? "" : ` Read ${usage.read.toLocaleString("en-US")} cached tokens.`;
      this.host.toast(user, "success", `Cache kept warm (${job.done} of ${job.limit})`, `Kept this chat's prompt cached.${read}`);
      if (job.done < job.limit) this.wait(user, job); else { this.jobs.delete(user); this.host.changed(user, null); }
    } catch (error) {
      if (request.signal.aborted) { if (live()) this.wait(user, job); return; }
      if (live()) this.stop(user, job, errorText(error));
    } finally { if (job.request === request) job.request = undefined; }
  }
  private stop(user: string, job: Job, reason: string) {
    if (this.jobs.get(user) === job) { this.jobs.delete(user); this.host.changed(user, null); }
    this.host.toast(user, "warning", "Keep Cache Warm stopped", reason);
  }
}
