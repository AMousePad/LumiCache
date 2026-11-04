import { expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { AgentBridge, BRIDGE_PERMISSIONS, bridgeSession } from "../src/agent-bridge";
import { Guard } from "../src/guard";
import { PromptStore } from "../src/prompt-store";
import type { HealthService } from "../src/health/service";
import type { HealthReport, SimulationReport } from "../src/health/types";
import { compare, snapshot } from "../src/compare";
import { context, messages } from "./fixtures";

function fixture() {
  const sent: any[] = [], cancellations: any[] = [];
  let handler: any, policy: any, envelope: any;
  const api = { chats: { get: async (chat: string, user: string) => user === "user" && chat === "chat" ? { id: chat, name: "My chat" } : null },
    sendToFrontend: (...args: any[]) => sent.push(args), rpcPool: {
      handle: (_endpoint: string, fn: unknown, p: unknown) => { handler = fn; policy = p; }, read: async () => envelope,
    } } as unknown as SpindleAPI;
  const guard = new Guard(() => {}), prompts = new PromptStore();
  const health = { cancel: (...args: any[]) => cancellations.push(args) } as unknown as HealthService;
  const bridge = new AgentBridge(api, guard, health, prompts); bridge.register();
  const call = (action: string, extra: Record<string, unknown> = {}) => bridge.request("lumiagent", { op: "cache", userId: "user", action, ...extra }) as Promise<any>;
  const start = async (kind = "audit", callId: string = crypto.randomUUID()) => call("start", { chatId: "chat", kind, callId });
  const report: HealthReport = { chatId: "chat", at: Date.now(), preset: "Fixture", model: "model", provider: "custom", findings: [], blocksScanned: 1, entriesScanned: 0 };
  return { bridge, guard, prompts, sent, cancellations, call, start, report, policy: () => policy,
    invoke: (requester: string, request: unknown) => { envelope = request; return handler({ requesterExtensionId: requester }); } };
}
test("bridge pins the attested caller, declares only its required permissions and rejects foreign chat reads", async () => {
  const f = fixture(); expect(f.policy()).toEqual({ requires: BRIDGE_PERMISSIONS });
  await expect(f.invoke("foreign", { op: "describe" })).rejects.toThrow("Only LumiAgent");
  const description = await f.invoke("lumiagent", { op: "describe" }); expect(description.extension.id).toBe("lumicache");
  await expect(f.call("live", { chatId: "chat", userId: "foreign" })).rejects.toThrow("unavailable");
  await expect(f.call("decide", { allow: true })).rejects.toThrow("cannot approve");
  await expect(f.call("clear", { chatId: "chat" })).rejects.toThrow("cannot approve");
  expect(await f.bridge.request("lumiagent", { op: "write_field", userId: "user" })).toMatchObject({ ok: false });
});
test("guide discovery stays compact and topics are readable without a chat or diagnostic browser", async () => {
  const f = fixture(), surfaceId = "lumicache_docs";
  const describe = await f.invoke("lumiagent", { op: "describe" });
  expect(describe.surfaces.find((surface: any) => surface.id === surfaceId)).toMatchObject({ scope: "global" });
  const prompt = await f.invoke("lumiagent", { op: "system_prompt", userId: "user" });
  expect(prompt.text).toContain(surfaceId); expect(prompt.text.length).toBeLessThan(400);
  const list = await f.invoke("lumiagent", { op: "list_items", userId: "user", surfaceId });
  expect(list.items.map((item: any) => item.id)).toEqual(["overview", "policy", "health", "simulation", "agent", "integrations"]);
  expect(JSON.stringify(list).length).toBeLessThan(700);
  for (const item of list.items) {
    const request = { op: "read_item", userId: "user", surfaceId, itemId: item.id };
    const topic = await f.invoke("lumiagent", request);
    expect(typeof topic.value).toBe("string"); expect(topic.value.length).toBeGreaterThan(100);
    expect(topic.value.length).toBeLessThan(2400);
    expect(await f.invoke("lumiagent", { ...request, field: "text" })).toEqual(topic);
    await expect(f.invoke("foreign", request)).rejects.toThrow("Only LumiAgent");
    expect(await f.invoke("lumiagent", { ...request, op: "write_field", field: "text", value: "changed" })).toMatchObject({ ok: false });
    expect(await f.invoke("lumiagent", request)).toEqual(topic);
  }
  await expect(f.invoke("lumiagent", { op: "read_item", userId: "user", surfaceId, itemId: "missing" })).rejects.toThrow("Unknown LumiCache guide topic");
  await expect(f.invoke("lumiagent", { op: "read_item", userId: "user", surfaceId, itemId: "overview", field: "invalid" })).rejects.toThrow("field omitted or text");
  await expect(f.invoke("lumiagent", { op: "list_items", userId: "user", surfaceId: "unknown" })).rejects.toThrow("Unknown LumiCache surface");
  expect(f.sent).toEqual([]);
});
test("diagnostics require browser presence, bind the canonical request and deduplicate starts", async () => {
  const f = fixture(); await expect(f.start()).rejects.toThrow("Open Lumiverse");
  f.bridge.presence("user", "browser", { chatId: "chat", connectionId: "chat-model" });
  const job = await f.start("audit", "call-1"); expect(job.phase).toBe("queued");
  expect(f.sent[0]).toEqual([{ type: "agentDiagnostic", id: job.id }, "user", { frontendSessionId: "browser" }]);
  expect((await f.start("audit", "call-1")).id).toBe(job.id);
  await expect(f.start("simulation", "call-1")).rejects.toThrow("different request");
  await expect(f.start()).rejects.toThrow("already active");
  expect(() => f.bridge.claim("other", "browser", job.id)).toThrow("another user");
  expect(() => f.bridge.claim("user", "other", job.id)).toThrow("another user");
  const claimed = f.bridge.claim("user", "browser", job.id);
  expect(claimed).toEqual({ kind: "audit", input: { chatId: "chat", connectionId: "chat-model" } });
  expect(() => f.bridge.claim("user", "browser", job.id)).toThrow("already claimed");
  expect(() => f.bridge.authorize("user", "browser", job.id, "simulation", claimed.input)).toThrow("approved request");
  expect(() => f.bridge.authorize("user", "browser", job.id, "audit", { chatId: "chat" })).toThrow("approved request");
  f.bridge.authorize("user", "browser", job.id, "audit", claimed.input);
  f.bridge.auditResult("user", f.report, job.id); expect((await f.call("job", { jobId: job.id })).phase).toBe("completed");
  expect((await f.call("report", { chatId: "chat" })).audit.model).toBe("model");
});
test("queued cancellation cannot be claimed and running audit cancellation waits for its preview", async () => {
  const f = fixture(); f.bridge.presence("user", "b", {});
  const queued = await f.start(); await f.call("cancel", { jobId: queued.id }); expect(() => f.bridge.claim("user", "b", queued.id)).toThrow("cancelled");
  const active = await f.start(); f.bridge.claim("user", "b", active.id);
  expect((await f.call("cancel", { jobId: active.id })).phase).toBe("cancelling");
  f.bridge.auditResult("user", f.report, active.id); expect((await f.call("job", { jobId: active.id })).phase).toBe("cancelled");
});
test("simulation waits for profile cleanup, propagates errors and exposes bounded references", async () => {
  const f = fixture(); f.bridge.presence("user", "b", { chatId: "chat" });
  const job = await f.start("simulation"), claim = f.bridge.claim("user", "b", job.id);
  f.bridge.authorize("user", "b", job.id, "simulation", claim.input);
  f.bridge.attach("user", "b", job.id, { id: "ticket", sourceChatId: "chat", lastMessageId: "m", branchName: "test" });
  f.bridge.submitted("user", "b", "ticket", "scratch");
  const large = snapshot(messages("cache ".repeat(1_000_000)), context());
  const result: SimulationReport = { sourceChatId: "chat", at: Date.now(), seed: "ticket", complete: true, health: f.report, history: [], limitations: [],
    steps: [{ name: "Baseline", purpose: "Reference", inputs: [], snapshot: large, comparison: compare(null, large), changedSources: [] }] };
  f.bridge.simulationResult("user", "b", "ticket", result);
  expect((await f.call("job", { jobId: job.id })).phase).toBe("cleaning");
  const stored = await f.call("report", { chatId: "chat" }); expect(JSON.stringify(stored).length).toBeLessThan(3000);
  const ref = stored.simulation.steps[0].snapshot.reference;
  const diff = await f.call("diff_open", { after: ref, newIndex: 0 }); expect(diff.page.items).toHaveLength(20);
  const page = await f.call("diff_page", { diffId: diff.id, cursor: diff.page.next }); expect(page.items).toHaveLength(20);
  await expect(f.call("diff_open", { after: f.prompts.expose(large, "user", "b").reference, newIndex: 0 })).rejects.toThrow("another browser");
  await expect(f.call("diff_page", { userId: "foreign", diffId: diff.id })).rejects.toThrow("expired");
  f.bridge.finish("user", "b", job.id, { cleanupError: "Profile cleanup failed", scratchChatId: "scratch" });
  expect((await f.call("job", { jobId: job.id }))).toMatchObject({ phase: "failed", error: "Profile cleanup failed", scratchChatId: "scratch" });
  expect((await f.call("report", { chatId: "chat" })).simulation.cleanupError).toBe("Profile cleanup failed");
});
test("browser cancellation is reflected in the agent job after native cleanup", async () => {
  const f = fixture(); f.bridge.presence("user", "b", {});
  const job = await f.start("simulation"); f.bridge.claim("user", "b", job.id);
  f.bridge.attach("user", "b", job.id, { id: "ticket", sourceChatId: "chat", lastMessageId: "m", branchName: "copy" });
  f.bridge.submitted("user", "b", "ticket", "scratch");
  f.bridge.cancelledTicket("user", "b", "ticket");
  expect((await f.call("job", { jobId: job.id })).phase).toBe("cancelling");
  f.bridge.finish("user", "b", job.id, { error: "Simulation cancelled" });
  expect((await f.call("job", { jobId: job.id })).phase).toBe("cancelled");
});
test("an agent can inspect a paused diff but cannot approve or cancel the live send", async () => {
  const f = fixture(), first = context(); await f.guard.inspect(messages(), first, { mode: "pause" }); f.guard.finish("user", first.generationId, true);
  const changed = context(), waiting = f.guard.inspect(messages("different"), changed, { mode: "pause" });
  const live = await f.call("live", { chatId: "chat" }); expect(live.check.status).toBe("waiting"); expect(live.canDecide).toBe(false);
  expect(() => f.guard.decide("user", bridgeSession("user"), live.check.id, true)).toThrow("another browser");
  await expect(f.call("cancel", { jobId: live.check.id })).rejects.toThrow("expired");
  const listed = await f.call("diff_list", { before: live.check.before.reference, after: live.check.after.reference }); expect(listed.total).toBe(1);
  f.guard.decide("user", changed.frontendSessionId, live.check.id, false); await expect(waiting).rejects.toThrow("cancelled");
});
test("cached audit findings paginate and expired browser leases cannot start work", async () => {
  const f = fixture(); f.report.findings = Array.from({ length: 65 }, (_, i) => ({ id: String(i), level: "risk", title: "Risk", source: "Fixture", detail: "Details", suggestion: "Inspect" }));
  f.bridge.auditResult("user", f.report);
  expect((await f.call("report", { chatId: "chat" })).audit.findings).toHaveLength(30);
  expect((await f.call("findings", { chatId: "chat", kind: "audit", cursor: 60 })).findings).toHaveLength(5);
  f.bridge.presence("user", "b", {}); f.bridge.presence("user", "b", { offline: true });
  await expect(f.start()).rejects.toThrow("Open Lumiverse");
});
