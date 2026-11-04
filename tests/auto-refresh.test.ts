import { describe, expect, test } from "bun:test";
import { AutoRefresh, type RefreshPrompt } from "../src/auto-refresh";
import { Guard } from "../src/guard";
import { DEFAULT_SETTINGS, type KeepWarmState } from "../src/shared";
import { validateSettings } from "../src/settings";
import { context, messages } from "./fixtures";

const on = { ...DEFAULT_SETTINGS, autoRefreshEnabled: true, autoRefreshMinutes: 1, autoRefreshLimit: 2 };
const prompt: RefreshPrompt = { messages: messages(), connectionId: "connection", model: "model" };
const settle = (ms = 40) => new Promise(resolve => setTimeout(resolve, ms));
function setup(overrides: { result?: () => unknown; parameters?: Record<string, unknown>; model?: string; busy?: () => boolean; prompt?: () => RefreshPrompt | null } = {}) {
  const calls: Record<string, any>[] = [], toasts: { tone: string; title: string; message: string }[] = [], states: (KeepWarmState | null)[] = [];
  const auto = new AutoRefresh({
    generate: {
      dryRun: (async () => ({ model: overrides.model ?? "model", provider: "custom", messages: [], breakdown: [], parameters: overrides.parameters ?? { temperature: 1, max_tokens: 500, max_context_length: 9000 } })) as never,
      quiet: (async (input: Record<string, any>) => { calls.push(input); return overrides.result ? overrides.result() : { usage: { provider_raw: { cache_read_input_tokens: 1234 } } }; }) as never,
    },
    prompt: overrides.prompt ?? (() => prompt), busy: overrides.busy ?? (() => false),
    toast: (_user, tone, title, message) => { toasts.push({ tone, title, message }); }, changed: (_user, state) => { states.push(state); },
  }, 5);
  return { auto, calls, toasts, states };
}
describe("cache auto-refresh", () => {
  test("is off by default, and settings reject bad values", () => {
    const value = validateSettings({ mode: "warn" });
    expect(value.autoRefreshEnabled).toBe(false);
    expect(() => validateSettings({ mode: "warn", autoRefreshMinutes: 0 })).toThrow();
    expect(() => validateSettings({ mode: "warn", autoRefreshLimit: 1.5 })).toThrow();
    expect(() => validateSettings({ mode: "warn", autoRefreshEnabled: "yes" })).toThrow();
    const { auto, calls } = setup();
    auto.start("user", "chat", value);
    return settle().then(() => expect(calls).toEqual([]));
  });
  test("replays the exact prompt with one output token and stops at the limit", async () => {
    const { auto, calls, toasts } = setup();
    auto.start("user", "chat", on); await settle(60);
    expect(calls.length).toBe(2);
    expect(calls[0].messages).toBe(prompt.messages);
    expect(calls[0].connection_id).toBe("connection");
    expect(calls[0].parameters).toEqual({ temperature: 1, max_tokens: 1, model: "model" });
    expect(toasts.map(toast => toast.title)).toEqual(["Cache kept warm (1 of 2)", "Cache kept warm (2 of 2)"]);
  });
  test("reports each step, so the banner can follow it and clear when it ends", async () => {
    const { auto, states } = setup();
    auto.start("user", "chat", { ...on, autoRefreshLimit: 1 });
    expect(auto.state("user")).toMatchObject({ chatId: "chat", done: 0, limit: 1 });
    expect(states[0]!.nextIn).toBeGreaterThan(0);
    await settle(30);
    expect(states.some(state => state?.nextIn === null)).toBe(true);
    expect(states.at(-1)).toBeNull();
    expect(auto.state("user")).toBeNull();
  });
  test("restart applies new settings to a running job, and turning off stops it", async () => {
    const { auto, calls, states } = setup();
    auto.restart("user", on);
    expect(auto.state("user")).toBeNull();
    auto.start("user", "chat", { ...on, autoRefreshMinutes: 1000 });
    auto.restart("user", { ...on, autoRefreshLimit: 7 });
    expect(auto.state("user")).toMatchObject({ chatId: "chat", limit: 7 });
    auto.restart("user", { ...on, autoRefreshEnabled: false });
    expect(auto.state("user")).toBeNull();
    expect(states.at(-1)).toBeNull();
    await settle(20);
    expect(calls).toEqual([]);
  });
  test("a new reply starts the count over, and only the latest chat runs", async () => {
    const { auto, calls } = setup();
    auto.start("user", "a", { ...on, autoRefreshLimit: 1 }); await settle(30);
    expect(calls.length).toBe(1);
    auto.start("user", "a", { ...on, autoRefreshLimit: 1 }); auto.start("user", "b", { ...on, autoRefreshLimit: 1 }); await settle(30);
    expect(calls.length).toBe(2);
  });
  test("leaves room for a fixed thinking budget", async () => {
    const { auto, calls } = setup({ parameters: { thinking: { type: "enabled", budget_tokens: 2000 } } });
    auto.start("user", "chat", { ...on, autoRefreshLimit: 1 }); await settle(30);
    expect(calls[0].parameters.max_tokens).toBe(2001);
  });
  test("stops after a cache miss, a failure or a model change", async () => {
    const miss = setup({ result: () => ({ usage: { provider_raw: { cache_read_input_tokens: 0, cache_creation_input_tokens: 900 } } }) });
    miss.auto.start("user", "chat", on); await settle(60);
    expect(miss.calls.length).toBe(1); expect(miss.toasts[0]!.tone).toBe("warning");
    const failed = setup({ result: () => { throw new Error("Provider said no"); } });
    failed.auto.start("user", "chat", on); await settle(60);
    expect(failed.calls.length).toBe(1); expect(failed.toasts[0]!.message).toBe("Provider said no");
    const moved = setup({ model: "other" });
    moved.auto.start("user", "chat", on); await settle(60);
    expect(moved.calls.length).toBe(0); expect(moved.toasts[0]!.tone).toBe("warning");
  });
  test("providers that report no cache numbers keep going", async () => {
    const { auto, calls } = setup({ result: () => ({ usage: {} }) });
    auto.start("user", "chat", on); await settle(60);
    expect(calls.length).toBe(2);
  });
  test("waits while the chat is generating, and ends when it has no prompt or is cancelled", async () => {
    let busy = true;
    const waiting = setup({ busy: () => busy });
    waiting.auto.start("user", "chat", { ...on, autoRefreshLimit: 1 }); await settle(20);
    expect(waiting.calls.length).toBe(0);
    busy = false; await settle(20);
    expect(waiting.calls.length).toBe(1);
    const empty = setup({ prompt: () => null });
    empty.auto.start("user", "chat", on); await settle(20);
    expect(empty.calls.length).toBe(0); expect(empty.toasts).toEqual([]);
    const cancelled = setup();
    cancelled.auto.start("user", "chat", on); cancelled.auto.cancel("user", "other"); cancelled.auto.cancel("user", "chat"); await settle(20);
    expect(cancelled.calls.length).toBe(0);
  });
  test("a generation aborts the replay in flight without using up a refresh", async () => {
    let signal: AbortSignal | undefined, release = () => {};
    const toasts: string[] = [];
    let calls = 0;
    const auto = new AutoRefresh({
      generate: {
        dryRun: (async () => ({ model: "model", parameters: {} })) as never,
        quiet: ((input: { signal: AbortSignal }) => { calls++; signal = input.signal; return calls > 1 ? Promise.resolve({}) : new Promise((_resolve, reject) => { release = () => reject(new Error("aborted")); input.signal.addEventListener("abort", release); }); }) as never,
      },
      prompt: () => prompt, busy: () => false, toast: (_user, _tone, title) => { toasts.push(title); }, changed: () => {},
    }, 5);
    auto.start("user", "chat", { ...on, autoRefreshLimit: 1 }); await settle(15);
    expect(calls).toBe(1);
    auto.interrupt("user", "chat"); expect(signal!.aborted).toBe(true); await settle(20);
    expect(calls).toBe(2);
    expect(toasts).toEqual(["Cache kept warm (1 of 1)"]);
  });
  test("the guard offers only the last successful native prompt", async () => {
    const guard = new Guard(() => {}), ctx = context(), input = messages();
    expect(guard.prompt("user", "chat")).toBeNull();
    await guard.inspect(input, ctx, { mode: "warn" });
    expect(guard.prompt("user", "chat")).toBeNull();
    expect(guard.finish("user", ctx.generationId, true)).toBe(true);
    expect(guard.prompt("user", "chat")).toEqual({ messages: input, connectionId: "connection", model: "model" });
    const failed = context(); await guard.inspect(messages("Changed"), failed, { mode: "warn" });
    expect(guard.finish("user", failed.generationId, false)).toBe(false);
    expect(guard.prompt("user", "chat")!.messages).toEqual(input);
    expect(guard.finish("user", "unknown", true)).toBe(false);
  });
});
