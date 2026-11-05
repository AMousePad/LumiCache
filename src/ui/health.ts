import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import type { AuditInput, Finding, HealthReport, SimulationReport, SimulationStep, SimulationTicket, TimelineRow } from "../health/types";
import { DEFAULT_ACCEPTABLE_DEPTH, DEFAULT_SETTINGS, errorText, type Classification, type Settings, type Snapshot } from "../shared";
import { validateSettings } from "../settings";
import type { Bridge } from "./bridge";
import { button, el, externalLink } from "./elements";
import { renderPrompt, renderTurnDiff } from "./diff";
import { isProblem, KIND_LABELS, renderTimeline, turnName, type TimelineView } from "./timeline";
import { simulate } from "./simulation";
import { AutoHealth, healthKey } from "./auto-health";
import { actionable, filtered, healthPill, renderFindings } from "./findings";
import { icon } from "./icons";
import { readComposition } from "./composition";

const SOURCE_EVENTS = ["SETTINGS_UPDATED", "PRESET_CHANGED", "PRESET_DELETED", "PRESET_PROFILE_CHANGED", "CONNECTION_PROFILE_LOADED", "MAIN_API_CHANGED",
  "WORLD_BOOK_CHANGED", "WORLD_BOOK_LIBRARY_CHANGED", "WORLD_BOOK_DELETED", "WORLD_BOOK_ENTRY_CHANGED", "WORLD_BOOK_ENTRY_DELETED", "CHARACTER_EDITED", "CHARACTER_LIBRARY_CHANGED", "PERSONA_CHANGED",
  "REGEX_SCRIPT_CHANGED", "REGEX_SCRIPT_DELETED", "MESSAGE_SENT", "MESSAGE_EDITED", "MESSAGE_DELETED", "MESSAGE_SWIPED", "SWIPE_EDITED", "CHAT_CHANGED", "GENERATION_BREAKDOWN_READY"];
type Page = "health" | "simulation";
const LUMIAGENT_URL = "https://github.com/AMousePad/LumiAgent";
const TEST_LABELS = ["Reference", "Regenerate", "New turn"];
type TestState = "held" | "allowed" | "broken";
const testState = (step: SimulationStep): TestState => step.comparison.kind !== "break" ? "held" : step.timeline?.tolerated ? "allowed" : "broken";
/** A lane's first prompt is what the rest compare against, so it is not a test. */
function simulationTests(result: SimulationReport) {
  return [...result.steps.flatMap((step, index) => index ? [{ lane: "steps" as const, index, step, label: TEST_LABELS[index] ?? step.name }] : []),
    ...result.history.flatMap((step, index) => {
      const ago = result.history.length - 1 - index;
      return index ? [{ lane: "history" as const, index, step, label: ago ? `${ago} ${ago === 1 ? "turn" : "turns"} ago` : "Latest turn" }] : [];
    })];
}
function testSentence(step: SimulationStep) {
  const data = step.timeline!, first = data.rows.find(row => row.root);
  if (data.routeChanged) return "The connection or model changed, so the whole prompt is recached.";
  if (first) {
    const place = `message ${(first.newIndex ?? first.oldIndex ?? 0) + 1}, ${turnName(first)}`;
    return data.tolerated ? `Changes start at ${place}. That is inside your allowed tail.` : `Cache breaks at ${place}.`;
  }
  if (step.comparison.kind === "first") return "This is the starting prompt the tests compare against.";
  return step.comparison.kind === "append" ? "Only new text was added at the end. Everything before it stays cached." : "Nothing changed. The whole prompt stays cached.";
}
/** A break before the allowed tail can leave no checkpoint that far back, so the unchanged prefix may not be read either. */
export function cacheMeter(step: SimulationStep, settings: Settings): HTMLElement[] {
  const data = step.timeline!, atRisk = testState(step) === "broken" && !data.routeChanged && data.kept > 0 && data.rewritten > 0;
  const total = Math.max(1, data.kept + data.rewritten + data.added), meter = el("div", `lc-meter${atRisk ? " lc-meter-risk" : ""}`); meter.setAttribute("aria-hidden", "true");
  for (const [name, value] of [["kept", data.kept], ["lost", data.rewritten], ["new", data.added]] as const) { const part = el("i", `lc-meter-${name}`); part.style.flexGrow = String(value); meter.append(part); }
  const share = (value: number) => `${Math.round(value / total * 100)}%`;
  const tail = `depth ${settings.acceptableDepth ?? DEFAULT_ACCEPTABLE_DEPTH}${settings.acceptableTokens != null ? ` and ${settings.acceptableTokens.toLocaleString()} tokens` : ""}`;
  const parts = atRisk
    ? [`${share(data.kept)} is consistent but at risk of invalidation due to the remaining ${share(data.rewritten)} breaking cache outside of your allowed tail of ${tail}`]
    : [`${share(data.kept)} cache consistent`, data.rewritten ? `${share(data.rewritten)} recached` : ""];
  return [meter, el("p", `lc-muted lc-meter-copy${atRisk ? " lc-meter-copy-risk" : ""}`, [...parts, data.added ? `${share(data.added)} new` : ""].filter(Boolean).join(" · "))];
}
// The host allows two modals per extension, and the review modal may hold one.
let turnModal: SpindleModalHandle | undefined;
export function closeTurnModal() { turnModal?.dismiss(); }
export interface TurnDetail { row: TimelineRow; before?: Snapshot | null; after: Snapshot; tolerated: boolean; notes?: Finding[] }
/** One message of a timeline: why it matters, where it came from, and its side by side diff. */
export function openTurnModal(ctx: SpindleFrontendContext, client: Bridge, { row, before, after, tolerated, notes = [] }: TurnDetail) {
  closeTurnModal();
  const position = (row.newIndex ?? row.oldIndex ?? 0) + 1;
  const modal = ctx.ui.showModal({ title: `Message ${position} \u00B7 ${KIND_LABELS[row.kind]}`, width: 1100, maxHeight: 820 }); turnModal = modal;
  modal.onDismiss(() => { if (turnModal === modal) turnModal = undefined; });
  const body = el("div", "lc-root lc-modal lc-turn-modal");
  body.append(el("h3", "", turnName(row)), el("p", `lc-turn-why${isProblem(row) ? " lc-turn-why-bad" : ""}`, turnSentence(row, tolerated)));
  const sources = row.sources.length ? row.sources : row.parts.map(part => part.label);
  if (sources.length) {
    const from = el("div", "lc-turn-sources"); from.append(el("strong", "", isProblem(row) ? "Changed part" : "Comes from"));
    for (const label of sources.slice(0, 12)) { const kind = row.parts.find(part => part.label === label)?.kind ?? row.kind, chip = el("span", "lc-tl-key", label); chip.dataset.kind = kind; chip.prepend(el("i")); from.append(chip); }
    body.append(from);
  }
  if (notes.length) { const list = el("div", "lc-turn-notes"); list.append(el("strong", "", "Health found")); for (const note of notes) list.append(el("p", "lc-muted", `${note.title}. ${note.suggestion}`)); body.append(list); }
  const same = !isProblem(row) && row.status !== "new";
  body.append(renderTurnDiff(before ?? undefined, after, { oldIndex: row.oldIndex, newIndex: row.newIndex, headerChanged: row.headerChanged, same }, client));
  modal.root.replaceChildren(body);
}
function turnSentence(row: TimelineRow, tolerated: boolean) {
  const place = row.root ? tolerated ? "Changes start here, inside your allowed tail. " : "Cache breaks here. Because this is outside your tail, your entire context is at risk of cache invalidation. " : "";
  switch (row.status) {
    case "changed": return `${place}This message's text changed from the previous prompt.`;
    case "added": return `${place}This message was not in the previous prompt, and it landed before older messages.`;
    case "removed": return `${place}This message was in the previous prompt and is now gone.`;
    case "rewritten": return "This message did not change, but it sits after the break, so it is recached.";
    case "new": return "New text at the end of the prompt. This is normal growth and does not break the cache.";
    case "kept": return "This message did not change and sits before any break, so it stays cached.";
    default: return "Part of the starting prompt the tests compare against.";
  }
}
export class HealthPanel {
  readonly root = el("div", "lc-health");
  private report?: HealthReport;
  private reportKey = "";
  private simulation?: SimulationReport;
  private simulationKey = "";
  private ticket?: SimulationTicket;
  private runningChat?: string;
  private status = "";
  private error = "";
  private auditError = "";
  private disposed = false;
  private started = false;
  private liveBusy = false;
  private reviewBusy = false;
  private lastKey = "";
  private page: Page = "health";
  private lane: "steps" | "history" = "steps";
  private timeline?: { key: string; view: TimelineView };
  private step = 0;
  private open = new Set<string>();
  private unsubscribe: (() => void)[] = [];
  private settings = DEFAULT_SETTINGS;
  private toggleCategory?: (category: Classification) => void;
  private savingSettings = false;
  readonly auto: AutoHealth;
  constructor(private ctx: SpindleFrontendContext, private bridge: Bridge, private input: () => AuditInput | null, private composition = readComposition) {
    this.auto = new AutoHealth({ input, check: async value => bridge.call("audit", { ...value, composition: await this.composition() }),
      result: (report, value) => { this.report = report; this.reportKey = healthKey(value); this.auditError = ""; },
      error: error => { this.auditError = errorText(error); },
      changed: () => { if (this.page === "health") this.render(); } });
    this.unsubscribe.push(ctx.onBackendMessage(raw => {
      const event = raw as { type: string; completed: number; name: string; id?: string };
      if (event?.type === "agentDiagnostic" && typeof event.id === "string") void this.runFromAgent(event.id);
      if (event?.type === "simulationProgress" && this.ticket && this.runningChat) { this.status = `Building: ${event.name}`; this.render(); }
    }));
    this.render();
  }
  start() {
    if (this.started) return; this.started = true;
    this.unsubscribe.push(this.ctx.state!.subscribe("chat.active", () => { this.liveBusy = false; this.reviewBusy = false; this.sync(); }));
    for (const name of SOURCE_EVENTS) this.unsubscribe.push(this.ctx.events.on(name, payload => {
      const chat = (payload as { chatId?: string; chat_id?: string } | null)?.chatId ?? (payload as { chat_id?: string } | null)?.chat_id;
      if (chat && chat !== this.input()?.chatId) return;
      this.auto.sync(); this.auto.invalidate();
    }));
    this.unsubscribe.push(this.ctx.events.on("GENERATION_STARTED", payload => { if (this.currentEvent(payload)) this.setLive(true); }));
    for (const name of ["GENERATION_ENDED", "GENERATION_STOPPED"]) this.unsubscribe.push(this.ctx.events.on(name, payload => {
      if (this.currentEvent(payload)) { this.setLive(false); this.auto.invalidate(); }
    }));
    this.unsubscribe.push(this.ctx.events.on("CONNECTED", () => this.auto.invalidate()));
    this.sync();
  }
  configure(settings: Settings, toggle: (category: Classification) => void) {
    const next = validateSettings(settings), changed = JSON.stringify(next) !== JSON.stringify(this.settings);
    const policyChanged = next.acceptableDepth !== this.settings.acceptableDepth || next.acceptableTokens !== this.settings.acceptableTokens || next.cacheTtl !== this.settings.cacheTtl || next.autoRefreshEnabled !== this.settings.autoRefreshEnabled || next.autoRefreshMinutes !== this.settings.autoRefreshMinutes;
    this.settings = next; this.toggleCategory = toggle;
    if (policyChanged) this.auto.invalidate();
    if (changed) this.render();
  }
  setSaving(value: boolean) { this.savingSettings=value; this.render(); }
  private currentEvent(payload: unknown) { const id = (payload as { chatId?: string } | null)?.chatId; return !id || id === this.input()?.chatId; }
  sync() { this.auto.suspend(this.liveBusy || this.reviewBusy || !!this.runningChat); this.auto.sync(); this.render(); }
  setLive(value: boolean) { if (value === this.liveBusy) return; this.liveBusy = value; this.auto.suspend(value || this.reviewBusy || !!this.runningChat); this.render(); }
  setReview(value: boolean) { if (value === this.reviewBusy) return; this.reviewBusy = value; this.auto.suspend(value || this.liveBusy || !!this.runningChat); this.render(); }
  show(page: Page) { if (this.page !== page) { this.page = page; this.render(); } }
  private empty(title: string, text?: string, type: "shield" | "play" = "shield") {
    const box = el("div", "lc-empty"); box.append(icon(type, "lc-empty-icon"), el("h3", "", title)); if (text) box.append(el("p", "lc-muted", text)); return box;
  }
  private failure(message: string) {
    const detail = el("details", "lc-error-detail"); detail.append(el("summary", "", "Check unavailable"), el("p", "lc-error", message)); return detail;
  }
  render() {
    if (this.disposed) return;
    const key = healthKey(this.input()); if (key !== this.lastKey) { this.lastKey = key; this.auditError = ""; this.error = ""; }
    const parent = this.root.closest<HTMLElement>(".lc-content"), scroll = parent?.scrollTop;
    const focused = this.root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.focus : undefined;
    this.root.replaceChildren();
    if (!this.input()) this.root.append(this.empty("Open a chat", "Your cache check will appear here."));
    else {
      if (this.page === "health") this.renderHealth(); else this.renderSimulation();
      const promo = el("p", "lc-promo"); promo.append("Struggling? ", el("strong", "", "LumiAgent"), " integrates with this extension to help make things cache consistent :) Get her ", externalLink("Here", LUMIAGENT_URL), ".");
      this.root.append(promo);
    }
    if (parent && scroll !== undefined) parent.scrollTop = scroll;
    if (this.page === "simulation") this.timeline?.view.attached();
    if (focused) this.root.querySelector<HTMLElement>(`[data-focus="${focused}"]`)?.focus({ preventScroll: true });
  }
  private renderHealth() {
    const report = this.reportKey === healthKey(this.input()) ? this.report : undefined;
    const toolbar = el("div", "lc-section-toolbar");
    if (report) toolbar.append(healthPill(actionable(report.findings), this.auto.stale, this.settings.hiddenCategories, category => {
      if (this.toggleCategory) this.toggleCategory(category);
      else { this.settings = { ...this.settings, hiddenCategories: this.settings.hiddenCategories.includes(category) ? this.settings.hiddenCategories.filter(c=>c!==category) : [...this.settings.hiddenCategories,category] }; this.render(); }
    }));
    else toolbar.append(el("span", "lc-health-pending", this.auditError ? "Check unavailable" : this.liveBusy || this.reviewBusy ? "Waiting for generation" : "Checking health…"));
    const refresh = button("Refresh", () => { this.auditError = ""; this.auto.refresh(); }, "lc-quiet-button"); refresh.prepend(icon("refresh", this.auto.running ? "lc-spin" : ""));
    refresh.dataset.focus = "refresh-health"; refresh.setAttribute("aria-label", "Refresh cache health");
    refresh.title = report ? `Last checked ${new Date(report.at).toLocaleTimeString()}` : "Refresh cache health";
    refresh.disabled = this.auto.running || !!this.runningChat || this.liveBusy || this.reviewBusy; toolbar.append(refresh); this.root.append(toolbar);
    for(const control of toolbar.querySelectorAll<HTMLButtonElement>(".lc-pill-toggle")) control.disabled=this.savingSettings;
    if (this.auditError) this.root.append(this.failure(this.auditError));
    if (report) {
      const rows = filtered(report.findings, this.settings.hiddenCategories);
      if (rows.length) this.root.append(renderFindings(rows, this.open));
      else this.root.append(actionable(report.findings).length ? this.empty("Categories hidden", "Select a category above to show its findings.") : this.empty("Nothing flagged", "No concrete cache risks found in this check."));
      if (report.findingsOmitted) this.root.append(el("p", "lc-muted", `${report.findingsOmitted} more findings exceed the report limit.`));
    } else if (!this.auditError && !this.liveBusy && !this.reviewBusy) {
      const skeleton = el("div", "lc-skeleton"); skeleton.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 3; i++) skeleton.append(el("div")); this.root.append(skeleton);
    }
    if ((this.liveBusy || this.reviewBusy) && report) this.root.append(el("p", "lc-inline-status", "Updates after generation finishes."));
  }
  private renderSimulation() {
    const input = this.input(), result = this.simulationKey === healthKey(input) ? this.simulation : undefined;
    const view = el("div", "lc-sim"); this.root.append(view);
    const toolbar = el("div", "lc-section-toolbar"), run = button(result ? "Run again" : "Simulate caching", () => { void this.run(); }, "lc-primary"); run.prepend(icon("play"));
    run.dataset.focus = "simulate"; run.disabled = !!this.runningChat || this.liveBusy || this.reviewBusy;
    toolbar.append(run, el("span", "lc-muted", "Test Prompts and Historical Cache Behaviour")); view.append(toolbar);
    if (this.runningChat) {
      const state = el("div", "lc-progress-card"), spinner = icon("refresh", "lc-spin"); state.setAttribute("role", "status");
      state.append(spinner, el("span", "", this.status || "Preparing simulation\u2026"));
      if (this.ticket) state.append(button("Cancel", () => { void this.cancel(); }, "lc-text-button")); view.append(state); return;
    }
    if (this.error) view.append(this.failure(this.error));
    if (!result) { view.append(this.empty("See where your cache breaks", "Builds your next few prompts and shows every message from start to end, with the ones that break cache marked.", "play")); return; }
    if (result.error) view.append(el("p", "lc-error", result.error));
    if (result.cleanupError) view.append(el("p", "lc-error", `Cleanup needed: ${result.cleanupError}${result.scratchChatId ? `\nCopy: ${result.scratchChatId}` : ""}`));
    const tests = simulationTests(result), broken = tests.filter(test => testState(test.step) === "broken").length, allowed = tests.filter(test => testState(test.step) === "allowed").length;
    const verdict = el("div", `lc-verdict ${broken ? "lc-verdict-bad" : "lc-verdict-good"}`);
    verdict.append(icon(broken ? "x" : "check"), el("strong", "", !tests.length ? "No test finished" : broken ? `Cache broke in ${broken} of ${tests.length} tests` : `Cache held in all ${tests.length} tests`));
    if (allowed || !result.complete) verdict.append(el("span", "lc-muted", [allowed ? `${allowed} inside your allowed tail` : "", result.complete ? "" : "Incomplete run"].filter(Boolean).join(" \u00B7 ")));
    view.append(verdict);
    const picker = el("div", "lc-tests"); picker.setAttribute("role", "group"); picker.setAttribute("aria-label", "Choose a test");
    const addGroup = (title: string, group: typeof tests) => {
      if (!group.length) return;
      const row = el("div", "lc-test-group"); row.append(el("span", "lc-test-group-name", title));
      for (const test of group) {
        const pick = button(test.label, () => { this.lane = test.lane; this.step = test.index; this.render(); }, `lc-test lc-test-${testState(test.step)}`);
        pick.prepend(el("i")); pick.dataset.focus = `test-${test.lane}-${test.index}`; pick.title = test.step.purpose;
        pick.setAttribute("aria-pressed", String(this.lane === test.lane && this.step === test.index)); row.append(pick);
      }
      picker.append(row);
    };
    addGroup("Future Turns", tests.filter(test => test.lane === "steps")); addGroup("Past Turns", tests.filter(test => test.lane === "history")); view.append(picker);
    const steps = result[this.lane]; this.step = Math.max(0, Math.min(this.step, steps.length - 1));
    const step = steps[this.step];
    if (step) {
      const card = el("section", "lc-test-card"), data = step.timeline;
      card.append(el("p", "lc-test-purpose", step.purpose));
      if (data) {
        card.append(el("p", "lc-test-result", testSentence(step)));
        card.append(...cacheMeter(step, this.settings));
      }
      if (this.lane === "history") card.append(el("p", "lc-muted", "Rebuilt with your current settings, so this is not an exact replay."));
      if (step.clipping?.messagesDropped) card.append(el("p", "lc-issue-ink", `${step.clipping.messagesDropped} history messages clipped`));
      view.append(card);
      if (data) {
        const key = `${result.seed}:${this.lane}:${this.step}`;
        if (this.timeline?.key !== key) { this.timeline?.view.dispose(); this.timeline = { key, view: renderTimeline(data, row => this.openTurn(result, steps, this.step, row)) }; }
        view.append(this.timeline.view.root);
      }
    }
    const details = el("details", "lc-run-details"); details.append(el("summary", "", "Test details"));
    const body = el("div", "lc-details-body");
    if (step?.inputs.length) body.append(el("strong", "", "Test input"), el("pre", "lc-raw", step.inputs.map(message => `${message.role}:\n${String(message.content)}`).join("\n\n")));
    if (step?.recordedPrompt) { const recorded = el("details"); recorded.append(el("summary", "", "Saved original prompt")); let opened = false; const saved = step.recordedPrompt;
      recorded.addEventListener("toggle", () => { if (recorded.open && !opened) { opened = true; recorded.append(renderPrompt(saved, this.bridge)); } }); body.append(recorded); }
    if (step?.recordedUsage?.read !== undefined) body.append(el("p", "lc-muted", `${step.recordedUsage.read.toLocaleString()} saved cache-read tokens`));
    for (const note of result.limitations) body.append(el("p", "lc-muted", note));
    details.append(body); view.append(details);
  }
  private openTurn(result: SimulationReport, steps: SimulationStep[], index: number, row: TimelineRow) {
    const sources = row.sources.length ? row.sources : row.parts.map(part => part.label);
    const notes = actionable(result.health.findings).filter(finding => finding.item && sources.some(source => source.includes(finding.item!))).slice(0, 4);
    // Future Turns all compare against the reference. Past Turns each build on the turn before.
    const before = this.lane === "steps" ? (index ? steps[0] : undefined) : steps[index - 1];
    openTurnModal(this.ctx, this.bridge, { row, before: before?.snapshot, after: steps[index].snapshot, tolerated: !!steps[index].timeline?.tolerated, notes });
  }
  private async begin(input: AuditInput) {
    this.runningChat = input.chatId; this.auto.suspend(true); this.error = ""; this.status = "Preparing simulation…"; this.render(); await this.auto.idle();
  }
  private end() { this.runningChat = undefined; this.ticket = undefined; this.auto.suspend(this.liveBusy || this.reviewBusy); this.render(); }
  private setSimulation(result: SimulationReport, input: AuditInput) { this.simulation = result; this.simulationKey = healthKey(input); const tests = simulationTests(result), first = tests.find(test => testState(test.step) === "broken") ?? tests.find(test => testState(test.step) === "allowed") ?? tests[0]; this.lane = first?.lane ?? "steps"; this.step = first?.index ?? 0; }
  private async runFromAgent(id: string) {
    let claimed = false, ownsRun = false, kind: "audit" | "simulation" | undefined;
    try {
      const job = await this.bridge.call("agentClaim", { id }); claimed = true;
      kind = job.kind;
      if (this.runningChat) throw new Error("LumiCache is already running a diagnostic in this browser. Retry when it finishes.");
      ownsRun = true; await this.begin(job.input); this.status = "Diagnostic requested by LumiAgent…"; this.render();
      const input = { ...job.input, agentJobId: id };
      if (job.kind === "audit") this.auto.accept(await this.bridge.call("audit", { ...input, composition: await this.composition() }), job.input);
      else { const result = await simulate(this.bridge, input, ticket => { this.ticket = ticket; this.render(); }); this.setSimulation(result, job.input);
        await this.bridge.call("agentFinish", { id, cleanupError: result.cleanupError, scratchChatId: result.scratchChatId }); }
    } catch (error) { this.error = errorText(error); if (kind === "audit") this.auditError = this.error;
      if (claimed) try { await this.bridge.call("agentFinish", { id, error: this.error }); } catch { /* Reconnection is needed to acknowledge cleanup. */ } }
    finally { if (ownsRun) this.end(); }
  }
  private async run() {
    const input = this.input(); if (!input || this.runningChat || this.liveBusy || this.reviewBusy) return;
    await this.begin(input);
    try { this.setSimulation(await simulate(this.bridge, input, ticket => { this.ticket = ticket; this.render(); }), input); }
    catch (error) { this.error = errorText(error); } finally { this.end(); }
  }
  private async cancel() {
    if (!this.ticket) return;
    try { await this.bridge.call("cancelSimulation", { id: this.ticket.id }); this.status = "Finishing cleanup…"; }
    catch (error) { this.error = errorText(error); } this.render();
  }
  dispose() { this.disposed = true; closeTurnModal(); this.timeline?.view.dispose(); this.auto.dispose(); for (const off of this.unsubscribe) off(); }
}
