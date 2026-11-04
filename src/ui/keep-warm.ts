import type { SpindleFrontendContext, SpindleModalHandle } from "lumiverse-spindle-types";
import { errorText, type KeepWarmState, type Settings } from "../shared";
import { validateSettings } from "../settings";
import type { Bridge } from "./bridge";
import { button, el } from "./elements";
import { icon } from "./icons";

function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
/** The on/off switch in the input bar drawer, and the banner above the input while a job runs. */
export class KeepWarm {
  private state: KeepWarmState | null = null;
  private settings?: Required<Settings>;
  private received = 0;
  private busy = false;
  private error = "";
  private ticker?: ReturnType<typeof setInterval>;
  private removeSpin?: () => void;
  private modal?: SpindleModalHandle;
  private modalStatus?: HTMLElement;
  private action;
  private offClick;
  private banner = el("div", "lc-root lc-warm-banner");
  private bannerText = el("span", "lc-warm-text");
  private bannerStop = button("Stop", () => { void this.toggle(false); });
  constructor(private ctx: SpindleFrontendContext, private bridge: Bridge, private chat: () => string | null) {
    // The host has no way to swap this icon later, so a stylesheet starts and stops its spin.
    this.action = ctx.ui.registerInputBarAction({ id: "lumicache_keep_warm", label: "Keep Cache Warm", subtitle: "Off", iconSvg: icon("refresh", "lc-warm-icon").outerHTML });
    this.offClick = this.action.onClick(() => this.open());
    this.bannerStop.setAttribute("aria-label", "Stop keeping cache warm");
    this.banner.hidden = true;
    this.banner.append(icon("refresh", "lc-spin"), this.bannerText, this.bannerStop);
    ctx.ui.mount("chat_composer_above").append(this.banner);
  }
  update(settings: Settings, state: KeepWarmState | null) { this.settings = validateSettings(settings); this.setState(state); }
  setState(state: KeepWarmState | null) { this.state = state; this.received = Date.now(); this.render(); }
  dispose() {
    clearInterval(this.ticker); this.removeSpin?.(); this.modal?.dismiss(); this.offClick(); this.action.destroy(); this.banner.remove();
  }
  private blocked() { return this.settings?.mode === "off"; }
  private status(): string {
    if (this.error) return this.error;
    const job = this.state;
    if (!job) {
      if (!this.settings?.autoRefreshEnabled) return "Off";
      return this.blocked() ? "On, but cache monitoring is off, so there is no prompt to resend" : "On. Starts after your next reply";
    }
    const where = job.chatId === this.chat() ? "Keeping cache warm" : "Keeping another chat's cache warm";
    const left = job.nextIn === null ? null : Math.max(0, job.nextIn - (Date.now() - this.received));
    return `${where} · ${left === null ? "refreshing now" : `next in ${clock(left)}`} · ${job.done} of ${job.limit} used`;
  }
  private tick() {
    const text = this.status();
    this.bannerText.textContent = text;
    if (this.modalStatus) this.modalStatus.textContent = text;
  }
  private render() {
    const running = !!this.state, enabled = !!this.settings?.autoRefreshEnabled;
    this.action.setSubtitle(running ? "On" : enabled ? "On, waiting for a reply" : "Off");
    if (running && !this.removeSpin) this.removeSpin = this.ctx.dom.addStyle("@media(prefers-reduced-motion:no-preference) { .lc-warm-icon { animation:lc-spin 1.5s linear infinite; } }");
    if (!running) { this.removeSpin?.(); this.removeSpin = undefined; }
    this.banner.hidden = !running;
    this.bannerStop.disabled = this.busy;
    clearInterval(this.ticker); this.ticker = undefined;
    if (this.state?.nextIn !== null && this.state) this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
    this.renderModal();
  }
  private open() {
    if (this.modal) return;
    const modal = this.modal = this.ctx.ui.showModal({ title: "Keep Cache Warm", width: 400 });
    modal.onDismiss(() => { if (this.modal === modal) { this.modal = undefined; this.modalStatus = undefined; } });
    this.renderModal();
  }
  private renderModal() {
    if (!this.modal) return;
    const settings = this.settings, on = !!settings?.autoRefreshEnabled, body = el("div", "lc-root lc-warm-modal");
    const status = el("div", "lc-warm-status"), text = el("span");
    if (this.state) status.append(icon("refresh", "lc-spin"));
    status.append(text); this.modalStatus = text; body.append(status);
    const every = settings?.autoRefreshMinutes ?? 4, limit = settings?.autoRefreshLimit ?? 3;
    body.append(el("p", "lc-muted", `Resends the chat's last prompt every ${every} minute${every === 1 ? "" : "s"}, up to ${limit} time${limit === 1 ? "" : "s"} after each reply, so the cache is still there when you come back. Each refresh is a billed request. Change the timing in LumiCache settings.`));
    const control = on ? button("Turn off", () => { void this.toggle(false); }) : button("Keep cache warm", () => { void this.toggle(true); }, "lc-primary");
    control.disabled = this.busy || !settings || !on && this.blocked();
    body.append(control);
    this.modal.root.replaceChildren(body);
    this.tick();
  }
  private async toggle(enabled: boolean) {
    if (this.busy) return;
    this.busy = true; this.error = ""; this.render();
    try {
      const chatId = this.chat(), result = await this.bridge.call("keepWarm", { enabled, ...(chatId ? { chatId } : {}) });
      this.settings = validateSettings(result.settings); this.state = result.state; this.received = Date.now();
    } catch (cause) { this.error = errorText(cause); }
    finally { this.busy = false; this.render(); }
  }
}
