import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { setup } from "../src/frontend";
import { PromptStore } from "../src/prompt-store";
import type { Bridge } from "../src/ui/bridge";
import { renderDiff, renderPrompt } from "../src/ui/diff";
import { compare, snapshot } from "../src/compare";
import { buildTimeline, promptOutline } from "../src/health/timeline";
import type { Check, View } from "../src/shared";
import { context, messages } from "./fixtures";

const window = new Window();
const originalDocument = globalThis.document;
beforeAll(() => { globalThis.document = window.document as unknown as Document; });
afterAll(() => { globalThis.document = originalDocument; window.happyDOM.abort(); });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
/** Holds lazy diff loading until a test scrolls the marker into view. */
function visibility() {
  const saved = globalThis.IntersectionObserver;
  let waiting: ((entries: { isIntersecting: boolean }[]) => void)[] = [];
  globalThis.IntersectionObserver = class { constructor(private fn: (entries: { isIntersecting: boolean }[]) => void) {} observe() { waiting.push(this.fn); } disconnect() {} } as unknown as typeof IntersectionObserver;
  return { reveal: async () => { const current = waiting; waiting = []; for (const fn of current) fn([{ isIntersecting: true }]); }, restore: () => { globalThis.IntersectionObserver = saved; } };
}
function check(): Check {
  const ctx = context(), before = snapshot(messages(), ctx), after = snapshot(messages("New system\n<script>alert('x')</script>"), ctx);
  return { id: "review", chatId: "chat", generationId: "gen", deadline: Date.now() + 120_000,
    status: "waiting", comparison: compare(before, after), before, after };
}
function localClient() {
  const store = new PromptStore();
  const call: Bridge["call"] = async (operation, input) => {
    if (operation === "diffList") return store.list("user", "session", input as never) as never;
    if (operation === "diffOpen") return store.open("user", "session", input as never) as never;
    if (operation === "diffPage") return store.page("user", "session", input as never) as never;
    throw new Error("Unexpected operation");
  };
  return { store, call };
}
function fixture(initial: View) {
  const lazy = localClient();
  let view = initial, chatId: string | null = "chat", modal: HTMLElement | null = null, dismiss: (() => void) | undefined;
  const root = document.createElement("div"); document.body.append(root);
  const composer = document.createElement("div"); let subtitle = "", openWarm = () => {};
  const listeners = new Set<(raw: unknown) => void>(), chatListeners = new Set<() => void>();
  const events = new Map<string, () => void>(), requests: { operation: string; input: any }[] = [];
  let activations = 0;
  const emit = (value: unknown) => { for (const listener of listeners) listener(value); };
  const ctx = {
    dom: { addStyle: () => () => {} },
    ui: {
      mount: () => composer,
      registerInputBarAction: () => ({ setSubtitle: (text: string) => { subtitle = text; }, onClick: (fn: () => void) => { openWarm = fn; return () => {}; }, destroy: () => {} }),
      registerDrawerTab: () => ({ root, setBadge: () => {}, activate: () => { activations++; }, onActivate: () => () => {}, destroy: () => root.remove() }),
      showModal: () => {
        const current = document.createElement("div"); document.body.append(current); modal = current;
        return { root: current, dismiss: () => { current.remove(); modal = null; dismiss?.(); }, onDismiss: (fn: () => void) => { dismiss = fn; return () => {}; } };
      },
    },
    state: { get: () => ({ chatId }), subscribe: (_key: string, fn: () => void) => { chatListeners.add(fn); return () => chatListeners.delete(fn); } },
    events: { on: (name: string, fn: () => void) => { events.set(name, fn); return () => events.delete(name); } },
    onBackendMessage: (fn: (raw: unknown) => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    sendToBackend: (request: { id: string; operation: string; input: any }) => {
      requests.push(request);
      queueMicrotask(async () => {
        let value: unknown;
        if (request.operation === "load") value = lazy.store.pack(view, "user", "session");
        else if (request.operation.startsWith("diff")) value = await lazy.call(request.operation as never, request.input as never);
        else if (request.operation === "decide") { view = { ...view, check: { ...view.check!, status: request.input.allow ? "allowed" : "cancelled" }, canDecide: false }; }
        else if (request.operation === "settings") { view = { ...view, settings: request.input }; value = request.input; }
        else if (request.operation === "keepWarm") { view = { ...view, settings: { ...view.settings, autoRefreshEnabled: request.input.enabled } }; value = { settings: view.settings, state: request.input.enabled ? { chatId: "chat", done: 0, limit: 3, nextIn: 240_000 } : null }; }
        else if (request.operation === "clear") view = { ...view, check: null, hasBaseline: false };
        emit({ type: "reply", id: request.id, value });
      });
    },
  } as unknown as SpindleFrontendContext;
  const dispose = setup(ctx);
  return { root, requests, dispose, modal: () => modal, dismiss: () => dismiss?.(), activations: () => activations, composer, subtitle: () => subtitle, openWarm: () => openWarm(), emit,
    update(next: View, eventChat = "chat") { view = next; emit({ type: "changed", chatId: eventChat }); },
    switchChat(next: string) { chatId = next; for (const fn of chatListeners) fn(); }, events };
}
function click(root: Element, label: string) {
  const node = Array.from(root.querySelectorAll("button")).find(b => b.textContent === label); expect(node).toBeDefined(); node!.click();
}
describe("Keep Cache Warm", () => {
  test("the drawer item turns it on and off, and the banner shows and stops a running job", async () => {
    const ui = fixture({ settings: { mode: "warn" }, check: null, hasBaseline: true, canDecide: false }); await flush();
    const banner = ui.composer.querySelector<HTMLElement>(".lc-warm-banner")!;
    expect(banner.hidden).toBe(true); expect(ui.subtitle()).toBe("Off");
    ui.openWarm(); expect(ui.modal()!.textContent).toContain("Off");
    click(ui.modal()!, "Keep cache warm"); await flush();
    expect(ui.requests.at(-1)).toMatchObject({ operation: "keepWarm", input: { enabled: true, chatId: "chat" } });
    expect(banner.hidden).toBe(false); expect(ui.subtitle()).toBe("On");
    expect(banner.textContent).toContain("Keeping cache warm"); expect(banner.textContent).toContain("next in 4:00"); expect(banner.textContent).toContain("0 of 3 used");
    ui.emit({ type: "keepWarm", state: { chatId: "other", done: 1, limit: 3, nextIn: null } });
    expect(banner.textContent).toContain("another chat"); expect(banner.textContent).toContain("refreshing now");
    click(banner, "Stop"); await flush();
    expect(ui.requests.at(-1)).toMatchObject({ operation: "keepWarm", input: { enabled: false } });
    expect(banner.hidden).toBe(true); expect(ui.subtitle()).toBe("Off");
    ui.dismiss(); ui.dispose();
  });
  test("can't be started with monitoring off, and on with no job says it is waiting", async () => {
    const off = fixture({ settings: { mode: "off" }, check: null, hasBaseline: false, canDecide: false }); await flush();
    off.openWarm();
    expect(Array.from(off.modal()!.querySelectorAll("button")).find(b => b.textContent === "Keep cache warm")!.disabled).toBe(true);
    off.dismiss(); off.dispose();
    const idle = fixture({ settings: { mode: "warn", autoRefreshEnabled: true }, check: null, hasBaseline: true, canDecide: false }); await flush();
    expect(idle.subtitle()).toBe("On, waiting for a reply");
    idle.openWarm(); expect(idle.modal()!.textContent).toContain("Starts after your next reply");
    idle.dismiss(); idle.dispose();
  });
});
describe("review UI", () => {
  test("Health is the default tab; keyboard navigation selects separate Simulation and Cache Diff panels", async () => {
    const ui = fixture({ settings: { mode: "pause" }, check: null, hasBaseline: false, canDecide: false }); await flush();
    const tabs = [...ui.root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs[0].getAttribute("aria-selected")).toBe("true"); expect(tabs[1].tabIndex).toBe(-1);
    tabs[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight" }) as unknown as Event);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true"); expect(document.activeElement).toBe(tabs[1]);
    expect(ui.root.textContent).toContain("Simulate caching"); expect(ui.root.textContent).not.toContain("Refresh");
    tabs[1].dispatchEvent(new window.KeyboardEvent("keydown", { key: "End" }) as unknown as Event);
    expect(ui.root.textContent).toContain("Ready For Cache Comparison"); expect(ui.root.textContent).toContain("Send a reply to inspect the cache diff."); expect(ui.root.querySelector('[role="tabpanel"]')!.getAttribute("aria-labelledby")).toBe(tabs[2].id);
    ui.dispose();
  });
  test("periodic refresh only shows while force consistency is on", async () => {
    const ui = fixture({ settings: { mode: "warn" }, check: null, hasBaseline: false, canDecide: false }); await flush();
    ui.root.querySelector<HTMLElement>('[aria-label="Cache settings"]')!.click();
    const section = () => ui.root.querySelector('[data-setting="refreshEnabled"]')!.closest("label")!.parentElement!;
    expect(section().hidden).toBe(true);
    ui.root.querySelector<HTMLInputElement>('[data-setting="forceConsistency"]')!.click();
    expect(section().hidden).toBe(false);
    expect(ui.root.querySelector<HTMLInputElement>('[data-setting="refreshEnabled"]')!.checked).toBe(true);
    ui.dispose();
  });
  test("a first request reads as ready, not as allowed", async () => {
    const after = snapshot(messages(), context());
    const first: Check = { id: "first", chatId: "chat", generationId: "gen", deadline: Date.now() + 120_000, status: "allowed", comparison: compare(null, after), before: null, after };
    const ui = fixture({ settings: { mode: "pause" }, check: first, hasBaseline: false, canDecide: false }); await flush();
    click(ui.root, "Cache Diff");
    expect(ui.root.textContent).toContain("Ready For Cache Comparison"); expect(ui.root.textContent).toContain("Send a reply to inspect the cache diff.");
    expect(ui.root.textContent).not.toContain("Request allowed"); expect(ui.root.textContent).not.toContain("No previous");
    ui.dispose();
  });
  test("Cache Diff uses the timeline inspector, and a message opens side by side", async () => {
    const ctx = context(), input = messages("New system"), before = snapshot(messages(), ctx), after = snapshot(input, ctx), comparison = compare(before, after);
    const inspected: Check = { id: "live", chatId: "chat", generationId: "gen", deadline: Date.now() + 120_000, status: "completed", comparison, before, after,
      timeline: buildTimeline(before, promptOutline(before, messages(), []), after, promptOutline(after, input, []), comparison) };
    const ui = fixture({ settings: { mode: "pause" }, check: inspected, hasBaseline: true, canDecide: false }); await flush();
    click(ui.root, "Cache Diff");
    expect(ui.root.querySelector('.lc-rail[role="scrollbar"]')).not.toBeNull();
    expect(ui.root.querySelector(".lc-run-details")!.hasAttribute("open")).toBe(false);
    ui.root.querySelector<HTMLElement>('.lc-turn[data-status="changed"]')!.click(); await flush();
    expect(ui.modal()!.querySelector(".lc-sbs-heads")).not.toBeNull();
    expect(ui.requests.filter(r => r.operation === "diffOpen")).toHaveLength(1);
    expect(ui.modal()!.textContent).toContain("Show whitespace");
    ui.dispose();
  });
  test("a paused send shows the inspector in both the modal and the panel behind it", async () => {
    const ctx = context(), input = messages("New system"), before = snapshot(messages(), ctx), after = snapshot(input, ctx), comparison = compare(before, after);
    const paused: Check = { id: "paused", chatId: "chat", generationId: "gen", deadline: Date.now() + 120_000, status: "waiting", comparison, before, after,
      timeline: buildTimeline(before, promptOutline(before, messages(), []), after, promptOutline(after, input, []), comparison) };
    const ui = fixture({ settings: { mode: "pause" }, check: paused, hasBaseline: true, canDecide: true }); await flush();
    click(ui.root, "Cache Diff");
    expect(ui.modal()!.querySelector(".lc-tl")).not.toBeNull(); expect(ui.root.querySelector(".lc-tl")).not.toBeNull();
    ui.dispose();
  });
  test("modal renders safe diffs, and approval sends exactly its ID", async () => {
    const ui = fixture({ settings: { mode: "pause" }, check: check(), hasBaseline: true, canDecide: true }); await flush();
    const modal = ui.modal()!; expect(modal).not.toBeNull(); expect(modal.querySelector("script")).toBeNull();
    expect(modal.textContent).toContain("<script>alert('x')</script>");
    expect(modal.querySelector(".lc-remove")?.textContent).toContain("Stable system");
    expect(modal.querySelector(".lc-add")?.textContent).toContain("New system");
    click(modal, "Send anyway"); await flush();
    expect(ui.requests.filter(r => r.operation === "decide").map(r => r.input)).toEqual([{ id: "review", allow: true }]);
    expect(ui.modal()).toBeNull(); click(ui.root, "Cache Diff"); expect(ui.root.textContent).toContain("Generating"); ui.dispose();
  });
  test("host dismissal leaves review pending; explicit cancellation still cancels and another browser cannot approve", async () => {
    const view: View = { settings: { mode: "pause" }, check: check(), hasBaseline: true, canDecide: true };
    const ui = fixture(view); await flush(); ui.dismiss(); await flush();
    expect(ui.requests.some(r => r.operation === "decide")).toBe(false);
    click(ui.root, "Cache Diff"); click(ui.root, "Cancel send"); await flush();
    expect(ui.requests.find(r => r.operation === "decide")?.input.allow).toBe(false); ui.dispose();
    const other = fixture({ ...view, canDecide: false }); await flush();
    expect(other.modal()).toBeNull(); click(other.root, "Cache Diff"); expect(other.root.textContent).toContain("browser session that started");
    expect(other.root.textContent).not.toContain("Send anyway"); other.dispose();
  });
  test("foreign chat notifications do not replace the current diff and unload removes listeners", async () => {
    const ui = fixture({ settings: { mode: "pause" }, check: check(), hasBaseline: true, canDecide: true }); await flush();
    const count = ui.requests.length;
    ui.update({ settings: { mode: "pause" }, check: null, hasBaseline: false, canDecide: false }, "other-chat"); await flush();
    expect(ui.requests.length).toBe(count); expect(ui.modal()).not.toBeNull();
    ui.dispose(); expect(ui.modal()).toBeNull(); expect(ui.requests.some(r => r.operation === "decide")).toBe(false);
  });
  test("warning mode leaves the drawer alone, since the backend shows a toast", async () => {
    const view: View = { settings: { mode: "warn" }, check: { ...check(), status: "allowed" }, hasBaseline: true, canDecide: false };
    const ui = fixture(view); await flush(); expect(ui.activations()).toBe(0); expect(ui.modal()).toBeNull(); ui.dispose();
  });
  test("multi-million-character prompts show bounded context and expandable pages", async () => {
    const current = check(), stable = "A stable line of context.\n".repeat(200_000);
    current.before!.messages[0].body = stable + "OLD\n" + stable;
    current.after.messages[0].body = stable + "NEW\n" + stable;
    const lazy = localClient(), root = renderDiff(lazy.store.pack(current, "user", "session"), lazy); await flush();
    expect(root.textContent).toContain("OLD"); expect(root.textContent).toContain("NEW");
    expect(root.textContent!.length).toBeLessThan(10_000);
    const expand = [...root.querySelectorAll("button")].find(b => b.textContent!.includes("Expand context"))!;
    const io = visibility();
    try {
      expand.click(); await flush(); expect(root.querySelectorAll(".lc-diff-row").length).toBeLessThanOrEqual(110);
      expect(root.querySelectorAll(".lc-diff-row").length).toBeGreaterThan(100);
      expect([...root.querySelectorAll("button")].some(b => /page/i.test(b.textContent!))).toBe(false);
      await io.reveal(); await flush(); expect(root.querySelectorAll(".lc-diff-row").length).toBeGreaterThan(200);
      expand.click(); await flush(); expect(root.querySelectorAll(".lc-diff-row").length).toBeLessThan(15);
    } finally { io.restore(); }
  });
  test("reference prompts open one bounded message at a time and do not label all content as additions", async () => {
    const lazy = localClient(), value = snapshot(Array.from({ length: 20 }, (_, i) => ({ role: "system", content: `Message ${i}\n`.repeat(500) })), context());
    const io = visibility();
    try {
      const root = renderPrompt(lazy.store.pack(value, "user", "session"), lazy); await flush();
      expect(root.querySelectorAll("details.lc-change[open]")).toHaveLength(1);
      expect(root.querySelectorAll(".lc-add")).toHaveLength(0);
      expect(root.querySelectorAll(".lc-diff-row").length).toBeLessThanOrEqual(100);
      expect(root.querySelector(".lc-change > summary")!.textContent).toBe("System · message 1");
    } finally { io.restore(); }
  });
  test("whitespace markers reveal trailing spaces and newline-only changes without adding internal headers", async () => {
    const current = check(); current.before!.messages[0].body = "line "; current.after.messages[0].body = "line\n";
    const lazy = localClient(), root = renderDiff(lazy.store.pack(current, "user", "session"), lazy); await flush(); const toggle = root.querySelector("input")!;
    expect(root.querySelector(".lc-diff")!.textContent).not.toContain("contentKind");
    toggle.checked = true; toggle.dispatchEvent(new window.Event("change") as unknown as Event);
    expect(root.querySelector(".lc-remove")!.textContent).toContain("line·");
    expect(root.querySelector(".lc-add")!.textContent).toContain("line↵");
    toggle.checked = false; toggle.dispatchEvent(new window.Event("change") as unknown as Event);
    expect(root.querySelector(".lc-add .lc-line-text")!.textContent).toBe("+ line\n");
  });
});
