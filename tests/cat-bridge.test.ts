import { describe, expect, test } from "bun:test";
import type { LlmMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { CAT_EXTENSION, CatBridge } from "../src/cat-bridge";
import { Guard } from "../src/guard";
import { messages } from "./fixtures";

function fixture(mode: "pause" | "warn" | "off" = "pause") {
  const epoch: { value: string | null } = { value: null };
  const synced = new Map<string, any>();
  let handler!: (ctx: { requesterExtensionId: string; endpoint: string }) => Promise<unknown>;
  const api = {
    connections: { get: async (id: string) => ({ id, provider: "custom", api_url: "https://example.invalid/v1", updated_at: 1 }) },
    rpcPool: {
      handle: (_name: string, fn: typeof handler) => { handler = fn; return "lumicache.cat"; },
      read: async () => synced.get("request"),
      sync: (name: string, value: unknown) => { synced.set(name, value); return name; },
      unregister: (name: string) => { synced.delete(name); },
    },
  } as unknown as Pick<SpindleAPI, "rpcPool" | "connections">;
  const guard = new Guard(() => {});
  const bridge = new CatBridge(api, guard, async () => ({ mode }), async () => epoch.value).register(1);
  const send = async (request: unknown, requester = CAT_EXTENSION) => {
    synced.set("request", request);
    await handler({ requesterExtensionId: requester, endpoint: "lumicache.cat" });
    bridge.drain();
  };
  const result = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const value = synced.get(`cat_result.${id}`);
      if (value) return value;
      await Bun.sleep(1);
    }
    throw new Error(`No result for ${id}`);
  };
  const check = (id: string, slotId: string, input: LlmMessageDTO[]) => send({ op: "check", id, userId: "user", chatId: "chat", slotId, label: `CAT ${slotId}`, connectionId: "connection", model: "model", session: "browser", messages: input });
  const finish = (id: string, success = true) => send({ op: "finish", id, userId: "user", success });
  return { guard, synced, epoch, send, check, finish, result };
}

describe("CAT bridge", () => {
  test("rejects other extensions", async () => {
    const f = fixture();
    await expect(f.send({ op: "cancel", id: "x" }, "other")).rejects.toThrow("Unauthorized");
  });
  test("an unchanged swipe prompt passes and a changed one waits for review", async () => {
    const f = fixture();
    await f.check("one", "a", messages());
    expect((await f.result("one")).status).toBe("done");
    await f.finish("one");
    expect(f.synced.has("cat_result.one")).toBe(false);
    await f.check("two", "a", messages("Changed"));
    let view = f.guard.view("user", "chat", "browser");
    for (let i = 0; i < 100 && view.check?.status !== "waiting"; i++) { await Bun.sleep(1); view = f.guard.view("user", "chat", "browser"); }
    expect(view.check?.status).toBe("waiting");
    expect(view.check?.comparison.summary).toStartWith("CAT a:");
    f.guard.decide("user", "browser", view.check!.id, true);
    expect((await f.result("two")).status).toBe("done");
  });
  test("each profile compares against its own baseline", async () => {
    const f = fixture();
    await f.check("a1", "a", messages("Preset A")); await f.result("a1"); await f.finish("a1");
    await f.check("b1", "b", messages("Preset B")); await f.result("b1"); await f.finish("b1");
    await f.check("a2", "a", messages("Preset A"));
    expect((await f.result("a2")).status).toBe("done");
    expect(f.guard.view("user", "chat").check?.comparison.kind).toBe("same");
  });
  test("a failed swipe leaves its baseline alone", async () => {
    const f = fixture();
    await f.check("one", "a", messages()); await f.result("one"); await f.finish("one", false);
    await f.check("two", "a", messages("Changed"));
    expect((await f.result("two")).status).toBe("done");
    expect(f.guard.view("user", "chat").check?.comparison.kind).toBe("first");
  });
  test("cancelling while under review reports an error to CAT", async () => {
    const f = fixture();
    await f.check("one", "a", messages()); await f.result("one"); await f.finish("one");
    await f.check("two", "a", messages("Changed"));
    for (let i = 0; i < 100 && f.guard.view("user", "chat").check?.status !== "waiting"; i++) await Bun.sleep(1);
    await f.send({ op: "cancel", id: "two" });
    expect((await f.result("two")).status).toBe("error");
  });
  test("a swipe that never reported back does not block the next one", async () => {
    const f = fixture();
    await f.check("lost", "a", messages()); await f.result("lost");
    await f.check("next", "a", messages());
    expect((await f.result("next")).status).toBe("done");
  });
  test("a LumiBooks planned break passes without review", async () => {
    const f = fixture();
    f.epoch.value = "e1";
    await f.check("one", "a", messages()); await f.result("one"); await f.finish("one");
    f.epoch.value = "e2";
    await f.check("two", "a", messages("Changed"));
    expect((await f.result("two")).status).toBe("done");
    expect(f.guard.view("user", "chat").check?.policy?.action).toBe("refresh");
  });
  test("clearing a chat removes native and profile baselines", async () => {
    const f = fixture();
    await f.check("one", "a", messages()); await f.result("one"); await f.finish("one");
    expect(f.guard.chatIds("user")).toEqual(["chat"]);
    f.guard.clear("user", "chat");
    expect(f.guard.chatIds("user")).toEqual([]);
  });
});
