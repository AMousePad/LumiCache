import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import { errorText, type Check, type KeepWarmState, type View, type Settings } from "./shared";
import { validateSettings } from "./settings";
import { policySettings } from "./ui/settings";
import { Bridge } from "./ui/bridge";
import { button, el } from "./ui/elements";
import { renderDiff } from "./ui/diff";
import { ICON, STYLES } from "./ui/styles";
import { closeTurnModal, HealthPanel, openTurnModal } from "./ui/health";
import { renderTimeline, type TimelineView } from "./ui/timeline";
import { icon } from "./ui/icons";
import { KeepWarm } from "./ui/keep-warm";

export function setup(ctx: SpindleFrontendContext): () => void {
  const removeStyle = ctx.dom.addStyle(STYLES), bridge = new Bridge(ctx);
  const tab = ctx.ui.registerDrawerTab({ id: "lumicache", title: "LumiCache", shortName: "Cache", iconSvg: ICON,
    description: "Cache health and prompt diffs", keywords: ["cache", "diff", "prompt", "prefix"] });
  const root = el("div", "lc-root"), toolbar = el("div", "lc-app-toolbar"), tabs = el("div", "lc-tabs");
  tabs.setAttribute("role", "tablist"); tabs.setAttribute("aria-label", "LumiCache");
  const settingsPanel = el("div", "lc-settings"), content = el("div", "lc-content"), error = el("p", "lc-error lc-app-error"); error.setAttribute("role", "alert");
  root.append(toolbar, settingsPanel, error, content); tab.root.append(root);
  const chat = () => ctx.state!.get<{ chatId: string | null }>("chat.active").chatId;
  const warm = new KeepWarm(ctx, bridge, chat);
  let view: View | null = null, disposed = false, revision = 0, busy = false, settingsOpen = false;
  let policyPanel: ReturnType<typeof policySettings> | undefined, policyPanelKey = "";
  let selected: "health" | "simulation" | "check" = "health";
  let modal: SpindleModalHandle | undefined, modalId: string | undefined;
  const health = new HealthPanel(ctx, bridge, () => {
    const chatId = chat(); if (!chatId) return null;
    const connectionId = ctx.connections?.getActive?.().activeProfileId; return { chatId, ...(connectionId ? { connectionId } : {}) };
  });
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [id, label, symbol] of [["health", "Health", "shield"], ["simulation", "Simulation", "play"], ["check", "Cache Diff", "diff"]] as const) {
    const control = button(label, () => { selected = id; render(); content.scrollTop = 0; }, "lc-tab"); control.prepend(icon(symbol));
    control.id = `lumicache-tab-${id}`; control.setAttribute("role", "tab"); control.setAttribute("aria-controls", "lumicache-panel");
    control.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const ids = ["health", "simulation", "check"] as const, index = ids.indexOf(selected);
      selected = ids[event.key === "Home" ? 0 : event.key === "End" ? 2 : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3]; render(); buttons.get(selected)!.focus();
    });
    buttons.set(id, control); tabs.append(control);
  }
  const gear = button("", () => { settingsOpen = !settingsOpen; renderSettings(); }, "lc-icon-button"); gear.append(icon("settings")); gear.setAttribute("aria-label", "Cache settings"); gear.title = "Cache settings";
  toolbar.append(tabs, gear); content.id = "lumicache-panel"; content.setAttribute("role", "tabpanel"); content.tabIndex = 0;
  const inspectors = new Map<"live" | "review", { id: string; view: TimelineView }>();
  let textOpen = false;
  function closeModal() { modalId = undefined; const old = modal; modal = undefined; old?.dismiss(); }
  function renderSettings() {
    gear.setAttribute("aria-expanded", String(settingsOpen)); settingsPanel.hidden = !settingsOpen; settingsPanel.replaceChildren();
    if (!settingsOpen || !view) return;
    const {hiddenCategories:_filters,...editable}=validateSettings(view.settings), key=JSON.stringify(editable);
    if(!policyPanel || policyPanelKey!==key) { policyPanelKey=key;policyPanel=policySettings(view.settings,busy,patch=>{void save(patch);}); }
    policyPanel.setBusy(busy);settingsPanel.append(policyPanel);
    if (chat() && view.hasBaseline) {
      const reset = button("Reset comparison", () => { void clearBaseline(); }, "lc-text-button"); reset.disabled = busy || ["waiting", "allowed"].includes(view.check?.status ?? "");
      reset.title = "Use the next successful request as a new baseline"; settingsPanel.append(reset);
    }
  }
  function detail(check: Check, actionable: boolean, slot: "live" | "review"): HTMLElement {
    const section = el("div", "lc-review");
    if (check.policy) {
      const labels = { tolerated: "Within your tail tolerance", preserved: "Prior prompt content restored", refresh: "Scheduled refresh", seed: "Starting a frozen baseline" };
      const status = el("p","lc-policy-status",labels[check.policy.action]);
      const details = [check.policy.restored ? `${check.policy.restored} restored` : "",check.policy.relocated ? `${check.policy.relocated} moved` : "",check.policy.approximate ? "estimated tokens" : ""].filter(Boolean);
      if(details.length) status.append(document.createTextNode(` · ${details.join(" · ")}`)); section.append(status);
    }
    if (check.status === "waiting") {
      const status = el("div", "lc-review-status"); status.append(icon("diff"), el("span", "", actionable ? "Sending is paused" : "Awaiting review in the sending browser")); section.append(status);
    }
    if (check.before) {
      const percent = check.comparison.previousCharacters ? Math.floor(100 * check.comparison.commonCharacters / check.comparison.previousCharacters) : 0;
      const caption = el("p", "lc-muted lc-prefix-caption", check.comparison.routeChanged ? "Connection or model changed" : `${percent}% of the previous prefix matches`);
      caption.title = `${check.comparison.commonCharacters.toLocaleString()} matching characters · ${check.comparison.commonMessages} unchanged messages`; section.append(caption);
    }
    const data = check.timeline;
    // Live and review show one check twice, and each needs its own scroll position.
    if (data) {
      let held = inspectors.get(slot);
      if (held?.id !== check.id) {
        held?.view.dispose();
        held = { id: check.id, view: renderTimeline(data, row => openTurnModal(ctx, bridge, { row, before: check.before, after: check.after, tolerated: data.tolerated })) };
        inspectors.set(slot, held);
      }
      section.append(held.view.root);
    }
    // The inspector covers each message. This covers route changes, and every change at once.
    const text = el("details", "lc-run-details"), body = el("div", "lc-details-body"); let opened = false;
    text.append(el("summary", "", check.comparison.routeChanged ? "Connection change and text" : "All changes as text"), body);
    const reveal = () => { if (text.open && !opened) { opened = true; body.append(renderDiff(check, bridge)); } };
    text.addEventListener("toggle", () => { textOpen = text.open; reveal(); });
    text.open = !data || textOpen; reveal();
    section.append(text);
    if (check.status === "waiting" && actionable) {
      const actions = el("div", "lc-actions"), cancel = button("Cancel send", () => { void decide(check.id, false); }), send = button("Send anyway", () => { void decide(check.id, true); }, "lc-primary");
      cancel.disabled = send.disabled = busy; actions.append(cancel, send); section.append(actions);
      section.append(el("p", "lc-muted lc-review-expiry", `Review by ${new Date(check.deadline).toLocaleTimeString()}`));
    } else if (check.status === "waiting") section.append(el("p", "lc-muted", "Use the browser session that started this request."));
    return section;
  }
  function renderLive() {
    const page = el("div", "lc-live");
    if (!view) { page.append(el("p", "lc-muted", "Loading…")); return page; }
    if (!chat() || !view.check?.before) {
      if (chat() && view.settings.mode === "off") page.append(el("p", "lc-inline-status", "Monitoring is off"));
      const empty = el("div", "lc-empty"); empty.append(icon("diff", "lc-empty-icon"), el("h3", "", chat() ? "Ready For Cache Comparison" : "Open a chat"), el("p", "lc-muted", chat() ? "Send a reply to inspect the cache diff." : "Open a chat to inspect its cache diff.")); page.append(empty); return page;
    }
    const check = view.check, heading = el("div", "lc-section-toolbar");
    const first = check.comparison.firstMessage;
    const verdict = check.comparison.kind === "same" ? "Cache kept: prompt unchanged"
      : check.comparison.kind === "append" ? "Cache kept: only new text at the end"
      : check.comparison.routeChanged ? "Cache breaks: connection or model changed"
      : check.policy?.action === "tolerated" ? "Changes inside your allowed tail"
      : first === null ? "Cache breaks" : `Cache breaks at message ${first + 1}`;
    const states = { waiting: "Waiting for your review", allowed: "Generating…", completed: "Reply finished", cancelled: "Send cancelled", failed: "Generation stopped" };
    const titles = el("div", "lc-live-title"); titles.append(el("h3", "", verdict), el("span", "lc-muted", states[check.status])); heading.append(titles);
    const refresh = button("", () => { void load(); }, "lc-icon-button"); refresh.append(icon("refresh")); refresh.title = "Refresh Cache Diff"; refresh.setAttribute("aria-label", "Refresh Cache Diff"); heading.append(refresh);
    page.append(heading);
    if (view.settings.mode === "off") page.append(el("p", "lc-inline-status", "Monitoring is off"));
    page.append(detail(check, view.canDecide, "live")); return page;
  }
  function render() {
    if (disposed) return;
    for (const [id, control] of buttons) { control.setAttribute("aria-selected", String(selected === id)); control.tabIndex = selected === id ? 0 : -1; }
    content.setAttribute("aria-labelledby", `lumicache-tab-${selected}`); renderSettings();
    if(view) health.configure(view.settings,category=>{
      const hidden=validateSettings(view!.settings).hiddenCategories;
      void save({hiddenCategories:hidden.includes(category)?hidden.filter(c=>c!==category):[...hidden,category]});
    });
    health.setReview(!!view?.check && ["waiting", "allowed"].includes(view.check.status));
    if (selected === "check") { content.replaceChildren(renderLive()); inspectors.get("live")?.view.attached(); }
    else { health.show(selected); if (content.firstChild !== health.root) content.replaceChildren(health.root); }
    tab.setBadge(view?.settings.mode === "off" ? "off" : view?.check?.comparison.kind === "break" && !view.check.policy?.accepted ? "!" : null);
    const pending = view?.check?.status === "waiting" && view.canDecide ? view.check : undefined;
    if (!pending || pending.id !== modalId) closeModal();
    if (pending && !modal) {
      modal = ctx.ui.showModal({ title: "Review prompt changes", width: 960, maxHeight: 760, persistent: true }); modalId = pending.id;
      // Host cleanup and navigation also dismiss modals. Only Cancel send is a cancellation.
      modal.onDismiss(() => { if (modalId !== pending.id) return; modalId = undefined; modal = undefined; });
    }
    if (pending && modal) { const body = el("div", "lc-root lc-modal"), message = el("p", "lc-error", error.textContent ?? ""); message.setAttribute("role", "alert"); body.append(message, detail(pending, true, "review")); modal.root.replaceChildren(body); inspectors.get("review")?.view.attached(); }
  }
  async function load() {
    const current = ++revision, chatId = chat();
    try { const next = await bridge.call("load", chatId ? { chatId } : {}); if (disposed || current !== revision || chatId !== chat()) return; view = next; warm.update(next.settings, next.keepWarm ?? null); error.textContent = ""; render(); }
    catch (cause) { if (!disposed && current === revision) { error.textContent = errorText(cause); render(); } }
  }
  async function decide(id: string, allow: boolean) {
    if (busy) return; busy = true; error.textContent = ""; render();
    try { await bridge.call("decide", { id, allow }); closeModal(); } catch (cause) { error.textContent = errorText(cause); }
    finally { busy = false; await load(); }
  }
  async function save(patch: Partial<Settings>) {
    if (!view || busy) return;
    const focused=document.activeElement as HTMLElement | null;
    const setting=focused?.dataset.setting, filter=focused?.dataset.focus;
    busy = true; error.textContent = ""; renderSettings();
    health.setSaving(true);
    try { await bridge.call("settings", { ...validateSettings(view.settings), ...patch }); } catch (cause) { error.textContent = errorText(cause); }
    finally { busy = false; health.setSaving(false); await load();
      if(document.activeElement===document.body && (setting || filter)) root.querySelector<HTMLElement>(setting ? `[data-setting="${setting}"]` : `[data-focus="${filter}"]`)?.focus({preventScroll:true});
    }
  }
  async function clearBaseline() {
    const chatId = chat(); if (!chatId) return; busy = true; error.textContent = ""; renderSettings();
    try { await bridge.call("clear", { chatId }); } catch (cause) { error.textContent = errorText(cause); }
    finally { busy = false; await load(); }
  }
  const unsubs = [
    ctx.onBackendMessage(raw => { const event = raw as { type?: string; chatId?: string; state?: KeepWarmState | null };
      if (event?.type === "keepWarm") warm.setState(event.state ?? null);
      if (event?.type === "changed" && (!event.chatId || event.chatId === chat())) void load(); }),
    ctx.state!.subscribe("chat.active", () => { closeModal(); view = null; render(); void load(); }),
    ctx.events.on("CONNECTED", () => { void load(); }),
    ctx.events.on("__ws_close", () => { error.textContent = "Connection lost. Paused sends remain blocked."; render(); }),
    tab.onActivate(() => { health.auto.sync(); void load(); }),
  ];
  const presence = () => {
    const chatId = chat(), connectionId = ctx.connections?.getActive?.().activeProfileId;
    void bridge.call("agentPresence", { ...(chatId ? { chatId } : {}), ...(connectionId ? { connectionId } : {}) }).catch(() => {});
  };
  const presenceTimer = setInterval(presence, 20_000); presence(); render(); void load(); health.start();
  return () => { closeTurnModal(); for (const { view } of inspectors.values()) view.dispose(); clearInterval(presenceTimer); void bridge.call("agentPresence", { offline: true }).catch(() => {}); disposed = true; revision++; for (const off of unsubs) off(); closeModal(); health.dispose(); warm.dispose(); bridge.dispose(); tab.destroy(); removeStyle(); };
}
