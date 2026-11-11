import type { SpindleAPI } from "lumiverse-spindle-types";
import type { Guard } from "./guard";
import type { HealthService } from "./health/service";
import type { PromptStore, DiffInput } from "./prompt-store";
import type { AuditInput, HealthReport, SimulationReport, SimulationTicket } from "./health/types";
import { COVERAGE, errorText } from "./shared";
import { AGENT_DOCS, DOCS_SURFACE } from "./agent-docs";
import { uuid } from "./uuid";

export const BRIDGE_PERMISSIONS = ["characters", "chats", "generation", "presets", "personas", "world_books", "regex_scripts", "chat_mutation"];
export const CACHE_SURFACE = "lumicache_reports";
type Kind = "audit" | "simulation";
type Phase = "queued" | "running" | "cleaning" | "cancelling" | "completed" | "failed" | "cancelled";
interface Job {
  id: string; user: string; session: string; callId: string; kind: Kind; input: AuditInput; phase: Phase;
  at: number; updated: number; progress: string; error?: string; cancelled: boolean;
  ticket?: string; submitted?: boolean; scratchId?: string; result?: HealthReport | SimulationReport;
  timer?: ReturnType<typeof setTimeout>;
}
interface Cached { user: string; chatId: string; at: number; audit?: HealthReport; simulation?: SimulationReport }
interface Presence { user: string; session: string; chatId?: string; connectionId?: string; at: number }
export const bridgeSession = (user: string) => `lumicache-agent:${user}`;
function id(value: unknown): string { if (typeof value !== "string" || !value || value.length > 200) throw new Error("A valid identifier is required."); return value; }
function index(value: unknown): number | undefined { if (value === undefined) return; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid page or message index."); return value; }
const terminal = (job: Job) => ["completed", "failed", "cancelled"].includes(job.phase);

export class AgentBridge {
  private jobs = new Map<string, Job>();
  private browsers = new Map<string, Presence>();
  private reports = new Map<string, Cached>();
  constructor(private api: SpindleAPI, private guard: Guard, private health: HealthService, private prompts: PromptStore) {}
  private key(user: string, chat: string) { return JSON.stringify([user, chat]); }
  private prune() {
    for (const [key, value] of this.browsers) if (value.at < Date.now() - 65_000) this.browsers.delete(key);
    for (const [key, value] of this.jobs) if (terminal(value) && value.updated < Date.now() - 1_800_000) this.jobs.delete(key);
    for (const [key, value] of this.reports) if (value.at < Date.now() - 1_800_000) this.reports.delete(key);
    while (this.reports.size > 12) this.reports.delete(this.reports.keys().next().value!);
    while (this.jobs.size > 32) { const old = [...this.jobs].find(([, job]) => terminal(job)); if (!old) break; this.jobs.delete(old[0]); }
  }
  presence(user: string, session: string, input: { chatId?: string; connectionId?: string; offline?: boolean }) {
    this.prune(); const key = this.key(user, session);
    if (input.offline) { this.browsers.delete(key); return; }
    if (input.chatId !== undefined) id(input.chatId);
    if (input.connectionId !== undefined) id(input.connectionId);
    this.browsers.delete(key); this.browsers.set(key, { user, session, chatId: input.chatId, connectionId: input.connectionId, at: Date.now() });
    while (this.browsers.size > 64) this.browsers.delete(this.browsers.keys().next().value!);
  }
  private async owned(user: string, chatId: string) { if (!await this.api.chats.get(chatId, user)) throw new Error("This chat is unavailable to the requesting user."); }
  private job(user: string, jobId: string, session?: string) {
    this.prune(); const job = this.jobs.get(jobId);
    if (!job || job.user !== user || session !== undefined && job.session !== session) throw new Error("This diagnostic job expired or belongs to another user or browser."); return job;
  }
  private timer(job: Job, ms: number, callback: () => void) {
    clearTimeout(job.timer); job.timer = setTimeout(callback, ms); job.timer.unref?.();
  }
  private end(job: Job, error?: string) {
    clearTimeout(job.timer); job.updated = Date.now(); job.error = error || job.error;
    job.phase = job.cancelled ? "cancelled" : job.error ? "failed" : "completed";
    job.progress = job.phase === "completed" ? "Diagnostic finished." : job.error ?? "Diagnostic cancelled.";
  }
  private view(job: Job) {
    return { id: job.id, kind: job.kind, chatId: job.input.chatId, connectionId: job.input.connectionId, phase: job.phase,
      at: job.at, updated: job.updated, progress: job.progress, error: job.error, pollAfterMs: terminal(job) ? undefined : 1500,
      ...(job.scratchId && job.error ? { scratchChatId: job.scratchId } : {}) };
  }
  private async start(user: string, request: Record<string, unknown>) {
    const chatId = id(request.chatId), kind = request.kind;
    if (kind !== "audit" && kind !== "simulation") throw new Error("Choose audit or simulation.");
    const callId = id(request.callId); await this.owned(user, chatId);
    // Fetched before the checks below, so they and the job's creation stay one uninterrupted step.
    const jobId = await uuid(); this.prune();
    const duplicate = [...this.jobs.values()].find(job => job.user === user && job.callId === callId);
    if (duplicate) {
      if (duplicate.kind !== kind || duplicate.input.chatId !== chatId || request.connectionId !== undefined && request.connectionId !== duplicate.input.connectionId)
        throw new Error("This diagnostic call ID was already used for a different request.");
      return this.view(duplicate);
    }
    if ([...this.jobs.values()].some(job => job.user === user && !terminal(job))) throw new Error("A diagnostic is already active. Poll or cancel that job first.");
    if ([...this.jobs.values()].filter(job => !terminal(job)).length >= 8) throw new Error("Too many cache diagnostics are active. Try again later.");
    const candidates = [...this.browsers.values()].filter(browser => browser.user === user).reverse();
    const browser = candidates.find(browser => browser.chatId === chatId) ?? candidates[0];
    if (!browser) throw new Error("Open Lumiverse with LumiCache enabled and keep the browser connected to run diagnostics.");
    const connectionId = request.connectionId === undefined ? browser.chatId === chatId ? browser.connectionId : undefined : id(request.connectionId);
    const job: Job = { id: jobId, user, session: browser.session, callId, kind,
      input: { chatId, ...(connectionId ? { connectionId } : {}) }, phase: "queued", at: Date.now(), updated: Date.now(), progress: "Waiting for the connected browser.", cancelled: false };
    this.jobs.set(job.id, job); this.prune();
    this.timer(job, 15_000, () => this.end(job, "The browser did not acknowledge the diagnostic. Reconnect Lumiverse and retry."));
    // The authenticated browser starts a new host request because this RPC's
    // permission scope ends when the acknowledgement is returned.
    try { this.api.sendToFrontend({ type: "agentDiagnostic", id: job.id }, user, { frontendSessionId: job.session }); }
    catch (error) { this.end(job, errorText(error)); }
    return this.view(job);
  }
  claim(user: string, session: string, jobId: string) {
    const job = this.job(user, jobId, session);
    if (job.phase !== "queued") throw new Error("This diagnostic was already claimed or cancelled.");
    job.phase = "running"; job.updated = Date.now(); job.progress = "Preparing the diagnostic.";
    this.timer(job, 360_000, () => {
      job.error = "The diagnostic timed out. Native preview cleanup may still be finishing.";
      this.cancelJob(job);
      if (!job.submitted) this.end(job, `${job.error} Check for a remaining LumiCache simulation copy if setup was interrupted.`);
    });
    return { kind: job.kind, input: job.input };
  }
  authorize(user: string, session: string, jobId: string, kind: Kind, input: AuditInput) {
    const job = this.job(user, jobId, session);
    if (job.kind !== kind || job.phase !== "running" || job.cancelled || job.input.chatId !== input.chatId || job.input.connectionId !== input.connectionId)
      throw new Error("This diagnostic no longer matches its approved request.");
    return job;
  }
  attach(user: string, session: string, jobId: string, ticket: SimulationTicket) {
    const job = this.job(user, jobId, session); job.ticket = ticket.id;
    if (job.cancelled || terminal(job)) { this.health.cancel(user, session, ticket.id); throw new Error("Diagnostic cancelled before simulation setup."); }
  }
  submitted(user: string, session: string, ticketId: string, scratchId: string) {
    const job = [...this.jobs.values()].find(job => job.user === user && job.session === session && job.ticket === ticketId);
    if (job) {
      if (job.cancelled || terminal(job)) throw new Error("Diagnostic cancelled before submission.");
      job.submitted = true; job.scratchId = scratchId;
    }
  }
  progress(user: string, session: string, completed: number, name: string) {
    const job = [...this.jobs.values()].find(job => job.user === user && job.session === session && !terminal(job));
    if (job) { job.progress = `Building preview ${completed + 1}: ${name}`; job.updated = Date.now(); }
  }
  cancelledTicket(user: string, session: string, ticketId: string) {
    const job = [...this.jobs.values()].find(job => job.user === user && job.session === session && job.ticket === ticketId && !terminal(job));
    if (job) { job.cancelled = true; job.phase = "cancelling"; job.updated = Date.now(); job.progress = "Cancelling after the current native preview and cleanup."; }
  }
  private remember(user: string, chatId: string, patch: Partial<Cached>) {
    const key = this.key(user, chatId), old = this.reports.get(key);
    this.reports.delete(key); this.reports.set(key, { ...old, ...patch, user, chatId, at: Date.now() }); this.prune();
  }
  auditResult(user: string, report: HealthReport, jobId?: string) {
    this.remember(user, report.chatId, { audit: report });
    if (jobId) { const job = this.job(user, jobId); job.result = report; this.end(job); }
  }
  async simulationResult(user: string, session: string, ticketId: string, report: SimulationReport) {
    const packed = await this.prompts.pack(report, user, bridgeSession(user)); this.remember(user, report.sourceChatId, { simulation: packed });
    const job = [...this.jobs.values()].find(job => job.user === user && job.session === session && job.ticket === ticketId);
    if (job) {
      job.result = packed; job.phase = "cleaning"; job.updated = Date.now(); job.progress = "Removing the temporary preset profile.";
      this.timer(job, 65_000, () => this.end(job, "The browser did not confirm profile cleanup. Check the temporary preset profile and any reported simulation copy."));
    }
  }
  finish(user: string, session: string, jobId: string, input: { error?: string; cleanupError?: string; scratchChatId?: string }) {
    const job = this.job(user, jobId, session);
    if (terminal(job)) return;
    const error = input.error?.slice(0, 2000), cleanupError = input.cleanupError?.slice(0, 2000);
    if (job.kind === "simulation" && job.result) {
      const result = job.result as SimulationReport;
      if (cleanupError) { result.cleanupError = cleanupError; result.scratchChatId = input.scratchChatId; }
      this.end(job, error || result.error || result.cleanupError || (!result.complete ? "Simulation incomplete." : undefined));
    } else this.end(job, error || "The browser stopped before completing this diagnostic.");
  }
  private cancelJob(job: Job) {
    if (terminal(job)) return;
    const queued = job.phase === "queued";
    job.cancelled = true; job.phase = "cancelling"; job.updated = Date.now(); job.progress = "Cancelling after the current native preview and cleanup.";
    if (job.ticket) { try { this.health.cancel(job.user, job.session, job.ticket); } catch { /* It may already be cleaning up. */ } }
    if (queued || job.kind === "simulation" && !job.submitted && !job.ticket) this.end(job);
  }
  private report(user: string, chatId: string) {
    this.prune(); const cached = this.reports.get(this.key(user, chatId));
    const health = (report?: HealthReport) => report ? { ...report, findings: report.findings.slice(0, 30), findingsTotal: report.findings.length,
      nextFindingsCursor: report.findings.length > 30 ? 30 : undefined } : undefined;
    const simulation = cached?.simulation;
    return { chatId, coverage: COVERAGE, audit: health(cached?.audit), simulation: simulation ? { ...simulation,
      health: health(simulation.health), steps: simulation.steps.map(({ inputs: _inputs, timeline: _timeline, ...step }) => step), history: simulation.history.map(({ inputs: _inputs, timeline: _timeline, ...step }) => step) } : undefined };
  }
  async request(requester: string, raw: unknown): Promise<unknown> {
    if (requester !== "lumiagent") throw new Error("Only LumiAgent may use this bridge.");
    if (!raw || typeof raw !== "object") throw new Error("Malformed cache bridge request.");
    const request = raw as Record<string, unknown>;
    if (request.op === "describe") return { extension: { id: "lumicache", name: "LumiCache", version: "0.7.1" }, surfaces: [{ id: CACHE_SURFACE, label: "Cache diagnostics", scope: "global",
      description: "Read-only cache reports and live prefix checks by chat ID. Use inspect_cache for paged prompt diffs and run_cache_diagnostic to start or cancel an audit/simulation. Diagnostics do not prove provider cache hits. Sending decisions stay in LumiCache." },
      { id: DOCS_SURFACE, label: "LumiCache guide", scope: "global", description: "Read-only compact LLM docs. list_external for topics; read_external by topic ID. Monitoring, settings, health, simulation, tools and integrations." }] };
    const user = id(request.userId);
    if (request.op === "system_prompt") return { text: "LumiCache: inspect_cache reads evidence; run_cache_diagnostic starts/cancels diagnostics (connected browser required). Guide: list_external(surface_id=\"lumicache_docs\"), read_external by topic ID. Stable prompts do not prove cache hits; only the user approves paused sends." };
    if (request.op === "check_write") return { ok: false, message: "Cache evidence is read-only. Use run_cache_diagnostic to request a new diagnostic." };
    if (request.op === "write_field") return { ok: false, error: "Cache evidence is read-only. Use run_cache_diagnostic to request a new diagnostic." };
    if (request.op === "check_read") return { ok: true };
    if (request.op === "list_items") {
      if (request.surfaceId === DOCS_SURFACE) return { items: AGENT_DOCS.map(({ id, label }) => ({ id, label })), total: AGENT_DOCS.length };
      if (request.surfaceId !== CACHE_SURFACE) throw new Error("Unknown LumiCache surface.");
      this.prune(); const ids = new Set([...this.guard.chatIds(user), ...[...this.reports.values()].filter(r => r.user === user).map(r => r.chatId)]);
      const items = [];
      for (const chatId of ids) { const chat = await this.api.chats.get(chatId, user); if (chat) items.push({ id: chatId, label: chat.name || chatId }); }
      return { items, total: items.length };
    }
    if (request.op === "read_item") {
      if (request.surfaceId === DOCS_SURFACE) {
        if (request.field !== undefined && request.field !== "text") throw new Error("Read a LumiCache guide topic with field omitted or text.");
        const topic = AGENT_DOCS.find(topic => topic.id === request.itemId);
        if (!topic) throw new Error("Unknown LumiCache guide topic. Use list_external on lumicache_docs.");
        return { value: topic.text };
      }
      if (request.surfaceId !== CACHE_SURFACE) throw new Error("Unknown LumiCache surface.");
      const chatId = id(request.itemId); await this.owned(user, chatId);
      if (request.field === "live") return { value: await this.prompts.pack(this.guard.view(user, chatId), user, bridgeSession(user)) };
      if (request.field !== undefined && request.field !== "report") throw new Error("Read report or live. Use inspect_cache for paged diffs and findings.");
      return { value: this.report(user, chatId) };
    }
    if (request.op !== "cache") throw new Error("Unknown LumiCache bridge operation.");
    const session = bridgeSession(user);
    switch (request.action) {
      case "start": return this.start(user, request);
      case "job": { const job = this.job(user, id(request.jobId)); await this.owned(user, job.input.chatId); return this.view(job); }
      case "cancel": { const job = this.job(user, id(request.jobId)); await this.owned(user, job.input.chatId); this.cancelJob(job); return this.view(job); }
      case "live": { const chat = id(request.chatId); await this.owned(user, chat); return this.prompts.pack(this.guard.view(user, chat), user, session); }
      case "report": { const chat = id(request.chatId); await this.owned(user, chat); return this.report(user, chat); }
      case "findings": {
        const chat = id(request.chatId); await this.owned(user, chat); this.prune(); const cached = this.reports.get(this.key(user, chat));
        const report = request.kind === "audit" ? cached?.audit : request.kind === "simulation" ? cached?.simulation?.health : undefined;
        if (!report) throw new Error("That diagnostic report is not available.");
        const cursor = index(request.cursor) ?? 0;
        return { findings: report.findings.slice(cursor, cursor + 30), total: report.findings.length, nextCursor: cursor + 30 < report.findings.length ? cursor + 30 : undefined };
      }
      case "diff_list": return this.prompts.list(user, session, { before: request.before === undefined ? undefined : id(request.before), after: id(request.after), cursor: index(request.cursor), includeUnchanged: request.includeUnchanged === true });
      case "diff_open": {
        const input: DiffInput = { before: request.before === undefined ? undefined : id(request.before), after: id(request.after), oldIndex: index(request.oldIndex), newIndex: index(request.newIndex), part: request.part === "header" ? "header" : "body" };
        return this.prompts.open(user, session, input, 20);
      }
      case "diff_page": return this.prompts.page(user, session, { id: id(request.diffId), cursor: index(request.cursor), fold: index(request.fold), limit: 20 });
      default: throw new Error("Unknown cache action. The bridge cannot approve sends, change monitoring or clear baselines.");
    }
  }
  register() {
    this.api.rpcPool.handle("phoneline", async context => {
      if (context.requesterExtensionId !== "lumiagent") throw new Error("Only LumiAgent may use this bridge.");
      const request = await this.api.rpcPool.read("lumiagent.phoneline_request");
      return this.request(context.requesterExtensionId, request);
    }, { requires: BRIDGE_PERMISSIONS });
  }
}
