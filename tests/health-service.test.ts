import { expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { HealthService } from "../src/health/service";
import { sources, entry, stats } from "./health.test";
import { simulationCopy } from "../src/health/copy";

function fixture() {
  const data = sources(); data.lore = [{ bookId: "book", bookName: "Lore", scope: "Character", entry: entry() }];
  const chats = new Map<string, any>([["source", structuredClone(data.chat)]]);
  const messages = new Map<string, any[]>([["source", ["Hello", "First question", "First reply", "Second question", "Second reply"].map((content, i) => ({ id: `m${i}`, content, name: "Fixture", is_user: i % 2 === 1, extra: {}, index_in_chat: i }))]]);
  let calls = 0, failAt = -1, failCleanup = false, changeRegenerate = false, progressHook = (_completed: number) => {};
  const mutations: string[] = [], seen: { type: string; last: string }[] = [], updates: { id: string; patch: any }[] = [];
  const api = {
    chats: { get: async (id: string, user: string) => user === "user" ? structuredClone(chats.get(id) ?? null) : null,
      update: async (id: string, patch: any) => { mutations.push(id); updates.push({ id, patch: structuredClone(patch) }); chats.set(id, { ...chats.get(id), ...structuredClone(patch) }); return structuredClone(chats.get(id)); },
      delete: async (id: string) => { mutations.push(id); if (failCleanup) throw new Error("Cleanup failed"); return chats.delete(id); } },
    chat: { getMessages: async (id: string) => structuredClone(messages.get(id) ?? []),
      appendMessage: async (id: string, value: any, options: any) => { expect(options.triggerGeneration).toBe(false); mutations.push(id); const message = { id: crypto.randomUUID(), is_user: value.role === "user", content: value.content, extra: {} }; messages.get(id)!.push(message); return { id: message.id }; },
      deleteMessage: async (id: string, messageId: string) => { mutations.push(id); messages.set(id, messages.get(id)!.filter(m => m.id !== messageId)); } },
    presets: { getActive: async () => structuredClone(data.active), get: async () => structuredClone(data.preset) },
    personas: { getActive: async () => null, getDefault: async () => null }, characters: { get: async () => structuredClone(data.character) },
    world_books: { getGlobal: async () => [], get: async () => ({ name: "Lore", metadata: {} }), entries: { list: async () => ({ total: 1, data: [entry()] }) } },
    connections: { get: async () => structuredClone(data.connection), list: async () => [data.connection] },
    regex_scripts: { getActive: async () => [] },
    generate: { dryRun: async (input: any) => {
      calls++; if (calls === failAt) throw new Error("Preview failed");
      const history = messages.get(input.chatId)!;
      seen.push({ type: input.generationType, last: history.at(-1)?.content });
      const content = changeRegenerate && input.generationType === "regenerate" ? "Stable system\nA new random value" : "Stable system";
      const result = [{ role: "system", content }, ...history.map(m => ({ role: m.is_user ? "user" : "assistant", content: m.content }))];
      return { messages: result, request_messages: result, model: "fixture", provider: "custom", parameters: {},
        contextClipStats: stats(), breakdown: [{ type: "system", name: "Main", content }] };
    }, getBreakdown: async (id: string) => ({ model: "original-model", provider: "custom", messages: [{ role: "user", content: `Originally sent before ${id}` }], usage: { provider_raw: { cache_read_input_tokens: 123 } } }),
      raw: async () => { throw new Error("A model request must never occur"); }, quiet: async () => { throw new Error("A model request must never occur"); } },
  } as unknown as SpindleAPI;
  const service = new HealthService(api, () => false, (_user, _session, completed) => progressHook(completed));
  const setup = async () => {
    const ticket = await service.prepare("user", "session", { chatId: "source", connectionId: "connection" });
    const copy = simulationCopy({ chat: chats.get("source"), messages: messages.get("source")! }, ticket);
    chats.set("copy", { ...copy.chat, id: "copy", character_id: copy.character_id });
    messages.set("copy", copy.messages.map((m, index) => ({ ...m, id: `copy-${index}` })));
    return ticket;
  };
  // What Lumiverse's own branch produces: the source's metadata and extras, with fork markers.
  const branch = async () => {
    const ticket = await service.prepare("user", "session", { chatId: "source", connectionId: "connection" });
    const source = chats.get("source"), copied = messages.get("source")!.map((m, index) => ({ ...structuredClone(m), id: `copy-${index}` }));
    chats.set("copy", { ...structuredClone(source), id: "copy", name: ticket.branchName, metadata: { ...structuredClone(source.metadata), branched_from: "source", branch_at_message: ticket.lastMessageId,
      _swipe_variable_state: { version: 1 }, context_history_anchor_message_id: "copy-2" } });
    messages.set("copy", copied);
    return ticket;
  };
  const audio = (id: string) => { messages.get(id)![1].extra = { attachments: [{ type: "audio", image_id: "voice" }] }; };
  return { service, setup, branch, audio, updates, chats, messages, mutations, seen, breakRegenerate: () => { changeRegenerate = true; }, calls: () => calls, failAt: (value: number) => { failAt = value; }, failCleanup: () => { failCleanup = true; },
    progress: (hook: (completed: number) => void) => { progressHook = hook; } };
}
test("future turns compare against the prompt behind the latest reply, without touching source history", async () => {
  const f = fixture(), original = JSON.stringify(f.messages.get("source")), ticket = await f.setup();
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.complete).toBe(true); expect(report.steps.map(step => step.name)).toEqual(["Reference", "Regenerate", "New turn"]); expect(report.history).toHaveLength(2); expect(f.calls()).toBe(5);
  expect(report.steps[1].comparison.kind).toBe("same"); expect(report.steps[2].comparison.kind).toBe("append");
  expect(f.seen.slice(0, 3).map(call => call.type)).toEqual(["normal", "normal", "regenerate"]);
  expect(f.seen[1].last).toBe("Second question"); expect(f.seen[2].last).toBe("Second question");
  expect(report.steps[2].timeline!.rows.filter(row => row.status === "new").map(row => row.role)).toEqual(["assistant", "user"]);
  expect(report.history.map(step => step.historyThrough)).toEqual([2, 4]);
  expect(report.history[0].snapshot.messages).toHaveLength(3); expect(report.history[0].recordedUsage?.read).toBe(123);
  expect(report.history[0].recordedPrompt!.messages[0].body).toContain("Originally sent");
  expect(report.history.every(step => !step.snapshot.messages.some(message => message.body.includes("LumiCache test")))).toBe(true);
  expect(JSON.stringify(f.messages.get("source"))).toBe(original); expect(f.mutations.every(id => id === "copy")).toBe(true); expect(f.chats.has("copy")).toBe(false);
});
test("a regenerate that changes the prompt is a break, named by its source", async () => {
  const f = fixture(); f.breakRegenerate(); const ticket = await f.setup();
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.steps[1].comparison.kind).toBe("break"); expect(report.steps[1].changedSources).toContain("Main");
  expect(report.steps[1].timeline!.rows[0]).toMatchObject({ status: "changed", root: true });
  expect(report.steps[2].comparison.kind).toBe("append");
});
test("preview failure leaves an explicitly incomplete report and still deletes the disposable copy", async () => {
  const f = fixture(), ticket = await f.setup(); f.failAt(3);
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.complete).toBe(false); expect(report.error).toBe("Preview failed"); expect(report.steps).toHaveLength(1); expect(f.chats.has("copy")).toBe(false);
});
test("cleanup failure is visible and does not delete the source", async () => {
  const f = fixture(), ticket = await f.setup(); f.failCleanup();
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.cleanupError).toContain("Cleanup failed"); expect(report.scratchChatId).toBe("copy"); expect(f.chats.has("source")).toBe(true);
});
test("wrong users, sessions and copy identities cannot run a ticket or cause deletion", async () => {
  const f = fixture(), ticket = await f.setup();
  await expect(f.service.run("other", "session", ticket.id, "copy")).rejects.toThrow("another browser");
  await expect(f.service.run("user", "other", ticket.id, "copy")).rejects.toThrow("another browser");
  await expect(f.service.run("user", "session", ticket.id, "source")).rejects.toThrow("does not match");
  expect(f.mutations).toHaveLength(0);
  await f.service.run("user", "session", ticket.id, "copy");
  await expect(f.service.run("user", "session", ticket.id, "copy")).rejects.toThrow("expired");
});
test("overlapping preparations are rejected before source reads complete", async () => {
  const f = fixture(); const first = f.service.prepare("user", "session", { chatId: "source" });
  await expect(f.service.prepare("user", "session", { chatId: "source" })).rejects.toThrow("already");
  const ticket = await first; f.service.cancel("user", "session", ticket.id);
});
test("chats without audio are branched on the server; the branch is adopted, cleaned and removed", async () => {
  const f = fixture(), ticket = await f.branch(); expect(ticket.copy).toBe("branch");
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.complete).toBe(true); expect(f.chats.has("copy")).toBe(false);
  const adopted = f.updates.find(u => u.id === "copy")!.patch.metadata;
  expect(adopted).toMatchObject({ lumicache_simulation: ticket.id, lumicache_simulation_source: "source", context_history_anchor_message_id: "copy-2" });
  for (const key of ["branched_from", "branch_at_message", "_swipe_variable_state"]) expect(adopted).not.toHaveProperty(key);
  expect(report.limitations.some(note => note.includes("context anchor"))).toBe(true);
  expect(f.mutations.every(id => id === "copy")).toBe(true);
});
test("chats with audio use the import copy, and a branch that holds audio is never deleted", async () => {
  const withAudio = fixture(); withAudio.audio("source");
  expect((await withAudio.service.prepare("user", "session", { chatId: "source" })).copy).toBe("import");
  // Audio added after preparation reaches the branch: nothing in it may be removed.
  const f = fixture(), ticket = await f.branch(); f.audio("copy");
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.complete).toBe(false); expect(report.error).toContain("audio");
  expect(f.chats.has("copy")).toBe(true); expect(f.messages.get("copy")).toHaveLength(5);
  expect(report.cleanupError).toContain("audio"); expect(report.scratchChatId).toBe("copy");
});
test("an abandoned branch is removed only when it is the ticket's copy and holds no audio", async () => {
  const f = fixture(), ticket = await f.branch();
  await f.service.abandon("user", "session", ticket.id, "copy"); expect(f.chats.has("copy")).toBe(false);
  const kept = fixture(), second = await kept.branch(); kept.audio("copy");
  await expect(kept.service.abandon("user", "session", second.id, "copy")).rejects.toThrow("audio"); expect(kept.chats.has("copy")).toBe(true);
  const other = fixture(), third = await other.branch();
  await expect(other.service.abandon("user", "session", third.id, "source")).rejects.toThrow("identity"); expect(other.chats.has("source")).toBe(true);
});
test("cancelling a running simulation retains completed previews and removes its copy", async () => {
  const f = fixture(), ticket = await f.setup();
  f.progress(completed => { if (completed === 1) f.service.cancel("user", "session", ticket.id); });
  const report = await f.service.run("user", "session", ticket.id, "copy");
  expect(report.complete).toBe(false); expect(report.error).toContain("cancelled"); expect(report.steps.length).toBeLessThan(3);
  expect(f.chats.has("copy")).toBe(false); expect(f.chats.has("source")).toBe(true);
});
