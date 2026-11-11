import { describe, expect, test } from "bun:test";
import { Guard } from "../src/guard";
import { context, messages } from "./fixtures";
import type { BaselinePersistence, SavedBaseline } from "../src/baseline";
const pause = { mode: "pause" as const };
/** Lets inspect() receive its check ID from the host and reach the review. */
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
async function baseline(guard: Guard) {
  const ctx = context(); const input = messages();
  expect(await guard.inspect(input, ctx, pause)).toBe(input);
  expect(guard.view("user", "chat").hasBaseline).toBe(false);
  guard.finish(ctx.userId, ctx.generationId, true);
  return ctx;
}
describe("pre-send guard", () => {
  test("changed prompt blocks until an exact, session-owned decision; cancelled requests keep the baseline", async () => {
    const guard = new Guard(() => {}); await baseline(guard);
    const ctx = context(), input = messages("Changed"), pending = guard.inspect(input, ctx, pause); await flush();
    const check = guard.view("user", "chat", "browser").check!;
    expect(check.status).toBe("waiting");
    expect(() => guard.decide("other", "browser", check.id, true)).toThrow();
    expect(() => guard.decide("user", "other-browser", check.id, true)).toThrow();
    expect(guard.view("user", "chat", "other-browser").canDecide).toBe(false);
    guard.decide("user", "browser", check.id, false);
    await expect(pending).rejects.toThrow("cancelled");
    expect(guard.view("user", "chat").check!.status).toBe("cancelled");
    const next = context(); await guard.inspect(messages(), next, pause);
    expect(guard.view("user", "chat").check!.comparison.kind).toBe("same");
    guard.finish("user", next.generationId, true);
  });
  test("allowing one request does not authorize another and only success advances the baseline", async () => {
    const guard = new Guard(() => {}); await baseline(guard);
    for (const success of [false, true]) {
      const ctx = context(), input = messages("Changed"), pending = guard.inspect(input, ctx, pause); await flush();
      const check = guard.view("user", "chat").check!;
      expect(check.status).toBe("waiting"); guard.decide("user", "browser", check.id, true);
      expect(await pending).toBe(input);
      expect(() => guard.decide("user", "browser", check.id, true)).toThrow();
      guard.finish("user", ctx.generationId, success);
    }
    const ctx = context(); await guard.inspect(messages("Changed"), ctx, pause);
    expect(guard.view("user", "chat").check!.comparison.kind).toBe("same");
    guard.finish("user", ctx.generationId, true);
  });
  test("a new planned epoch passes once, then accidents still pause", async () => {
    const guard = new Guard(() => {});
    const first = context(); await guard.inspect(messages(), first, pause, "e1"); guard.finish("user", first.generationId, true);
    const planned = context(), input = messages("Changed");
    expect(await guard.inspect(input, planned, pause, "e2")).toBe(input);
    expect(guard.view("user", "chat").check!.status).toBe("allowed");
    guard.finish("user", planned.generationId, true);
    const accident = guard.inspect(messages("Accident"), context(), pause, "e2"); await flush();
    const check = guard.view("user", "chat", "browser").check!;
    expect(check.status).toBe("waiting");
    guard.decide("user", "browser", check.id, false);
    await expect(accident).rejects.toThrow("cancelled");
  });
  test("a new planned epoch releases force consistency instead of restoring the old prefix", async () => {
    const guard = new Guard(() => {}), settings = { ...pause, forceConsistency: true };
    const first = context(); await guard.inspect(messages(), first, settings, "e1"); guard.finish("user", first.generationId, true);
    const planned = context(), input = messages("Changed");
    expect(await guard.inspect(input, planned, settings, "e2")).toBe(input);
    guard.finish("user", planned.generationId, true);
  });
  test("a failed planned request keeps the epoch pending for its retry", async () => {
    const guard = new Guard(() => {});
    const first = context(); await guard.inspect(messages(), first, pause, "e1"); guard.finish("user", first.generationId, true);
    const failed = context(); await guard.inspect(messages("Changed"), failed, pause, "e2"); guard.finish("user", failed.generationId, false);
    const retry = context(), input = messages("Changed");
    expect(await guard.inspect(input, retry, pause, "e2")).toBe(input);
    expect(guard.view("user", "chat").check!.status).toBe("allowed");
    guard.finish("user", retry.generationId, true);
  });
  test("abort and expired review cannot leak the provider request", async () => {
    const guard = new Guard(() => {}); await baseline(guard);
    const controller = new AbortController();
    const pending = guard.inspect(messages("Changed"), context({ signal: controller.signal }), pause); await flush();
    const id = guard.view("user", "chat").check!.id; controller.abort();
    await expect(pending).rejects.toThrow("stopped");
    expect(() => guard.decide("user", "browser", id, true)).toThrow();
    await expect(guard.inspect(messages("Changed"), context({ interceptorDeadlineAt: Date.now() + 1001 }), pause)).rejects.toThrow("expired");
  });
  test("missing frontend pauses for a returning browser; warn, off and dry runs have explicit behavior", async () => {
    const guard = new Guard(() => {}); await baseline(guard);
    const pending = guard.inspect(messages("Changed"), context({ frontendSessionId: undefined }), pause); await flush();
    const id = guard.view("user", "chat").check!.id;
    expect(guard.view("user", "chat").canDecide).toBe(false);
    expect(() => guard.decide("user", undefined, id, true)).toThrow();
    guard.resume("user", "chat", "returned"); guard.decide("user", "returned", id, false);
    await expect(pending).rejects.toThrow("cancelled");
    const before = guard.view("user", "chat").check;
    await guard.inspect(messages("Different"), context({ isDryRun: true }), pause);
    await guard.inspect(messages("Different"), context(), { mode: "off" });
    expect(guard.view("user", "chat").check).toBe(before);
    const ctx = context(); await guard.inspect(messages("Different"), ctx, { mode: "warn" });
    expect(guard.view("user", "chat").check).toMatchObject({ status: "allowed", comparison: { kind: "break" } });
    guard.finish("user", ctx.generationId, true);
  });
  test("disconnect releases review ownership without cancelling or allowing the request", async () => {
    const guard = new Guard(() => {}); await baseline(guard);
    const ctx = context(), pending = guard.inspect(messages("Changed"), ctx, pause); await flush();
    const id = guard.view("user", "chat", "browser").check!.id;
    guard.resume("user", "chat", "other-browser");
    expect(guard.view("user", "chat", "other-browser").canDecide).toBe(false);
    guard.disconnect("other-user", "browser");
    expect(guard.view("user", "chat", "browser").canDecide).toBe(true);
    guard.disconnect("user", "browser");
    expect(guard.view("user", "chat", "browser").check!.status).toBe("waiting");
    expect(() => guard.decide("user", "browser", id, true)).toThrow();
    guard.resume("other-user", "chat", "foreign");
    expect(guard.view("user", "chat").canDecide).toBe(false);
    guard.resume("user", "chat", "reopened"); guard.disconnect("user", "browser");
    expect(guard.view("user", "chat", "reopened").canDecide).toBe(true);
    guard.decide("user", "reopened", id, true); await pending;
    guard.disconnect("user", "reopened"); guard.finish("user", ctx.generationId, true);
    expect(guard.view("user", "chat").check!.status).toBe("completed");
  });
  test("failed UI notification cannot cancel an allowed generation or prevent baseline promotion", async () => {
    const guard = new Guard(() => { throw Error("Frontend disconnected"); });
    await baseline(guard);
    const ctx = context(); await guard.inspect(messages(), ctx, pause);
    guard.finish("user", ctx.generationId, true);
    expect(guard.view("user", "chat").check!.status).toBe("completed");
  });
  test("baselines, pending approvals and terminal events stay isolated by user and chat", async () => {
    const guard = new Guard(() => {}); const first = await baseline(guard);
    const ctx = context({ userId: "other" }); await guard.inspect(messages("Different"), ctx, pause);
    expect(guard.view("other", "chat").check!.comparison.kind).toBe("first");
    guard.finish("user", ctx.generationId, true);
    expect(guard.view("other", "chat").hasBaseline).toBe(false);
    guard.finish("other", ctx.generationId, true);
    const alternate = context({ chatId: "other-chat" }); await guard.inspect(messages("Different"), alternate, pause);
    expect(guard.view("user", "other-chat").check!.comparison.kind).toBe("first");
    guard.finish("user", first.generationId, false);
    expect(guard.view("user", "chat").check!.status).toBe("completed");
    guard.finish("user", alternate.generationId, true);
  });
  test("active requests cannot overlap, be cleared or be evicted", async () => {
    const guard = new Guard(() => {}); const ctx = context(); await guard.inspect(messages(), ctx, pause);
    await expect(guard.inspect(messages(), context(), pause)).rejects.toThrow("already inspecting");
    expect(() => guard.clear("user", "chat")).toThrow("Finish or stop");
    for (let i = 0; i < 20; i++) {
      const next = context({ chatId: `chat-${i}` }); await guard.inspect(messages(), next, pause); guard.finish("user", next.generationId, true);
    }
    expect(guard.view("user", "chat").check!.generationId).toBe(ctx.generationId);
    guard.finish("user", ctx.generationId, true); guard.clear("user", "chat");
    expect(guard.view("user", "chat").hasBaseline).toBe(false);
  });
  test("large prompt budgets evict idle chats without dropping an active generation", async () => {
    const guard = new Guard(() => {}), text = "x".repeat(30_000_000);
    const busy = context({ chatId: "busy-large" }); await guard.inspect(messages(text), busy, pause);
    for (let i = 0; i < 5; i++) {
      const ctx = context({ chatId: `large-${i}` }); await guard.inspect(messages(text), ctx, pause); guard.finish("user", ctx.generationId, true);
    }
    expect(guard.view("user", "busy-large").check!.generationId).toBe(busy.generationId);
    expect(guard.view("user", "large-0").hasBaseline).toBe(false);
    expect(guard.view("user", "large-4").hasBaseline).toBe(true);
    guard.finish("user", busy.generationId, true);
  });

});

function memoryStore() {
  const files = new Map<string, SavedBaseline>(), cleared: string[] = [];
  const store: BaselinePersistence = {
    load: async (user, chat, scope) => files.get(JSON.stringify([user, chat, scope])) ?? null,
    save: (user, chat, scope, saved) => { files.set(JSON.stringify([user, chat, scope]), saved); },
    clear: (_user, chat) => { cleared.push(chat); files.clear(); },
  };
  return { store, files, cleared };
}
test("a restart compares against the exact prompt of the last successful send", async () => {
  const { store } = memoryStore(), first = new Guard(() => {}, undefined, store);
  await baseline(first);
  const restarted = new Guard(() => {}, undefined, store);
  await restarted.inspect(messages(), context(), pause);
  const view = restarted.view("user", "chat");
  expect(view.check!.comparison.kind).toBe("same"); expect(view.hasBaseline).toBe(true);
});
test("only successful sends are saved, and a failed read falls back to a first request", async () => {
  const { store, files } = memoryStore(), guard = new Guard(() => {}, undefined, store), ctx = context();
  await guard.inspect(messages(), ctx, pause);
  guard.finish(ctx.userId, ctx.generationId, false);
  expect(files.size).toBe(0);
  const failing = new Guard(() => {}, undefined, { ...store, load: async () => { throw new Error("Storage unavailable"); } });
  await failing.inspect(messages(), context(), pause);
  expect(failing.view("user", "chat").check!.comparison.kind).toBe("first");
});
test("each CAT profile restores its own baseline", async () => {
  const { store, files } = memoryStore(), guard = new Guard(() => {}, undefined, store), ctx = { ...context(), scope: "cat" };
  await guard.inspect(messages(), ctx, pause);
  guard.finish(ctx.userId, ctx.generationId, true);
  expect([...files.keys()]).toEqual([JSON.stringify(["user", "chat", "cat"])]);
  const restarted = new Guard(() => {}, undefined, store);
  await restarted.inspect(messages(), context(), pause);
  expect(restarted.view("user", "chat").check!.comparison.kind).toBe("first");
});
test("a manual reset also removes the saved baseline", async () => {
  const { store, files, cleared } = memoryStore(), guard = new Guard(() => {}, undefined, store);
  await baseline(guard);
  guard.clear("user", "chat");
  expect(cleared).toEqual(["chat"]); expect(files.size).toBe(0);
});
test("a send with monitoring off makes the next one ask the saved file again", async () => {
  const { store, files } = memoryStore(), guard = new Guard(() => {}, undefined, store);
  await baseline(guard);
  guard.unwatched("user", "chat");
  expect(guard.view("user", "chat").hasBaseline).toBe(false);
  files.clear();
  await guard.inspect(messages(), context(), pause);
  expect(guard.view("user", "chat").check!.comparison.kind).toBe("first");
});
test("a compared check carries a timeline, and a first request does not", async () => {
  const guard = new Guard(() => {});
  expect(await guard.inspect(messages(), context(), { mode: "warn" })).toBeDefined();
  expect(guard.view("user", "chat").check!.timeline).toBeUndefined();
  const ctx = context();
  const second = new Guard(() => {});
  await baseline(second);
  await second.inspect(messages("A changed system prompt"), ctx, { mode: "warn" });
  const timeline = second.view("user", "chat").check!.timeline!;
  expect(timeline.rows.some(row => row.status === "changed" && row.root)).toBe(true);
});
const settled = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
test("warn mode sends at once and shows the break depth and the tokens to recache", async () => {
  const toasts: string[][] = [];
  const guard = new Guard(() => {}, async tail => ({ total_tokens: tail.length * 1000, approximate: false }), undefined, (user, _tone, title, message) => { toasts.push([user, title, message]); });
  await baseline(guard);
  const input = messages("A changed system prompt");
  expect(await guard.inspect(input, context(), { mode: "warn" })).toBe(input);
  await settled();
  expect(toasts).toEqual([["user", `Cache has been broken at depth ${input.length}!`, `${(input.length * 1000).toLocaleString("en-US")} tokens will be recached 💸.`]]);
});
test("no warning for a first request or in pause mode", async () => {
  const toasts: string[] = [], warn = (_user: string, _tone: string, title: string) => { toasts.push(title); };
  const guard = new Guard(() => {}, undefined, undefined, warn);
  await guard.inspect(messages(), context(), { mode: "warn" }); await settled();
  expect(toasts).toEqual([]);
  const paused = new Guard(() => {}, undefined, undefined, warn);
  await baseline(paused);
  void paused.inspect(messages("Changed"), context(), pause).catch(() => {}); await settled();
  expect(toasts).toEqual([]);
  paused.disconnect("user", "browser");
});
test("a failed token count still warns, marked as an estimate", async () => {
  const toasts: string[] = [];
  const guard = new Guard(() => {}, async () => { throw new Error("Tokenizer unavailable"); }, undefined, (_user, _tone, _title, message) => { toasts.push(message); });
  await baseline(guard);
  await guard.inspect(messages("Changed"), context(), { mode: "warn" }); await settled();
  expect(toasts).toHaveLength(1); expect(toasts[0]).toMatch(/^~[\d,]+ tokens will be recached/);
});
test("the timed refresh needs force consistency, so it cannot hide a real break", async () => {
  const toasts: string[] = [], guard = new Guard(() => {}, undefined, undefined, (_user, _tone, title) => { toasts.push(title); });
  await baseline(guard);
  await guard.inspect(messages("Changed"), context(), { mode: "warn", refreshEnabled: true, refreshEvery: 1 }); await settled();
  expect(guard.view("user", "chat").check!.policy).toBeUndefined();
  expect(toasts).toHaveLength(1);
});
test("a planned LumiBooks break does not warn or pause, and toasts once on the send that sees it", async () => {
  for (const mode of ["warn", "pause"] as const) {
    const toasts: string[][] = [];
    const guard = new Guard(() => {}, async tail => ({ total_tokens: tail.length * 1000, approximate: false }), undefined, (_user, tone, title, message) => { toasts.push([tone, title, message]); });
    await baseline(guard);
    const input = messages("Changed"), ctx = context();
    expect(await guard.inspect(input, ctx, { mode }, "epoch-2")).toBe(input); await settled();
    expect(guard.view("user", "chat").check!.policy).toMatchObject({ action: "refresh", accepted: true });
    expect(toasts).toEqual([["success", "LumiBooks Compaction Successful.", `Gracefully re-caching ${(input.length * 1000).toLocaleString("en-US")} tokens 💖.`]]);
    guard.finish(ctx.userId, ctx.generationId, true);
    await guard.inspect(input, context(), { mode }, "epoch-2"); await settled();
    expect(toasts).toHaveLength(1);
  }
});
test("no compaction toast when nothing is recached, or with monitoring off", async () => {
  const toasts: string[] = [], guard = new Guard(() => {}, undefined, undefined, (_user, _tone, title) => { toasts.push(title); });
  await baseline(guard);
  await guard.inspect(messages(), context(), { mode: "warn" }, "epoch-2"); await settled();
  await guard.inspect(messages("Changed"), context(), { mode: "off" }, "epoch-3"); await settled();
  expect(toasts).toEqual([]);
});
