/** CAT-style isolated Lumiverse + real Spindle worker + local mock provider. */
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import type { Operations, Reply, View, Snapshot } from "../src/shared";
import { simulate } from "../src/ui/simulation";

const repo = resolve(import.meta.dir, ".."), host = resolve(process.argv[2] || "../Lumiverse");
const runDir = join(repo, "local", "host", String(Date.now())); mkdirSync(runDir, { recursive: true }); process.chdir(runDir);
const port = Number(process.env.LUMICACHE_TEST_PORT || 18796), origin = `http://localhost:${port}`;
Object.assign(process.env, { DATA_DIR: join(runDir, "data"), PORT: String(port), FRONTEND_DIR: join(host, "frontend", "dist"),
  OWNER_USERNAME: "lumicache_test", OWNER_PASSWORD: "", AUTH_SECRET: "", ENCRYPTION_KEY: "", TRUSTED_ORIGINS: origin,
  LUMIVERSE_FORCE_BUN_WORKERS: "1", LUMIVERSE_LANCEDB_STARTUP_MAINTENANCE: "off" });
const fromHost = (path: string) => import(pathToFileURL(join(host, "src", path)).href);
const password = crypto.randomUUID(); let session = crypto.randomUUID().replaceAll("-", "");
let providerGate: Promise<void> | undefined;
let cookie = "", socket: WebSocket | undefined, failProvider = false;
const toasts: { title?: string; message: string }[] = [];
const requests: unknown[] = [], replies = new Map<string, Reply>(), results: string[] = [];
const provider = Bun.serve({ port: port + 1, hostname: "127.0.0.1", async fetch(request) {
  if (request.method === "GET") return Response.json({ data: [{ id: "fixture" }] });
  requests.push(await request.json());
  if (failProvider) return new Response("Synthetic provider failure", { status: 400 });
  if (providerGate) {
    const gate = providerGate, encoder = new TextEncoder();
    return new Response(new ReadableStream({ async start(controller) {
      const chunk = (content: string) => encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`);
      controller.enqueue(chunk("A quiet ")); await gate;
      controller.enqueue(chunk("reply."));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  }
  return new Response(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "A quiet reply." } }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 5, total_tokens: 45 } })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
async function api(path: string, method = "GET", body?: unknown, allow404 = false): Promise<any> {
  const response = await fetch(origin + path, { method, headers: { "content-type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  if (response.headers.has("set-cookie")) cookie = response.headers.getSetCookie().map(s => s.split(";")[0]).join("; ");
  if (allow404 && response.status === 404) return null;
  const value = await response.json(); assert(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`); return value;
}
async function until<T>(label: string, read: () => T | Promise<T>, valid: (value: T) => boolean, timeout = 30_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (valid(value)) return value; await Bun.sleep(50); }
  throw new Error(`Timed out: ${label}`);
}
function pass(message: string) { results.push(message); console.log(`HOST PASS: ${message}`); }
try {
  const { initDatabase } = await fromHost("db/connection.ts");
  const { runMigrations } = await fromHost("db/migrate.ts"); await runMigrations(initDatabase());
  const { hashPassword } = await fromHost("crypto/password.ts"), { writeOwnerCredentials } = await fromHost("crypto/credentials.ts");
  await writeOwnerCredentials(join(process.env.DATA_DIR!, "owner.credentials"), "lumicache_test", await hashPassword(password));
  const manager = await fromHost("spindle/manager.service.ts"), files = new Map<string, Uint8Array>();
  for (const file of ["spindle.json", "dist/backend.js", "dist/frontend.js"]) files.set(file, new Uint8Array(await Bun.file(join(repo, file)).arrayBuffer()));
  const extension = await manager.installFromFiles(files, {});
  for (const permission of extension.permissions) manager.grantPermission("lumicache", permission);
  manager.enable("lumicache"); await fromHost("main.ts");
  await api("/api/auth/sign-in/username", "POST", { username: "lumicache_test", password });
  const BunWebSocket = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket;
  async function connect() {
  socket = new BunWebSocket(`ws://localhost:${port}/api/ws?frontend_session=${session}`, { headers: { Cookie: cookie, Origin: origin } });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.event === "SPINDLE_TOAST") toasts.push(message.payload);
    if (message.event === "SPINDLE_FRONTEND_MSG" && message.payload.data.type === "reply") replies.set(message.payload.data.id, message.payload.data);
  });
  await until("WebSocket", () => socket!.readyState, state => state === WebSocket.OPEN);
  }
  await connect();
  await until("worker boot", () => api("/api/v1/spindle"), value => value.extensions.some((e: any) => e.id === extension.id && e.status === "running"));
  async function rpc<K extends keyof Operations>(operation: K, input: Operations[K]["input"]): Promise<Operations[K]["output"]> {
    const id = crypto.randomUUID(); socket!.send(JSON.stringify({ type: "SPINDLE_BACKEND_MSG", extensionId: extension.id, payload: { type: "request", id, operation, input } }));
    const reply = await until(operation, () => replies.get(id), Boolean, operation === "simulate" ? 180_000 : 60_000); replies.delete(id);
    if (reply!.error) throw new Error(reply!.error); return reply!.value as Operations[K]["output"];
  }
  const connection = await api("/api/v1/connections", "POST", { name: "Local provider", provider: "custom", api_url: `http://127.0.0.1:${port + 1}/v1`, model: "fixture", is_default: true });
  const character = await api("/api/v1/characters", "POST", { name: "Cache fixture", description: "An isolated test.", first_mes: "Hello." });
  const chat = await api("/api/v1/chats", "POST", { character_id: character.id, name: "LumiCache verification" });
  const block = { enabled: true, role: "system", position: "pre_history", depth: 0, isLocked: false, color: null, injectionTrigger: [], group: null };
  const preset = await api("/api/v1/presets", "POST", { name: "Cache fixture", provider: "loom", prompt_order: [
    { ...block, id: "main", name: "Main", content: "Stable system\nA calm, quiet tone.", marker: null },
    { ...block, id: "history", name: "History", content: "", marker: "chat_history" },
  ] });
  await api("/api/v1/settings", "PUT", { activeLoomPresetId: preset.id, activeProfileId: connection.id, activeChatId: chat.id });
  const read = () => rpc("load", { chatId: chat.id });
  assert.equal((await read()).settings.mode, "warn", "warn and send is the default");
  await rpc("settings", { mode: "pause" });
  async function begin(type = "normal", content?: string) {
    if (content) await api(`/api/v1/chats/${chat.id}/messages`, "POST", { is_user: true, name: "User", content });
    return api("/api/v1/generate", "POST", { chat_id: chat.id, connection_id: connection.id, preset_id: preset.id, generation_type: type });
  }
  async function ended() { await until("native generation ended", () => api(`/api/v1/generate/status/${chat.id}`), value => !value.active); }
  async function check(status: string) { return until(status, read, view => view.check?.status === status); }
  async function promptText(value: Snapshot, index?: number): Promise<string> {
    const parts: string[] = [];
    const indexes = index === undefined ? Array.from({ length: value.messageCount! }, (_, i) => i) : [index];
    for (const newIndex of indexes) {
      const opened = await rpc("diffOpen", { after: value.reference!, newIndex });
      let page = opened.page;
      for (;;) {
        parts.push(...page.items.flatMap(item => item.kind === "fold" ? [] : [item.text]));
        if (page.next === undefined) break;
        page = await rpc("diffPage", { id: opened.id, cursor: page.next });
      }
    }
    return parts.join("");
  }
  async function changeSystem(content: string) {
    const current = await api(`/api/v1/presets/${preset.id}`); current.prompt_order[0].content = content;
    await api(`/api/v1/presets/${preset.id}`, "PUT", { prompt_order: current.prompt_order, expected_cache_revision: current.cache_revision });
  }
  assert.equal((await read()).settings.mode, "pause");
  await begin("normal", "First question."); await ended();
  let view = await check("completed"); assert(view.hasBaseline); assert.equal(requests.length, 1); assert.equal(view.check!.comparison.kind, "first");
  pass("real worker establishes a baseline only after successful native generation");
  await begin("normal", "Next question."); await ended(); view = await check("completed");
  assert.equal(view.check!.comparison.kind, "append"); assert.equal(requests.length, 2);
  pass("normal conversation growth reaches the provider without a warning");
  await begin("regenerate"); await ended(); view = await check("completed"); assert.equal(view.check!.comparison.kind, "same");
  pass("regeneration of an unchanged prompt does not create a false cache break");
  await changeSystem("Stable system\nA brisk, energetic tone.");
  let sent = requests.length;
  await begin("regenerate"); view = await check("waiting"); assert(view.canDecide); assert.equal(requests.length, sent);
  assert.equal(view.check!.comparison.firstMessage, 0); assert((await promptText(view.check!.before!, 0)).includes("quiet")); assert((await promptText(view.check!.after, 0)).includes("energetic"));
  pass("changed system prompt pauses inside the real host before any provider request and exposes both texts");
  await rpc("decide", { id: view.check!.id, allow: false }); await ended(); assert.equal(requests.length, sent);
  await begin("regenerate"); view = await check("waiting"); assert.equal(requests.length, sent);
  pass("Cancel prevents provider dispatch and retry still compares with the previous successful prompt");
  await rpc("decide", { id: view.check!.id, allow: true }); await ended(); view = await check("completed"); assert.equal(requests.length, sent + 1);
  assert.equal(await promptText(view.check!.after, 0), "Stable system\nA brisk, energetic tone.");
  pass("Send anyway releases exactly the reviewed request and promotes its successful prompt");
  const checkId = view.check!.id;
  await changeSystem("Different dry run prompt");
  await api("/api/v1/generate/dry-run", "POST", { chat_id: chat.id, connection_id: connection.id, preset_id: preset.id, generation_type: "normal" });
  assert.equal((await read()).check!.id, checkId);
  pass("dry runs neither block nor overwrite the baseline or latest live check");
  await begin("regenerate"); view = await check("waiting"); sent = requests.length;
  await api("/api/v1/generate/stop", "POST", { generation_id: view.check!.generationId }); await ended();
  await check("cancelled"); assert.equal(requests.length, sent);
  pass("native Stop cancels a paused review without leaking a provider call");
  await rpc("settings", { mode: "warn" }); failProvider = true;
  await begin("regenerate"); await ended(); view = await check("failed"); assert.equal(view.check!.comparison.kind, "break");
  const toast = await until("cache break toast", () => toasts.at(-1), value => !!value);
  assert.match(toast!.title ?? "", /^Cache has been broken at depth \d+!$/); assert.match(toast!.message, /^~?[\d,]+ tokens will be recached 💸\.$/);
  pass("warn mode sends right away and shows a toast with the break depth and tokens to recache");
  assert.equal(await promptText(view.check!.before!, 0), "Stable system\nA brisk, energetic tone.");
  failProvider = false; await rpc("settings", { mode: "pause" });
  await begin("regenerate"); view = await check("waiting"); await rpc("decide", { id: view.check!.id, allow: true }); await ended(); await check("completed");
  pass("warning mode sends without approval, provider failure preserves the old baseline, and the next attempt warns again");
  await rpc("clear", { chatId: chat.id }); assert.equal((await read()).hasBaseline, false);
  await begin("regenerate"); await ended(); assert.equal((await check("completed")).check!.comparison.kind, "first");
  await rpc("settings", { mode: "off" }); const lastId = (await read()).check!.id;
  await changeSystem("Monitoring disabled"); await begin("regenerate"); await ended(); assert.equal((await read()).check!.id, lastId);
  await rpc("settings", { mode: "pause" });
  pass("clearing a baseline establishes a fresh first request; Off bypasses inspection without rewriting previous evidence");
  async function disconnect() {
    socket!.close(); await until("socket closed", () => socket!.readyState, state => state === WebSocket.CLOSED);
    const { getActiveFrontendSession } = await fromHost("spindle/frontend-session.ts");
    const { getDb } = await fromHost("db/connection.ts");
    const owner = getDb().query('SELECT id FROM "user" LIMIT 1').get() as {id:string};
    await until("host records browser departure", () => getActiveFrontendSession(owner.id), value => value === undefined);
  }
  await rpc("clear", { chatId: chat.id });
  let releaseProvider!: () => void; providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
  sent = requests.length; await begin("normal", "Finish while the browser is closed.");
  await until("provider dispatched", () => requests.length, count => count === sent + 1);
  await until("first token received", () => api(`/api/v1/generate/status/${chat.id}`), value => value.active && value.content === "A quiet ");
  await disconnect(); releaseProvider(); providerGate = undefined; await ended();
  session = crypto.randomUUID().replaceAll("-", ""); await connect(); view = await check("completed");
  assert(view.hasBaseline); assert.equal(view.check!.comparison.kind, "first");
  const completedMessages = await api(`/api/v1/chats/${chat.id}/messages?full=true`);
  assert(completedMessages.data.some((m:any) => !m.is_user && m.content === "A quiet reply."));
  await begin("regenerate"); await ended(); assert.equal((await check("completed")).check!.comparison.kind,"same");
  pass("closing the only browser during provider generation preserves the reply and advances the backend baseline");
  await changeSystem("Review after reopening the browser"); await begin("regenerate"); view = await check("waiting");
  const pendingId = view.check!.id; sent = requests.length;
  await disconnect(); assert((await api(`/api/v1/generate/status/${chat.id}`)).active);
  session = crypto.randomUUID().replaceAll("-", ""); await connect(); view = await read();
  assert.equal(view.check!.id,pendingId); assert.equal(view.check!.status,"waiting");
  assert(view.canDecide, "A reopened browser must be able to resume its user's orphaned review");
  assert.equal(requests.length,sent); await rpc("decide", {id:pendingId,allow:true}); await ended(); await check("completed");
  pass("a disconnected review stays paused and can be approved from the user's reopened browser without a second generation");
  await changeSystem("Browser closed before the interceptor checks"); await disconnect(); sent = requests.length;
  await begin("regenerate");
  session = crypto.randomUUID().replaceAll("-", ""); await connect(); view = await check("waiting");
  assert(view.canDecide); assert.equal(requests.length,sent);
  await rpc("decide", {id:view.check!.id,allow:true}); await ended(); await check("completed");
  pass("a cache break with no initiating browser waits for review instead of failing or sending without approval");
  const book = await api("/api/v1/world-books", "POST", { name: "Simulation fixture lore" });
  for (let i = 0; i < 205; i++) await api(`/api/v1/world-books/${book.id}/entries`, "POST", {
    uid: String(i), comment: `Entry ${i}`, key: ["azure-copper-monolith"], content: i === 204 ? "The azure-copper-monolith opens a hidden passage." : i === 0 ? "A fixed lore entry." : "{{random::1::1000000}}",
    constant: i !== 204, disabled: i > 1 && i < 204, position: 0,
  });
  const attached = await api(`/api/v1/chats/${chat.id}`);
  await api(`/api/v1/chats/${chat.id}`, "PUT", { metadata: { ...attached.metadata, chat_world_book_ids: [book.id] } });
  await api(`/api/v1/preset-profiles/chat/${chat.id}`, "PUT", { preset_id: preset.id, block_states: { main: true, history: true } });
  const rule = await api("/api/v1/regex-scripts", "POST", { name: "Chat-only prompt rule", target: ["prompt"], placement: ["ai_output"],
    scope: "chat", scope_id: chat.id, find_regex: "quiet", replace_string: "calm", disabled: false });
  const sourceMessages = await api(`/api/v1/chats/${chat.id}/messages?full=true`), sourceChat = await api(`/api/v1/chats/${chat.id}`);
  const sourceProfile = await api(`/api/v1/preset-profiles/chat/${chat.id}`), providerCount = requests.length;
  const liveCheck = (await read()).check!.id;
  const health = await rpc("audit", { chatId: chat.id, connectionId: connection.id });
  assert.equal(health.entriesScanned, 3);
  assert(health.findings.some(f => f.source.includes("Entry 204") && f.title.includes("Keyword")));
  assert(health.findings.some(f => f.title === "Random output"));
  pass("cache health scans attached lore beyond the first page and flags conditional activation and random constant content");
  const simulation = await simulate({ call: rpc }, { chatId: chat.id, connectionId: connection.id }, () => {},
    (path, method, body, allow404) => api(`/api/v1/${path}`, method, body, allow404));
  assert.equal(simulation.error, undefined); assert.equal(simulation.cleanupError, undefined); assert(simulation.complete);
  assert.equal(simulation.steps.length, 3); assert(simulation.history.length > 0);
  assert((await promptText(simulation.steps[0].snapshot)).includes("calm reply"), "chat-scoped regex must apply to the simulation copy");
  assert(simulation.steps[1].comparison.kind === "break", "the native random macro must be re-evaluated");
  assert(simulation.history.every(step => step.recordedPrompt), "saved original prompts should be available beside historical reconstructions");
  assert.equal(requests.length, providerCount, "audits and simulations must make zero provider requests");
  assert.equal((await read()).check!.id, liveCheck, "simulations must not replace the live cache baseline/check");
  pass("future prompt builds and historical reconstructions use real native assembly with zero model requests and an untouched live baseline");
  assert.deepEqual(await api(`/api/v1/chats/${chat.id}/messages?full=true`), sourceMessages);
  assert.deepEqual(await api(`/api/v1/chats/${chat.id}`), sourceChat);
  assert.deepEqual(await api(`/api/v1/preset-profiles/chat/${chat.id}`), sourceProfile);
  const chats = (await api("/api/v1/chats?limit=200")).data;
  assert(!chats.some((row: any) => row.name.startsWith("LumiCache simulation")));
  const rules = (await api("/api/v1/regex-scripts?limit=200")).data;
  assert(rules.some((row: any) => row.id === rule.id));
  assert(!rules.some((row: any) => row.scope === "chat" && row.scope_id !== chat.id));
  pass("simulation preserves original chat, messages and profile; temporary copies and cloned chat regexes are removed");
  const contextPreset = await api(`/api/v1/presets/${preset.id}`);
  await api(`/api/v1/presets/${preset.id}`, "PUT", { expected_cache_revision: contextPreset.cache_revision,
    parameters: { ...contextPreset.parameters, samplerOverrides: { enabled: true, contextSize: 430, maxTokens: 128 } } });
  const configured = await api(`/api/v1/presets/${preset.id}`);
  const pressured = await simulate({ call: rpc }, { chatId: chat.id, connectionId: connection.id }, () => {},
    (path, method, body, allow404) => api(`/api/v1/${path}`, method, body, allow404));
  assert(pressured.complete, pressured.error ?? "The context-pressure simulation did not complete"); assert.equal(pressured.steps[0].clipping?.maxContext, 430);
  assert(pressured.steps.at(-1)!.clipping!.messagesDropped > 0);
  assert(pressured.health.findings.some(f => f.id.includes("context-clipping") && f.suggestion.includes("LumiBooks")));
  assert.deepEqual(await api(`/api/v1/presets/${preset.id}`), configured);
  assert.deepEqual(await api(`/api/v1/chats/${chat.id}/messages?full=true`), sourceMessages);
  assert.equal(requests.length, providerCount);
  pass("future history pressure exposes real clipping as a LumiBooks advisory without altering the configured context or original messages");
  await api(`/api/v1/spindle/${extension.id}/restart`, "POST");
  await until("worker restart", () => read().catch(() => null), value => !!value && !value.hasBaseline);
  await begin("regenerate");
  view = await until("first check after restart", read, value => value.check?.status === "waiting" || value.check?.status === "completed");
  assert(view.check!.before, "the first send after a restart must compare against LumiCache's own saved prompt");
  assert.notEqual(view.check!.comparison.kind, "first");
  if (view.check!.status === "waiting") await rpc("decide", { id: view.check!.id, allow: true });
  await ended();
  pass("after an extension restart the first send compares against the exact prompt LumiCache saved");
  await api(`/api/v1/chats/${chat.id}/messages`, "POST", { is_user: false, name: "Cache fixture", content: "A reply made while LumiCache was not watching." });
  await api(`/api/v1/spindle/${extension.id}/restart`, "POST");
  await until("worker restart", () => read().catch(() => null), value => !!value && !value.hasBaseline);
  await begin("regenerate"); await ended(); view = await check("completed");
  assert.equal(view.check!.comparison.kind, "first", "a later AI response means the saved prompt was not the last one sent");
  pass("a saved prompt with a later AI response is not used as the last state");
  const largePreset = await api(`/api/v1/presets/${preset.id}`);
  await api(`/api/v1/presets/${preset.id}`, "PUT", { expected_cache_revision: largePreset.cache_revision,
    parameters: { ...largePreset.parameters, samplerOverrides: { enabled: true, contextSize: 2_000_000, maxTokens: 128 } } });
  const millionWords = "cache ".repeat(1_000_000);
  await changeSystem(millionWords + "OLD END"); await rpc("settings", { mode: "warn" });
  await begin("regenerate"); await ended(); await check("completed");
  await rpc("settings", { mode: "pause" }); await changeSystem(millionWords + "NEW END");
  sent = requests.length; await begin("regenerate"); view = await check("waiting");
  assert.equal(requests.length, sent); assert(JSON.stringify(view).length < 16_000);
  assert.equal(view.check!.before!.messages.length, 0); assert.equal(view.check!.after.messages.length, 0);
  const largeDiff = await rpc("diffOpen", { before: view.check!.before!.reference, after: view.check!.after.reference!, oldIndex: 0, newIndex: 0 });
  assert(JSON.stringify(largeDiff).length < 16_000);
  assert(largeDiff.page.items.some(item => item.kind === "remove" && item.text.includes("OLD")));
  assert(largeDiff.page.items.some(item => item.kind === "add" && item.text.includes("NEW")));
  const fold = largeDiff.page.items.find(item => item.kind === "fold"); assert(fold && fold.kind === "fold");
  const contextPage = await rpc("diffPage", { id: largeDiff.id, fold: fold.id }); assert(contextPage.items.length <= 100); assert(contextPage.next !== undefined);
  await rpc("decide", { id: view.check!.id, allow: false }); await ended(); assert.equal(requests.length, sent);
  pass("a six-million-character prompt pauses with compact replies and paged context; no full prompt is sent to the browser");
  const largeSimulation = await simulate({ call: rpc }, { chatId: chat.id, connectionId: connection.id }, () => {},
    (path, method, body, allow404) => api(`/api/v1/${path}`, method, body, allow404));
  assert(largeSimulation.complete, largeSimulation.error ?? "Large simulation incomplete"); assert.equal(largeSimulation.steps.length, 3);
  assert(JSON.stringify(largeSimulation).length < 100_000); assert(largeSimulation.steps.every(step => step.snapshot.reference && !step.snapshot.messages.length));
  assert.equal(requests.length, sent);
  pass("million-word future and historical previews complete with compact prompt references and zero model calls");
  await Bun.write(join(runDir, "large-simulation.json"), JSON.stringify(largeSimulation, null, 2));
  let agentProbeId: string | undefined;
  if (process.argv.includes("--agent")) {
    const { testAgentHost } = await import("./test-agent-host");
    agentProbeId = await testAgentHost({ repo, runDir, manager, lifecycle: await fromHost("spindle/lifecycle.ts"), socket: socket!, session,
      chatId: chat.id, connectionId: connection.id, rpc, api, pass, providerCount: () => requests.length });
  }
  const { testDiagnosticsHost } = await import("./test-diagnostics-host");
  const diagnostics = await testDiagnosticsHost({ api, rpc, connectionId: connection.id, providerCount: () => requests.length, pass });
  const { testConsistencyHost } = await import("./test-consistency-host");
  const consistency = await testConsistencyHost({ api, rpc, connectionId: connection.id, requests, pass });
  await Bun.write(join(runDir, "simulation.json"), JSON.stringify(simulation, null, 2));
  await Bun.write(join(runDir, "results.json"), JSON.stringify({ results, providerRequests: requests.length }, null, 2));
  console.log(`HOST COMPLETE: ${results.length} checks. Evidence: ${join(runDir, "results.json")}`);
  if (process.argv.includes("--serve")) {
    await Bun.write(join(repo, "local", "preview.json"), JSON.stringify({ origin, username: "lumicache_test", password, chatId: chat.id, presetId: preset.id, extensionId: extension.id, agentProbeId, diagnosticChatId: diagnostics.chatId, diagnosticPresetId: diagnostics.presetId, consistencyChatId: consistency.chatId, consistencyPresetId: consistency.presetId }, null, 2));
    socket!.close(); console.log(`Disposable preview ready at ${origin}. Credentials: local/preview.json`); await new Promise(() => {});
  }
  socket?.close(); provider.stop(); process.exit(0);
} catch (error) { console.error(error); socket?.close(); provider.stop(); process.exit(1); }
