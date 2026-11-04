import { expect, test } from "bun:test";
import type { ContextClipStatsDTO, DryRunResultDTO, SavedBreakdownDTO, WorldBookEntryDTO } from "lumiverse-spindle-types";
import { analyze, clippingFindings, effectiveBlocks, reportedUsage, scanText } from "../src/health/analyze";
import { allPages, type Sources } from "../src/health/sources";
import { historicalCutoffs, simulationCopy } from "../src/health/copy";
import { scenarios } from "../src/health/scenarios";

export function sources(): Sources {
  return { input: { chatId: "source", connectionId: "connection", composition: { available: true } }, chat: { id: "source", character_id: "character", name: "Chat", metadata: {} },
    character: { id: "character", name: "Character", tags: ["night-city"], description: "", personality: "", scenario: "", system_prompt: "", post_history_instructions: "", world_book_ids: ["book"] },
    persona: null, active: { preset_id: "preset", source: "none", source_id: null, block_states: {} },
    preset: { id: "preset", name: "Preset", provider: "loom", prompt_order: [{ id: "main", name: "Main", content: "Stable instructions", enabled: true, marker: null, position: "pre_history", depth: 0, injectionTrigger: [], role: "system" }] },
    connection: { id: "connection", name: "Connection", model: "fixture", provider: "custom", api_url: "http://example.invalid", is_default: true, metadata: {} },
    lore: [], regex: [], notes: [] } as unknown as Sources;
}
export function entry(patch: Partial<WorldBookEntryDTO> = {}): WorldBookEntryDTO {
  return { id: "entry", uid: "entry", world_book_id: "book", comment: "Dragon", key: ["dragon"], keysecondary: [], content: "A dragon guards the bridge.",
    constant: false, disabled: false, position: 0, depth: 0, use_probability: false, probability: 100, group_name: "", group_override: false,
    sticky: 0, cooldown: 0, delay: 0, vectorized: false, ...patch } as WorldBookEntryDTO;
}
export const stats = (patch: Partial<ContextClipStatsDTO> = {}): ContextClipStatsDTO => ({ enabled: true, maxContext: 16_000, maxResponseTokens: 1000, safetyMargin: 256,
  inputBudget: 14744, fixedTokens: 1000, remainingHistoryBudget: 13744, chatHistoryTokensBefore: 1000, chatHistoryTokensAfter: 1000,
  messagesDropped: 0, tokensDropped: 0, tokenizerUsed: "fixture", ...patch });
export const preview = (): DryRunResultDTO => ({ messages: [], breakdown: [], parameters: {}, model: "fixture", provider: "custom", contextClipStats: stats() });

test("audits effective block selections, category state, generation triggers and character tags", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [base, { ...base, id: "off", enabled: false }, { ...base, id: "disabledByProfile" },
    { ...base, id: "regen", injectionTrigger: ["regenerate"] }, { ...base, id: "tag", characterTagTrigger: ["Night City"] },
    { ...base, id: "wrongTag", characterTagTrigger: ["forest"] }, { ...base, id: "category", marker: "category", enabled: false }, { ...base, id: "child" }];
  data.active.block_states = { off: true, disabledByProfile: false };
  expect(effectiveBlocks(data).map(b => b.id)).toEqual(["main", "off", "tag", "child"]);
  data.preset!.prompt_order = [{ ...base, id: "category", marker: "category", content: "{{random::a::b}}", categoryMode: "radio" }, { ...base, id: "first" }, { ...base, id: "second" }];
  expect(effectiveBlocks(data).map(b => b.id)).toEqual(["category", "first"]);
});
test("constant lore is not automatically treated as stable; random macros and moving placement remain visible", () => {
  const data = sources(); data.lore = [{ bookId: "book", bookName: "Lore", scope: "Chat", entry: entry({ constant: true, content: "{{pick::red::blue}}", position: 4, depth: 3 }) }];
  const findings = analyze(data, preview()).findings;
  expect(findings.some(f => f.id === "activation-entry")).toBe(false);
  expect(findings.some(f => f.id === "lore-entry-random")).toBe(true);
  expect(findings.some(f => f.id === "lore-depth-entry")).toBe(true);
  expect(scanText("{{if::x}}{{random::1::5}}{{/if}} {{time}} {{memory}}", "Source", "id").map(f => f.id)).toEqual(["id-random", "id-dynamic-clock"]);
});
test("actual clipping and full context are flagged; estimated headroom is not", () => {
  expect(clippingFindings(stats({ messagesDropped: 2 }))[0]).toMatchObject({ level: "issue", id: "context-clipping" });
  expect(clippingFindings(stats({ messagesDropped: 2 }))[0].suggestion).toContain("LumiBooks");
  expect(clippingFindings(stats({ remainingHistoryBudget: 1400 }))).toEqual([]);
  expect(clippingFindings(stats({ remainingHistoryBudget: 1000 }))[0].id).toBe("context-full");
  expect(clippingFindings(stats({ budgetInvalid: true }))[0].id).toBe("context-overflow");
  expect(clippingFindings(undefined)).toEqual([]);
});
test("all source pages are read, including findings beyond the first 200 entries", async () => {
  const offsets: number[] = [];
  const rows = await allPages(async offset => { offsets.push(offset); return { total: 451, data: Array.from({ length: Math.min(200, 451 - offset) }, (_, i) => offset + i) }; });
  expect(offsets).toEqual([0, 200, 400]); expect(rows.at(-1)).toBe(450);
  await expect(allPages(async () => ({ total: 1, data: [] }))).rejects.toThrow("changed");
});
test("provider usage preserves a reported zero and distinguishes missing data", () => {
  const saved: SavedBreakdownDTO = { model: "model", provider: "custom", entries: [], totalTokens: 0, maxContext: 0,
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, provider_raw: { prompt_tokens_details: { cached_tokens: 0 } } } };
  expect(reportedUsage(saved, "m")?.read).toBe(0); expect(reportedUsage(saved, "m")?.write).toBeUndefined();
  expect(reportedUsage(null, "m")).toBeUndefined();
});
test("future scenarios are reproducible and never put two user turns in a row", () => {
  const one = scenarios("seed", false);
  expect(one).toEqual(scenarios("seed", false));
  expect(one.scenarios.map(scenario => scenario.name)).toEqual(["Reference", "Regenerate", "New turn"]);
  expect(one.scenarios[0].messages).toHaveLength(0); expect(one.scenarios[1].messages).toHaveLength(0);
  expect(one.scenarios[2].messages.map(message => message.role)).toEqual(["user"]);
  expect(scenarios("seed", true).scenarios[2].messages.map(message => message.role)).toEqual(["assistant", "user"]);
});
test("past turns are the latest five plus the turn they build from", () => {
  const messages = Array.from({ length: 21 }, (_, i) => ({ is_user: i % 2 === 1, content: "text" }));
  expect(historicalCutoffs(messages)).toEqual([10, 12, 14, 16, 18, 20]);
  expect(historicalCutoffs(messages.slice(0, 5))).toEqual([2, 4]);
  expect(historicalCutoffs(messages.slice(0, 2))).toEqual([]);
});
test("disposable imports preserve visible content without copying variable rollback ownership", () => {
  const source = { chat: { id: "source", character_id: "character", metadata: { _swipe_variable_state: { owner: "m" }, chat_variables: { tone: "quiet" }, context_history_anchor_message_id: "m", branched_from: "parent" } },
    messages: [{ id: "m", content: "Hello", name: "User", is_user: true, extra: { variableStateBySwipe: [{ before: {} }], attachments: ["image"] } }] };
  const original = JSON.stringify(source), ticket = { id: "job", sourceChatId: "source", lastMessageId: "m", branchName: "Simulation" };
  const copy = simulationCopy(source, ticket);
  expect(copy.chat.metadata._swipe_variable_state).toBeUndefined(); expect(copy.messages[0].extra.variableStateBySwipe).toBeUndefined();
  expect(copy.chat.metadata.chat_variables).toEqual({ tone: "quiet" }); expect(copy.messages[0].extra.attachments).toEqual(["image"]);
  expect(copy.chat.metadata.lumicache_simulation_anchor).toBe(0); expect(JSON.stringify(source)).toBe(original);
  expect(() => simulationCopy(source, { ...ticket, lastMessageId: "changed" })).toThrow("changed");
});
test("audio file references are not duplicated and selected swipe metadata stays aligned", () => {
  const source = { chat: { id: "source", character_id: "character", metadata: {} }, messages: [{ id: "m", content: "selected", name: "User", is_user: true,
    swipes: ["old", "selected"], swipe_id: 1, extra: { attachments: [{ type: "audio", image_id: "owned-audio" }, { type: "image", image_id: "shared-image" }], reasoningBySwipe: ["old reasoning", "selected reasoning"] } }] };
  const copy = simulationCopy(source, { id: "job", sourceChatId: "source", lastMessageId: "m", branchName: "Copy" });
  expect(copy.messages[0].extra.attachments).toEqual([{ type: "image", image_id: "shared-image" }]);
  expect(copy.messages[0].swipe_id).toBe(1); expect(copy.chat.metadata.lumicache_omitted_audio).toBe(1);
  expect(source.messages[0].extra.attachments).toHaveLength(2);
});
