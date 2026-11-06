import type { ChatMessageDTO, ContextClipStatsDTO, DryRunResultDTO, PromptBlockSnapshotDTO, SavedBreakdownDTO } from "lumiverse-spindle-types";
import type { Sources } from "./sources";
import type { CacheUsage, Finding, HealthReport } from "./types";

import { scanText } from "./macro-findings";
export { scanText } from "./macro-findings";
import { scanMacros, type ChangingVariable, type MacroOptions } from "./macros";
import { compositionFindings } from "./composition";
import { regexFindings, regexMacroFields } from "./regex";
import { historyTemplate, includedHistory } from "./history";
import { ScanLimit } from "./macro-syntax";
const STRUCTURAL = new Set(["chat_history", "world_info_before", "world_info_after", "char_description", "char_personality", "persona_description", "scenario", "dialogue_examples"]);
const normalizeTag = (tag: string) => tag.normalize("NFKC").trim().toLowerCase().replace(/[\s._\-:/\\|()[\]{}+,;'"`~!?@#$%^&*=<>]+/g, "");
export function effectiveBlocks(sources: Sources): PromptBlockSnapshotDTO[] {
  let radio = false, selected = false;
  return (sources.preset?.prompt_order ?? []).filter(block => {
    const enabled = sources.active.block_states[block.id] ?? block.enabled;
    if (block.marker === "category") { radio = block.categoryMode === "radio"; selected = false; }
    else if (enabled && radio) { if (selected) return false; selected = true; }
    if (!enabled || (block.marker === "category" && !block.content.trim()) || (block.injectionTrigger?.length && !block.injectionTrigger.includes("normal"))) return false;
    const tags = block.characterTagTrigger?.map(normalizeTag).filter(Boolean) ?? [];
    return !tags.length || (sources.character?.tags ?? []).map(normalizeTag).some(tag => tags.some(need => tag.includes(need)));
  });
}
export function clippingFindings(stats?: ContextClipStatsDTO): Finding[] {
  if (!stats) return [];
  const base = { category: "Context" as const, source: "Context", suggestion: "Turn on Cache Friendly mode in LumiBooks to keep history from overflowing." };
  if (stats.budgetInvalid || stats.fixedOverBudget || stats.anchorOverflow) return [{ ...base, id: "context-overflow", level: "issue", title: "Prompt exceeds the context budget",
    detail: `Fixed prompt: ${stats.fixedTokens.toLocaleString()} tokens. Input budget: ${stats.inputBudget.toLocaleString()}.` }];
  if (stats.messagesDropped > 0) return [{ ...base, id: "context-clipping", level: "issue", title: "History is being clipped",
    detail: `${stats.messagesDropped.toLocaleString()} earlier messages are excluded from the prompt.` }];
  if (stats.enabled && stats.remainingHistoryBudget <= stats.chatHistoryTokensAfter) return [{ ...base, id: "context-full", level: "issue", title: "Context is full",
    detail: "There is no room for another turn without clipping history." }];
  return [];
}
export function reportedUsage(saved: SavedBreakdownDTO | null, messageId: string): CacheUsage | undefined {
  const raw = saved?.usage?.provider_raw as Record<string, any> | undefined;
  if (!raw) return;
  // Routers can fill in several of these at once, some with a zero, so the largest is the real count.
  const largest = (...values: unknown[]) => {
    const found = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
    return found.length ? Math.max(...found) : undefined;
  };
  const read = largest(raw.cache_read_input_tokens, raw.prompt_tokens_details?.cached_tokens, raw.input_tokens_details?.cached_tokens, raw.cachedContentTokenCount, raw.prompt_cache_hit_tokens, raw.cached_tokens);
  const write = largest(raw.cache_creation_input_tokens, raw.prompt_tokens_details?.cache_write_tokens, raw.input_tokens_details?.cache_write_tokens);
  return read === undefined && write === undefined ? undefined : { read, write, model: saved!.model, messageId };
}
/**
 * Usage from a finished send. Some providers leave the cached count out on a miss, so a prompt size with no count reads as zero.
 * That is only meaningful after a reply that did report a count, which the guard's comparison already requires.
 */
export function sentUsage(usage: unknown): Pick<CacheUsage, "read" | "write"> | undefined {
  const found = reportedUsage({ usage } as SavedBreakdownDTO, "");
  if (found) return found;
  const raw = (usage as { provider_raw?: Record<string, unknown> } | null | undefined)?.provider_raw;
  return raw && [raw.prompt_tokens, raw.input_tokens, raw.promptTokenCount].some(value => typeof value === "number") ? { read: 0 } : undefined;
}
const WRITES = /counter|toggle|(?:set|inc|dec|add|delete|flush)(?:global|chat|g)?var|[.$@][\w-]+\s*(?:=|\+\+|--|\+=|-=)/i;
/** The settings a preset exposes to its user, which also back {{var::name}}. */
function presetSettings(sources: Sources): Record<string, string> {
  const saved = (sources.preset?.metadata as { promptVariables?: Record<string, Record<string, unknown>> } | undefined)?.promptVariables, settings: Record<string, string> = {};
  for (const block of sources.preset?.prompt_order ?? []) for (const variable of block.variables ?? []) {
    const value = saved?.[block.id]?.[variable.name] ?? (variable as { defaultValue?: unknown }).defaultValue;
    settings[variable.name] = typeof value === "string" || typeof value === "number" ? String(value) : "";
  }
  return settings;
}
/**
 * Variables cross sources, so a check in one can inherit a write in another.
 * A write is changing if its value moves, if the branch around it moves, or if the text only runs sometimes.
 */
function variableWrites(sources: Sources, blocks: ReturnType<typeof effectiveBlocks>, options: MacroOptions, history: ChatMessageDTO[]) {
  const texts: { text: string; source: string; firm: boolean; gated?: string }[] = [];
  for (const block of blocks) if (!STRUCTURAL.has(block.marker ?? "")) texts.push({ text: block.content, source: `preset block "${block.name}"`, firm: true, gated: block.injectionTrigger?.length ? "for some generation types" : undefined });
  // Blocks left out of a normal send still run on the generation types they name.
  for (const block of sources.preset?.prompt_order ?? []) if ((sources.active.block_states[block.id] ?? block.enabled) && block.injectionTrigger?.length && !blocks.includes(block) && !STRUCTURAL.has(block.marker ?? "")) texts.push({ text: block.content, source: `preset block "${block.name}"`, firm: false, gated: "for some generation types" });
  for (const { entry } of sources.lore) texts.push({ text: entry.content, source: `lore entry "${entry.comment || entry.uid}"`, firm: entry.constant, gated: entry.constant ? undefined : "when it activates" });
  for (const script of sources.regex) for (const [, text] of regexMacroFields(script, !!sources.preset)) texts.push({ text, source: `regex "${script.name}"`, firm: false, gated: "when it matches" });
  if (sources.character) for (const key of ["description", "personality", "scenario", "system_prompt", "post_history_instructions"] as const) texts.push({ text: String(sources.character[key] ?? ""), source: `character ${key}`, firm: false });
  if (sources.persona) texts.push({ text: sources.persona.description, source: "persona", firm: false });
  // Hidden or clipped messages never run their macros, so only the included history can write.
  for (const message of history) texts.push({ text: historyTemplate(message), source: `message ${(message.index_in_chat ?? 0) + 1}`, firm: false });
  const writing = texts.filter(item => item.text?.includes("{{") && WRITES.test(item.text));
  const changing: Record<string, ChangingVariable> = {}, writers: Record<string, string[]> = {}, written: Record<string, string[]> = {};
  const name = (id: string) => id.slice(id.indexOf(":") + 1);
  const taint = (id: string, kind: ChangingVariable["kind"], level: ChangingVariable["level"], reason: string) => {
    if (changing[id]?.level === "issue" || changing[id]?.level === level) return;
    changing[id] = { kind, level, reason };
  };
  // The second pass catches a variable copied from a changing one.
  for (let pass = 0; pass < 2; pass++) for (const { text, source, firm, gated } of writing) {
    const scan = scanMacros(text, { ...options, changing });
    for (const write of scan.writes) taint(write.id, write.kind, firm ? write.level : "risk", `${source} writes a changing value to "${name(write.id)}", so anything checking or reading it can change.`);
    for (const set of scan.sets) {
      if (set.value !== undefined && !written[set.id]?.includes(set.value)) (written[set.id] ??= []).push(set.value);
      if (gated) { taint(set.id, "state", "risk", `${source} only runs ${gated}, and it sets "${name(set.id)}", so anything checking or reading it can change.`); continue; }
      const label = set.value === undefined ? source : `${source} (to "${set.value.length > 30 ? `${set.value.slice(0, 30)}…` : set.value}")`;
      if (!writers[set.id]?.includes(label)) (writers[set.id] ??= []).push(label);
    }
  }
  return { changing, writers, written };
}
export function analyze(sources: Sources, preview: DryRunResultDTO, usage?: CacheUsage): HealthReport {
  const findings: Finding[] = [], blocks = effectiveBlocks(sources);
  const calls: { name: string; level: "issue" | "risk" }[] = [];
  const variables: Record<string, string> = {};
  const stored = sources.chat.metadata.macro_variables as Record<string, unknown> | undefined;
  for (const [scope, prefix] of [["global", "gvar"], ["chat", "chatvar"]]) {
    const values = scope === "chat" ? sources.chat.metadata.chat_variables : stored?.[scope]; if (!values || typeof values !== "object") continue;
    for (const [key, value] of Object.entries(values)) if (typeof value === "string") variables[`${prefix}:${key}`] = value;
  }
  // Same reading of the chat as the host, so these macros resolve to what the host will emit.
  const chatData = sources.chat.metadata, group = !!chatData.group && Array.isArray(chatData.character_ids);
  const cardMode = !group ? "solo" : chatData.group_card_mode === "merge" || chatData.group_card_mode === "merge_ignore_muted" ? chatData.group_card_mode as string : "swap";
  // The host clears this when a room closes.
  const room = !!chatData.multiplayer_room_id, inRoom = room ? "yes" : "no";
  const options: MacroOptions = { variables, cardMode, room, characterTags: sources.character?.tags ?? [],
    constants: { ismultiplayer: inRoom, is_multiplayer: inRoom, ismultiplayerroom: inRoom, is_multiplayer_room: inRoom, isgroupchat: group ? "yes" : "no", is_group_chat: group ? "yes" : "no", groupcardmode: cardMode, group_card_mode: cardMode, ...(sources.input.composition?.available ? { loomsovhandactive: sources.input.composition.sovereign?.enabled ? "yes" : "no" } : {}) },
    onCall: call => { if (calls.length < 20_000) calls.push(call); } };
  const aliases: Record<string, string[]> = { description: ["description", "chardescription"], personality: ["personality", "charpersonality"], scenario: ["scenario", "charscenario"], system_prompt: ["charsystemprompt"], post_history_instructions: ["charposthistoryinstructions", "charinstruction", "charjailbreak", "jailbreak"] };
  const references: Record<string, string> = {};
  if (sources.character) for (const [field, names] of Object.entries(aliases)) for (const name of names) references[name] = String((sources.character as unknown as Record<string, unknown>)[field] ?? "");
  if (sources.persona) references.persona = references.userpersona = sources.persona.description;
  const expanded: MacroOptions = { ...options, references };
  options.settings = expanded.settings = presetSettings(sources);
  const historyActive = !sources.preset || blocks.some(block => block.marker === "chat_history");
  const history = includedHistory(historyActive ? sources.messages ?? [] : [], sources.chat.metadata, preview.contextClipStats);
  Object.assign(options, variableWrites(sources, blocks, { ...expanded, onCall: undefined }, history));
  expanded.changing = options.changing; expanded.writers = options.writers; expanded.written = options.written;
  for (const block of blocks) {
    const source = `Preset: ${sources.preset!.name} / ${block.name}`;
    const location = { category: "Preset" as const, group: sources.preset!.name, groupId: sources.preset!.id, item: block.name, itemId: block.id };
    if (!STRUCTURAL.has(block.marker ?? "")) findings.push(...scanText(block.content, source, `block-${block.id}`, options).map(finding => ({ ...finding, ...location })));
    if (block.position === "in_history") findings.push({ ...location, category: "Depth Mutable", group: `Preset · ${sources.preset!.name}`, groupId: `preset:${sources.preset!.id}`,
      id: `depth-${block.id}`, level: "depth", depth: block.depth, problematic: block.depth > 5, title: `Depth ${block.depth}`, source,
      detail: "This instruction follows its configured position in chat history.", suggestion: "Compared with your acceptable depth and optional history-token limit." });
  }
  for (const { bookId, bookName, scope, entry } of sources.lore) {
    const source = `${scope} lore: ${bookName} / ${entry.comment || entry.uid}`;
    const location = { category: "World info" as const, group: bookName, groupId: bookId, item: entry.comment || String(entry.uid), itemId: entry.id };
    if (!entry.constant) findings.push({ ...location, id: `activation-${entry.id}`, level: "issue", title: entry.vectorized ? "Vector activation" : "Keyword activation", source,
      detail: entry.vectorized ? "This entry enters or leaves the prompt as vector matches change." : "This entry enters or leaves the prompt as keyword matches change.",
      suggestion: "Use constant activation for lore that should stay in the cached prefix.",
      evidence: entry.use_probability && entry.probability < 100 ? [`Activation chance: ${entry.probability}%`] : undefined });
    if (entry.position === 4) findings.push({ ...location, category: "Depth Mutable", group: `World info · ${bookName}`, groupId: `world:${bookId}`,
      id: `lore-depth-${entry.id}`, level: "depth", depth: entry.depth, problematic: entry.depth > 5, title: `Depth ${entry.depth}`, source,
      detail: "This lore entry follows its configured position in chat history.", suggestion: "Compared with your acceptable depth and optional history-token limit." });
    findings.push(...scanText(entry.content, source, `lore-${entry.id}`, expanded).map(finding => ({ ...finding, ...location })));
  }
  // Follow references reached through nested arguments, selected branches and variable expansions.
  if (sources.character) for (const key of ["description", "personality", "scenario", "system_prompt", "post_history_instructions"] as const) {
    const markers: Record<string, string> = { description: "char_description", personality: "char_personality", scenario: "scenario" };
    const automatic = key === "post_history_instructions" && preview.breakdown.some(row => row.name === "Post-History Instructions" && row.marker === "jailbreak" && !row.blockId);
    const direct = automatic || blocks.some(block => !!markers[key] && block.marker === markers[key]);
    const reached = calls.filter(call => aliases[key].includes(call.name));
    if (!direct && !reached.length) continue;
    const conditional = !direct && reached.every(call => call.level === "risk");
    findings.push(...scanText(sources.character[key], `Character: ${sources.character.name} / ${key}`, `character-${key}`, expanded).map(finding => ({ ...finding, level: conditional && finding.level !== "variabled" ? "risk" as const : finding.level, category: "Character" as const, group: sources.character!.name, item: key.replaceAll("_", " ") })));
  }
  if (sources.persona) {
    const reached = calls.filter(call => ["persona", "userpersona"].includes(call.name)), direct = blocks.some(block => block.marker === "persona_description");
    if (direct || reached.length) findings.push(...scanText(sources.persona.description, `Persona: ${sources.persona.name}`, "persona", expanded).map(finding => ({ ...finding,
      level: !direct && finding.level !== "variabled" && reached.every(call => call.level === "risk") ? "risk" as const : finding.level, category: "Persona" as const, group: sources.persona!.name, item: "Description" })));
  }
  for (const [index, message] of history.entries()) {
    if (!message.content.includes("{{")) continue;
    const item = `Message ${(message.index_in_chat ?? index) + 1} · ${message.name || (message.is_user ? "You" : "Assistant")}`;
    try { findings.push(...scanText(historyTemplate(message), `History: ${item}`, `message-${message.id}`, expanded).map(finding => ({ ...finding, category: "History" as const, item, itemId: message.id }))); }
    catch (error) {
      if (!(error instanceof ScanLimit)) throw error;
      findings.push({ category: "History", item, itemId: message.id, id: `message-${message.id}-limit`, level: "risk", source: `History: ${item}`, title: "Literal data needs runtime inspection",
        detail: "This message exceeds the literal-data inspection budget.", suggestion: "Inspect its assembled output in simulation or the Cache Diff." });
    }
  }
  findings.push(...regexFindings(sources.regex, !!sources.preset, expanded));
  findings.push(...compositionFindings(sources.input.composition, calls, expanded, historyActive));
  const caching = sources.connection.metadata?.prompt_caching;
  if ((preview.provider === "anthropic" || sources.connection.provider === "anthropic") && caching !== true && (!caching || typeof caching !== "object" || Array.isArray(caching)))
    findings.push({ category: "Connection", id: "caching-disabled", level: "issue", title: "Prompt caching is off", source: "Connection", item: sources.connection.name,
      detail: "Caching is disabled for this Anthropic connection.", suggestion: "Enable prompt caching in its connection settings." });
  if (preview.worldInfoStats?.evictedByBudget) findings.push({ category: "World info", group: "Lore budget", id: "lore-budget", level: "issue", title: "Activated lore exceeds its budget", source: "Lore budget",
    detail: `${preview.worldInfoStats.evictedByBudget} activated entries were excluded.`, suggestion: "Review the world-info token budget and competing entries." });
  findings.push(...clippingFindings(preview.contextClipStats));
  for (const finding of findings) if (finding.level === "variabled") {
    const origin = finding.category ?? "Context";
    finding.groupId = `${origin}:${finding.groupId ?? finding.group ?? ""}`; finding.group = finding.group ? `${origin} · ${finding.group}` : origin; finding.category = "Variabled";
  }
  findings.sort((a, b) => Number(b.level === "issue") - Number(a.level === "issue"));
  return { chatId: sources.chat.id, at: Date.now(), preset: sources.preset?.name ?? "No preset", model: preview.model, provider: preview.provider,
    findings: findings.slice(0, 500), findingsOmitted: Math.max(0, findings.length - 500), blocksScanned: blocks.length, entriesScanned: sources.lore.length, clipping: preview.contextClipStats, usage };
}
