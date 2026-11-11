import { expect, test } from "bun:test";
import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { Bridge } from "../src/ui/bridge";

function client(uuid?: { v4(): string; v7(): string }) {
  let listener: (raw: unknown) => void = () => {};
  const ids: string[] = [];
  const ctx = { uuid, onBackendMessage: (fn: typeof listener) => { listener = fn; return () => {}; },
    sendToBackend: (request: { id: string }) => { ids.push(request.id); listener({ type: "reply", id: request.id, value: "ok" }); } };
  return { bridge: new Bridge(ctx as unknown as SpindleFrontendContext), ids };
}
/** Browsers leave randomUUID undefined outside a secure context, such as a phone reaching the PC over plain HTTP. */
async function overPlainHttp(run: () => Promise<void>) {
  Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  try { await run(); } finally { Reflect.deleteProperty(crypto, "randomUUID"); }
}

test("requests use the host's frontend UUID over plain HTTP", () => overPlainHttp(async () => {
  const { bridge, ids } = client({ v4: () => "host-id", v7: () => "unused" });
  expect(await bridge.call("agentPresence", {}) as unknown).toBe("ok");
  expect(ids).toEqual(["host-id"]);
}));
test("older hosts without ctx.uuid still get distinct request IDs over plain HTTP", () => overPlainHttp(async () => {
  const { bridge, ids } = client();
  await bridge.call("agentPresence", {}); await bridge.call("agentPresence", {});
  expect(new Set(ids).size).toBe(2);
}));
test("an ID failure rejects the request instead of throwing into the caller", async () => {
  const { bridge } = client({ v4: () => { throw new Error("Extension is not active."); }, v7: () => "unused" });
  await expect(bridge.call("agentPresence", {})).rejects.toThrow("not active");
});
