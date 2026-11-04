import { createHash } from "node:crypto";
import type { ChatDTO, DryRunResultDTO, LlmMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { compare, snapshot, stableJson } from "../compare";
import { DEFAULT_SETTINGS, errorText, type Comparison, type InspectionContext, type Settings, type Snapshot } from "../shared";
import { validateSettings } from "../settings";
import { classifyDepth } from "./depth";
import { analyze, clippingFindings, reportedUsage } from "./analyze";
import { collectSources, type Sources } from "./sources";
import { scenarios } from "./scenarios";
import { historicalCutoffs } from "./copy";
import { memoryFinding } from "./memory";
import { buildTimeline, normalizedHistory, promptOutline } from "./timeline";
import { historyUnchanged, tailStart } from "../consistency";
import type { AuditInput, HealthReport, OutlineTurn, SimulationReport, SimulationScenario, SimulationTicket } from "./types";

interface Job { user: string; session: string; sources: Sources; ticket: SimulationTicket; expires: number; running: boolean; cancelled: boolean; timer: ReturnType<typeof setTimeout> }
interface PreparedPreview extends DryRunResultDTO { request_messages?: LlmMessageDTO[] }
function signature(value: unknown) { return createHash("sha256").update(stableJson(value)).digest("hex"); }
export class HealthService {
  private jobs = new Map<string, Job>();
  private preparing = new Set<string>();
  constructor(private api: SpindleAPI, private busy: (user: string, chat: string) => boolean,
    private progress: (user: string, session: string, completed: number, name: string) => void,
    private settings: (user: string) => Promise<Settings> = async () => DEFAULT_SETTINGS) {}
  private assertIdle(user: string, chat: string) { if (this.busy(user, chat)) throw new Error("Finish or stop the live generation before running a cache check."); }
  private preview(user: string, sources: Sources, chatId = sources.chat.id, generationType = "normal"): Promise<PreparedPreview> {
    const input = { chatId, connectionId: sources.connection.id, personaId: sources.persona?.id,
      presetId: sources.preset?.id, generationType, includeRequestMessages: true };
    return this.api.generate.dryRun(input, user);
  }
  async audit(user: string, input: AuditInput): Promise<HealthReport> {
    this.assertIdle(user, input.chatId);
    const sources = await collectSources(this.api, user, input);
    const preview = await this.preview(user, sources);
    const messages = sources.messages ?? [];
    const latest = [...messages].reverse().find(message => !message.is_user && message.content);
    const usage = latest ? reportedUsage(await this.api.generate.getBreakdown(latest.id, user), latest.id) : undefined;
    const report = await classifyDepth(analyze(sources, preview, usage), await this.settings(user), preview.messages, this.api, user);
    report.findings.push(...await memoryFinding(this.api, user));
    return report;
  }
  /** Mirrors the live guard: a break inside the mutable tail with history intact is accepted. */
  private async tolerated(user: string, before: LlmMessageDTO[], after: LlmMessageDTO[], comparison: Comparison, context: InspectionContext): Promise<boolean> {
    if (comparison.kind !== "break" || comparison.routeChanged || comparison.firstMessage === null) return false;
    try {
      const old = before.map(normalizedHistory), next = after.map(normalizedHistory);
      if (!historyUnchanged(old, next)) return false;
      const boundary = await tailStart(old, validateSettings(await this.settings(user)), context, messages => this.api.tokens.countMessages(messages, { model: context.mainDispatch.descriptor?.model, userId: user }));
      return comparison.firstMessage >= boundary.index;
    } catch { return false; }
  }
  async prepare(user: string, session: string | undefined, input: AuditInput): Promise<SimulationTicket> {
    if (!session) throw new Error("Open LumiCache in a connected browser to simulate caching.");
    this.assertIdle(user, input.chatId);
    for (const [id, job] of this.jobs) if (!job.running && job.expires < Date.now()) this.jobs.delete(id);
    if (this.preparing.has(user) || [...this.jobs.values()].some(job => job.user === user)) throw new Error("A cache simulation is already being prepared or running. Cancel it before starting another.");
    if (this.preparing.size + this.jobs.size >= 8) throw new Error("Too many simulations are active. Try again after one finishes.");
    this.preparing.add(user);
    try {
      const sources = await collectSources(this.api, user, input), messages = await this.api.chat.getMessages(input.chatId);
      const last = messages.at(-1); if (!last) throw new Error("Send a message in this chat before running a simulation.");
      const id = crypto.randomUUID(), ticket = { id, sourceChatId: input.chatId, lastMessageId: last.id, branchName: `LumiCache simulation ${id}` };
      const timer = setTimeout(() => { if (!this.jobs.get(id)?.running) this.jobs.delete(id); }, 120_000); timer.unref?.();
      this.jobs.set(id, { user, session, sources, ticket, expires: Date.now() + 120_000, running: false, cancelled: false, timer });
      return ticket;
    } finally { this.preparing.delete(user); }
  }
  cancel(user: string, session: string | undefined, id: string) {
    const job = this.jobs.get(id);
    if (!job || job.user !== user || job.session !== session) throw new Error("This simulation is no longer available in this browser.");
    if (job.running) job.cancelled = true; else { clearTimeout(job.timer); this.jobs.delete(id); }
  }
  async run(user: string, session: string | undefined, id: string, scratchChatId: string): Promise<SimulationReport> {
    const job = this.jobs.get(id);
    if (!job || job.user !== user || job.session !== session || job.running || job.expires < Date.now()) throw new Error("This simulation ticket expired or belongs to another browser.");
    job.running = true;
    let scratch: ChatDTO;
    try {
      const candidate = await this.api.chats.get(scratchChatId, user);
      if (!candidate || candidate.id === job.sources.chat.id || candidate.name !== job.ticket.branchName || candidate.metadata.lumicache_simulation_source !== job.sources.chat.id || candidate.metadata.lumicache_simulation !== id)
        throw new Error("The simulation copy does not match this ticket. No messages were changed.");
      scratch = candidate;
    } catch (error) { job.running = false; throw error; }
    clearTimeout(job.timer);
    const plan = scenarios(id, job.sources.messages?.at(-1)?.is_user === true);
    const report: SimulationReport = { sourceChatId: job.sources.chat.id, at: Date.now(), complete: false, steps: [], history: [], seed: id,
      limitations: [],
      health: { chatId: job.sources.chat.id, at: Date.now(), preset: job.sources.preset?.name ?? "No preset", model: job.sources.connection.model,
        provider: job.sources.connection.provider, findings: [], entriesScanned: job.sources.lore.length, blocksScanned: 0 } };
    const clonedRules: string[] = [];
    if (scratch.metadata.lumicache_omitted_audio) report.limitations.push(`${scratch.metadata.lumicache_omitted_audio} audio attachments were excluded from the disposable copy because the host treats their files as message-owned. Audio-related cache behavior is not tested; original audio is preserved.`);
    try {
      const sourceMessages = await this.api.chat.getMessages(job.sources.chat.id), initialCopy = await this.api.chat.getMessages(scratch.id);
      if (sourceMessages.at(-1)?.id !== job.ticket.lastMessageId || sourceMessages.length !== initialCopy.length || sourceMessages.some((message, index) => message.content !== initialCopy[index].content || message.is_user !== initialCopy[index].is_user))
        throw new Error("The source conversation changed before the simulation started. Retry with the latest history.");
      const anchorIndex = Number(scratch.metadata.lumicache_simulation_anchor);
      if (Number.isInteger(anchorIndex) && anchorIndex >= 0 && initialCopy[anchorIndex]) {
        scratch = await this.api.chats.update(scratch.id, { metadata: { ...scratch.metadata, context_history_anchor_message_id: initialCopy[anchorIndex].id } }, user);
        report.limitations.push("The current context anchor is preserved for future scenarios. Historical samples before that anchor are reconstructed without it.");
      }
      const branchPreset = await this.api.presets.getActive(scratch.id, user);
      if (branchPreset.preset_id !== job.sources.active.preset_id || stableJson(branchPreset.block_states) !== stableJson(job.sources.active.block_states))
        throw new Error("The disposable branch does not resolve to the source chat's preset and block selections. The simulation was stopped.");
      for (const rule of job.sources.regex) if (rule.scope === "chat" && rule.scope_id === job.sources.chat.id) {
        const { id: _id, created_at: _created, updated_at: _updated, ...fields } = rule;
        const clone = await this.api.regex_scripts.create({ ...fields, script_id: crypto.randomUUID(), folder: "", scope_id: scratch.id, preset_id: null }, user);
        clonedRules.push(clone.id);
      }
      const sourceBefore = signature(await this.api.chat.getMessages(job.sources.chat.id));
      let totalCharacters = 0, completed = 0;
      const reportedContext = new Set<string>();
      const contextFor = (result: DryRunResultDTO): InspectionContext => ({ userId: user, chatId: scratch.id, generationId: id, isDryRun: true, signal: new AbortController().signal,
        interceptorDeadlineAt: Date.now(), mainDispatch: { dispatchKind: "concrete", connectionDispatchRevision: null,
          descriptor: { connectionId: job.sources.connection.id, provider: result.provider, model: result.model, endpointOrigin: "Simulation", connectionDispatchRevision: null } } });
      const readSnapshot = (result: PreparedPreview) => {
        if (!result.request_messages) throw new Error("The host did not return prepared request messages. Update Lumiverse to run this simulation.");
        const after = snapshot(result.request_messages, contextFor(result));
        totalCharacters += after.messages.reduce((n, message) => n + message.header.length + message.body.length, 0);
        if (totalCharacters > 256_000_000) throw new Error("The simulation report exceeds the 256-million-character limit. Completed previews remain available.");
        return after;
      };
      const [referenceScenario, regenerateScenario, newTurnScenario] = plan.scenarios;
      const cutoffs = historicalCutoffs(sourceMessages), replied = cutoffs.at(-1) === sourceMessages.length - 1;
      const checkpoint = (name: string) => {
        this.assertIdle(user, job.sources.chat.id);
        if (job.cancelled) throw new Error("Simulation cancelled. Completed previews are shown below.");
        this.progress(user, job.session, completed++, name);
      };
      const rewind = async (cutoff: number) => {
        const current = await this.api.chat.getMessages(scratch.id);
        if (anchorIndex >= cutoff) {
          const metadata = { ...(await this.api.chats.get(scratch.id, user))!.metadata }; delete metadata.context_history_anchor_message_id;
          await this.api.chats.update(scratch.id, { metadata }, user);
        }
        for (const message of current.slice(cutoff).reverse()) await this.api.chat.deleteMessage(scratch.id, message.id);
      };
      let base: { result: PreparedPreview; snapshot: Snapshot; outline: OutlineTurn[] } | undefined;
      const record = async (scenario: SimulationScenario, result: PreparedPreview) => {
        const after = readSnapshot(result), outline = promptOutline(after, result.request_messages!, result.breakdown);
        const changedSources = base ? changedBreakdown(base.result, result) : [];
        const comparison = compare(base?.snapshot ?? null, after);
        if (comparison.kind === "first") comparison.summary = "Reference prompt for the forward simulation. No model request was sent.";
        const tolerated = base ? await this.tolerated(user, base.result.request_messages!, result.request_messages!, comparison, contextFor(result)) : false;
        const timeline = buildTimeline(base?.snapshot ?? null, base?.outline ?? null, after, outline, comparison, tolerated);
        if (!base) {
          report.health = await classifyDepth(analyze(job.sources, result), await this.settings(user), result.messages, this.api, user);
          for (const finding of report.health.findings) if (finding.id.startsWith("context-")) reportedContext.add(finding.id);
          if (scratch.metadata.lumicache_omitted_audio) report.health.findings.push({ id: "audio-not-simulated", level: "unknown", title: "Audio attachment caching was not simulated", source: "Attachments",
            detail: `${scratch.metadata.lumicache_omitted_audio} audio attachments were excluded from the disposable copy to preserve their original files.`, suggestion: "Use the original request's diff and saved provider usage to inspect audio-related changes." });
          base = { result, snapshot: after, outline };
        }
        else for (const finding of clippingFindings(result.contextClipStats).filter(f => f.level !== "info")) {
          if (reportedContext.has(finding.id)) continue;
          reportedContext.add(finding.id);
          report.health.findings.push({ ...finding, id: `step-${report.steps.length}-${finding.id}`, source: scenario.name });
        }
        report.steps.push({ name: scenario.name, purpose: scenario.purpose, inputs: scenario.messages, snapshot: after, comparison, clipping: result.contextClipStats, changedSources, timeline });
        if (comparison.kind === "break") report.health.findings.push({ id: `simulation-${report.steps.length}`, level: tolerated ? "info" : "issue", category: "Simulation", title: `${scenario.name}: the assembled prefix changed`, source: changedSources.join(", ") || "Assembled prompt",
          detail: comparison.summary, suggestion: "Open this step's diff to see what changed. Provider cache loss has not been measured." });
      };
      // New turn needs the latest reply in history and the reference needs it gone, so it builds first.
      checkpoint(newTurnScenario.name);
      for (const message of newTurnScenario.messages) await this.api.chat.appendMessage(scratch.id, { role: message.role, content: String(message.content) }, { triggerGeneration: false });
      const nextTurn = await this.preview(user, job.sources, scratch.id);
      await rewind(replied ? sourceMessages.length - 1 : sourceMessages.length);
      checkpoint(referenceScenario.name);
      await record(referenceScenario, await this.preview(user, job.sources, scratch.id));
      checkpoint(regenerateScenario.name);
      await record(regenerateScenario, await this.preview(user, job.sources, scratch.id, "regenerate"));
      await record(newTurnScenario, nextTurn);
      const historical: Array<{ cutoff: number; preview: PreparedPreview; step: SimulationReport["steps"][number] }> = [];
      for (const cutoff of [...cutoffs].reverse()) {
        checkpoint(`Past turn through message ${cutoff}`);
        await rewind(cutoff);
        const result = await this.preview(user, job.sources, scratch.id), after = readSnapshot(result);
        const saved = await this.api.generate.getBreakdown(sourceMessages[cutoff].id, user);
        const recorded = saved?.messages?.map(message => ({ ...message, role: message.role as "user" | "assistant" | "system" }));
        const step = { name: `History through message ${cutoff}`, purpose: "What actually happened next in your chat, added on top of the turn before it.", inputs: [],
          snapshot: after, comparison: compare(null, after), clipping: result.contextClipStats, changedSources: [], historyThrough: cutoff,
          recordedUsage: reportedUsage(saved, sourceMessages[cutoff].id),
          ...(recorded ? { recordedPrompt: readSnapshot({ ...result, model: saved!.model, provider: saved!.provider, request_messages: recorded }) } : {}) };
        historical.unshift({ cutoff, preview: result, step }); report.history = historical.map(item => item.step);
      }
      let earlierOutline: OutlineTurn[] | null = null;
      for (const [index, item] of historical.entries()) {
        item.step.comparison = compare(historical[index - 1]?.step.snapshot ?? null, item.step.snapshot);
        if (!index) { item.step.comparison.summary = "Reference prompt for the historical reconstruction, built using today's settings."; item.step.purpose = "The oldest of your recent turns. Past Turns build forward from here."; }
        item.step.changedSources = index ? changedBreakdown(historical[index - 1].preview, item.preview) : [];
        const earlier = historical[index - 1], outline = promptOutline(item.step.snapshot, item.preview.request_messages!, item.preview.breakdown);
        const tolerated = earlier ? await this.tolerated(user, earlier.preview.request_messages!, item.preview.request_messages!, item.step.comparison, contextFor(item.preview)) : false;
        item.step.timeline = buildTimeline(earlier?.step.snapshot ?? null, earlierOutline, item.step.snapshot, outline, item.step.comparison, tolerated);
        earlierOutline = outline;
        if (item.step.comparison.kind === "break") report.health.findings.push({ id: `historical-${item.cutoff}`, level: tolerated ? "info" : "issue", category: "Simulation", title: `${item.step.name}: reconstructed prefix changed`, source: item.step.changedSources.join(", ") || "Historical reconstruction",
          detail: item.step.comparison.summary, suggestion: "Compare the reconstructed prompts. Saved historical usage is shown separately where available." });
      }
      report.limitations.push(cutoffs.length ? `Reconstructed ${cutoffs.length} past turns with today's configuration. Historical settings, variable state, lore timing and memory indexes are not restored.` : "No earlier completed user/assistant turns were available for historical reconstruction.");
      if (signature(await this.api.chat.getMessages(job.sources.chat.id)) !== sourceBefore) report.limitations.push("The original conversation changed while the simulation ran; this report describes the branch created at the start.");
      if (signature(await collectSources(this.api, user, job.sources.input)) !== signature(job.sources)) throw new Error("The chat configuration changed during simulation. The previews are retained, but rerun the check for a consistent result.");
      report.complete = true;
    } catch (error) { report.error = errorText(error); }
    finally {
      const errors: string[] = [];
      for (const ruleId of clonedRules) try { await this.api.regex_scripts.delete(ruleId, user); } catch (error) { errors.push(`Temporary regex ${ruleId}: ${errorText(error)}`); }
      try {
        const current = await this.api.chats.get(scratch.id, user);
        if (current) {
          if (current.name !== job.ticket.branchName || current.metadata.lumicache_simulation_source !== job.sources.chat.id || current.metadata.lumicache_simulation !== id) throw new Error("The copy's identity changed; it was preserved.");
          if (!await this.api.chats.delete(scratch.id, user)) throw new Error("The temporary branch could not be deleted.");
        }
      } catch (error) { errors.push(errorText(error)); }
      if (errors.length) { report.cleanupError = errors.join("\n"); report.scratchChatId = scratch.id; }
      this.jobs.delete(id);
    }
    return report;
  }
}
function changedBreakdown(before: DryRunResultDTO, after: DryRunResultDTO): string[] {
  const group = (preview: DryRunResultDTO) => {
    const map = new Map<string, string[]>();
    for (const entry of preview.breakdown) {
      if (entry.type === "chat_history") continue;
      const key = entry.blockId || `${entry.type}:${entry.name}`;
      map.set(key, [...map.get(key) ?? [], `${entry.role ?? ""}\n${entry.content ?? ""}`]);
    }
    return map;
  };
  const old = group(before), next = group(after), names = new Map([...before.breakdown, ...after.breakdown].map(entry => [entry.blockId || `${entry.type}:${entry.name}`, entry.name]));
  return [...new Set([...old.keys(), ...next.keys()])].filter(key => stableJson(old.get(key)) !== stableJson(next.get(key))).map(key => names.get(key) || key);
}
