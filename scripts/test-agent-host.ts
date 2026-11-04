import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import type { Bridge } from "../src/ui/bridge";
import { simulate } from "../src/ui/simulation";
import { BRIDGE_PERMISSIONS } from "../src/agent-bridge";

export async function testAgentHost(options: {
  repo: string; runDir: string; manager: any; lifecycle: any; socket: WebSocket; session: string;
  chatId: string; connectionId: string; rpc: Bridge["call"];
  api(path: string, method?: string, body?: unknown, allow404?: boolean): Promise<any>;
  pass(message: string): void; providerCount(): number;
}) {
  const { repo, runDir, manager, lifecycle, socket, session, chatId, connectionId, rpc, api, pass } = options;
  const agentRoot = resolve(repo, "../LumiAgent").replaceAll("\\", "/");
  const source = join(runDir, "agent-probe.ts");
  await Bun.write(source, `
import { discoverProviders, invalidate, getAllDialFailures } from ${JSON.stringify(agentRoot + "/src/phoneline/registry")};
import { dialCache } from ${JSON.stringify(agentRoot + "/src/phoneline/transport")};
import { inspectCacheTool, runCacheDiagnosticTool } from ${JSON.stringify(agentRoot + "/src/agent/tools/cache-diagnostics")};
declare const spindle: any;
spindle.onFrontendMessage((request: any, user: string, session: string) => {
  if (request?.type !== "agentProbe") return;
  void (async () => {
    try {
      let value;
      if (request.operation === "discover") { invalidate(user); value = { providers: await discoverProviders(spindle, user), failures: getAllDialFailures(user) }; }
      else if (request.operation === "raw") value = await dialCache(spindle, { ...request.input, userId: user });
      else {
        const tool = request.operation === "run" ? runCacheDiagnosticTool : inspectCacheTool;
        const input = tool.inputSchema.parse(request.input);
        const context = { spindle, userId: user, sessionId: session, pinnedChatId: request.chatId, signal: new AbortController().signal, contextTokens: 1_000_000, rootCallId: request.id };
        const result = await tool.execute(input as never, context as never);
        if (result.isError) throw new Error(result.content);
        value = JSON.parse(result.content);
      }
      spindle.sendToFrontend({ type: "agentProbeReply", id: request.id, value }, user, { frontendSessionId: session });
    } catch (error) { spindle.sendToFrontend({ type: "agentProbeReply", id: request.id, error: String(error) }, user, { frontendSessionId: session }); }
  })();
});`);
  const bundle = await Bun.build({ entrypoints: [source], target: "bun" }); assert(bundle.success, String(bundle.logs));
  async function install(identifier: string) {
    const files = new Map<string, Uint8Array>([
      ["spindle.json", new TextEncoder().encode(JSON.stringify({ identifier, name: identifier === "lumiagent" ? "LumiAgent" : "Foreign probe", version: "0.0.0-test",
        github: "https://github.com/AMousePad/LumiAgent", author: "Local test", permissions: [...BRIDGE_PERMISSIONS], entry_backend: "dist/backend.js" }))],
      ["dist/backend.js", new Uint8Array(await bundle.outputs[0].arrayBuffer())],
    ]);
    const extension = await manager.installFromFiles(files, {});
    for (const permission of extension.permissions) manager.grantPermission(identifier, permission);
    manager.enable(identifier); await lifecycle.startExtension(extension.id); return extension.id as string;
  }
  const probeId = await install("lumiagent"), foreignId = await install("foreign_cache_probe");
  const replies = new Map<string, any>(); let relay = true; const relays = new Set<Promise<void>>();
  const receive = (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)); if (message.event !== "SPINDLE_FRONTEND_MSG") return;
    const data = message.payload.data;
    if (data.type === "agentProbeReply") replies.set(data.id, data);
    if (data.type === "agentDiagnostic" && relay) {
      const task = (async () => {
        try {
          const job = await rpc("agentClaim", { id: data.id }), input = { ...job.input, agentJobId: data.id };
          if (job.kind === "audit") await rpc("audit", input);
          else {
            const result = await simulate({ call: rpc }, input, () => {}, (path, method, body, allow404) => api(`/api/v1/${path}`, method, body, allow404));
            await rpc("agentFinish", { id: data.id, cleanupError: result.cleanupError, scratchChatId: result.scratchChatId });
          }
        } catch (error) { await rpc("agentFinish", { id: data.id, error: String(error) }); }
      })(); relays.add(task); void task.finally(() => relays.delete(task));
    }
  };
  socket.addEventListener("message", receive);
  const wait = async <T>(read: () => Promise<T> | T, ready: (value: T) => boolean, timeout = 90_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) { const value = await read(); if (ready(value)) return value; await Bun.sleep(100); }
    throw new Error("Agent bridge test timed out.");
  };
  async function probe(operation: string, input: unknown = {}, extensionId = probeId): Promise<any> {
    const id = crypto.randomUUID(); socket.send(JSON.stringify({ type: "SPINDLE_BACKEND_MSG", extensionId, payload: { type: "agentProbe", id, operation, input, chatId } }));
    const response = await wait<any>(() => replies.get(id), Boolean, 25_000); replies.delete(id);
    if (response.error) throw new Error(response.error); return response.value;
  }
  try {
    const discovery = await probe("discover"); assert(discovery.providers.some((p: any) => p.id === "lumicache")); assert.deepEqual(discovery.failures, []);
    pass("real LumiAgent discovery and cache tool code reach LumiCache through the host permission-scoped bridge");
    await assert.rejects(probe("raw", { action: "report", chatId }, foreignId), /Only LumiAgent/);
    manager.revokePermission("lumiagent", "presets");
    const denied = await probe("discover"); assert(denied.failures.some((f: any) => f.providerId === "lumicache" && f.missingPerms.includes("presets")));
    manager.grantPermission("lumiagent", "presets"); assert((await probe("discover")).providers.some((p: any) => p.id === "lumicache"));
    pass("foreign callers are rejected and bridge permission failures identify LumiCache without requiring unrelated agent permissions");
    const liveBefore = await rpc("load", { chatId }), count = options.providerCount();
    const evidence = await probe("inspect", { action: "live" }); assert.equal(evidence.canDecide, false); assert(evidence.check.after.reference);
    const changes = await probe("inspect", { action: "diff_list", before: evidence.check.before.reference, after: evidence.check.after.reference });
    const change = changes.items[0], opened = await probe("inspect", { action: "diff_open", before: evidence.check.before.reference, after: evidence.check.after.reference, old_index: change.oldIndex, new_index: change.newIndex });
    assert(opened.page.items.length <= 20); assert(JSON.stringify(opened).length < 30_000);
    const fold = opened.page.items.find((item: any) => item.kind === "fold");
    if (fold) { const page = await probe("inspect", { action: "diff_page", diff_id: opened.id, fold: fold.id }); assert.equal(page.items.length, 20); }
    await assert.rejects(probe("raw", { action: "decide", allow: true, id: evidence.check.id }), /cannot approve/);
    pass("agent tools inspect the million-word live diff in bounded pages and cannot authorize a paused send");
    await rpc("agentPresence", { chatId, connectionId });
    const audit = await probe("run", { action: "audit", connection_id: connectionId }); assert.equal(audit.kind, "audit");
    const auditDone = await wait(() => probe("inspect", { action: "job", job_id: audit.id }), job => ["completed", "failed", "cancelled"].includes(job.phase));
    assert.equal(auditDone.phase, "completed", auditDone.error); assert((await probe("inspect", { action: "report" })).audit.findings.length);
    pass("agent audit jobs acknowledge promptly and finish through authenticated frontend requests after the original RPC scope closes");
    const messagesBefore = await api(`/api/v1/chats/${chatId}/messages?full=true`);
    await rpc("agentPresence", { chatId, connectionId });
    const simulation = await probe("run", { action: "simulation", connection_id: connectionId });
    const done = await wait(() => probe("inspect", { action: "job", job_id: simulation.id }), job => ["completed", "failed", "cancelled"].includes(job.phase), 180_000);
    assert.equal(done.phase, "completed", done.error);
    const report = await probe("inspect", { action: "report" }); assert.equal(report.simulation.steps.length, 3); assert(report.simulation.complete); assert(report.simulation.steps.every((s: any) => s.snapshot.reference && !s.snapshot.messages.length));
    assert.deepEqual(await api(`/api/v1/chats/${chatId}/messages?full=true`), messagesBefore);
    assert.equal((await rpc("load", { chatId })).check!.id, liveBefore.check!.id); assert.equal(options.providerCount(), count);
    assert(!(await api("/api/v1/chats?limit=200")).data.some((chat: any) => chat.name.startsWith("LumiCache simulation")));
    pass("agent simulations finish million-word previews, retain reports, clean temporary chats, and preserve live baselines with zero model calls");
    relay = false; await rpc("agentPresence", { chatId, connectionId });
    const queued = await probe("run", { action: "simulation" }); const cancelled = await probe("run", { action: "cancel", job_id: queued.id }); assert.equal(cancelled.phase, "cancelled");
    await assert.rejects(rpc("agentClaim", { id: queued.id }), /cancelled/);
    pass("agent cancellation stops queued diagnostics before any simulation copy is created");
    await Bun.write(join(runDir, "agent-report.json"), JSON.stringify(report, null, 2));
    return probeId;
  } finally {
    socket.removeEventListener("message", receive); await Promise.allSettled([...relays]);
    await rpc("agentPresence", { offline: true });
  }
}
