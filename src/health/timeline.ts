import type { AssemblyBreakdownEntryDTO, LlmMessageDTO } from "lumiverse-spindle-types";
import { alignMessages } from "../prompt-store";
import type { Comparison, Snapshot } from "../shared";
import type { OutlineTurn, StepTimeline, TimelineRow, TurnKind, TurnPart } from "./types";

type Flags = LlmMessageDTO & { __chatHistorySource?: boolean; __worldInfoSource?: boolean; __sourceMessageId?: string; __sourceIndexInChat?: number };
const MAX_PARTS = 16, MIN_SEARCH = 8;

/** Dry runs carry the host's internal markers; interceptors see the public names. */
export function normalizedHistory(message: LlmMessageDTO): LlmMessageDTO {
  const flags = message as Flags;
  const history = flags.__isChatHistory === true || flags.__chatHistorySource === true;
  return { role: message.role, content: message.content, name: message.name, ...(history ? { __isChatHistory: true } : {}),
    ...(flags.sourceMessageId ?? flags.__sourceMessageId ? { sourceMessageId: flags.sourceMessageId ?? flags.__sourceMessageId } : {}),
    ...(flags.sourceIndexInChat ?? flags.__sourceIndexInChat) !== undefined ? { sourceIndexInChat: flags.sourceIndexInChat ?? flags.__sourceIndexInChat } : {} } as LlmMessageDTO;
}
function entryKind(entry: AssemblyBreakdownEntryDTO, injected: boolean): TurnKind {
  if (entry.type === "world_info") return "world";
  if (["long_term_memory", "databank", "databank_mention"].includes(entry.type)) return "memory";
  if (entry.type === "extension" || entry.extensionId) return "extension";
  if (entry.marker === "persona_description") return "persona";
  if (["char_description", "char_personality", "scenario", "dialogue_examples", "jailbreak"].includes(entry.marker ?? "")) return "character";
  return injected || ["authors_note", "utility"].includes(entry.type) ? "injection" : "system";
}
const RANK: Record<TurnKind, number> = { world: 0, memory: 0, extension: 0, persona: 1, character: 1, injection: 2, system: 2, story: 3, other: 3 };
function free(start: number, end: number, covered: [number, number][]): [number, number][] {
  const result: [number, number][] = []; let cursor = start;
  for (const [from, to] of covered) {
    if (to <= cursor || from >= end) continue;
    if (from > cursor) result.push([cursor, from]);
    cursor = Math.max(cursor, to);
  }
  if (cursor < end) result.push([cursor, end]);
  return result;
}
function clean(text: string, size: number) { const value = text.replace(/\s+/g, " ").trim(); return value.length > size ? `${value.slice(0, size - 1)}…` : value; }
/** Name each assembled message, and the ranges inside it, after the breakdown entries that produced it. */
export function promptOutline(snapshot: Snapshot, messages: LlmMessageDTO[], breakdown: AssemblyBreakdownEntryDTO[]): OutlineTurn[] {
  const flags = messages as Flags[], history = (m?: Flags) => m?.__isChatHistory === true || m?.__chatHistorySource === true;
  const firstHistory = flags.findIndex(history);
  const entries = breakdown.filter(entry => entry.type !== "chat_history" && entry.content?.trim()).map(entry => ({ entry, text: entry.content!.trim() }));
  return snapshot.messages.map((message, index) => {
    const source = flags[index], text = message.body, role = message.role;
    const base = { role, preview: clean(text, 110), characters: text.length };
    if (history(source)) {
      const label = clean(source.name || (role === "user" ? "User" : role === "assistant" ? "Assistant" : "System"), 60);
      const chatIndex = source.sourceIndexInChat ?? source.__sourceIndexInChat;
      return { ...base, kind: "story" as const, label, injected: false, ...(chatIndex !== undefined ? { chatIndex } : {}), parts: [{ kind: "story" as const, label, start: 0, end: text.length }] };
    }
    const injected = firstHistory >= 0 && index > firstHistory;
    const fallback: TurnKind = source?.__worldInfoSource ? "world" : injected ? "injection" : "system";
    const parts: TurnPart[] = [], covered: [number, number][] = [];
    const ranked = entries.map(item => ({ ...item, kind: entryKind(item.entry, injected) })).sort((a, b) => RANK[a.kind] - RANK[b.kind] || b.text.length - a.text.length);
    for (const { entry, text: content, kind } of ranked) {
      if (content.length < MIN_SEARCH && content !== text.trim()) continue;
      const start = text.indexOf(content); if (start < 0) continue;
      const label = clean(entry.extensionName && kind === "extension" ? `${entry.extensionName}: ${entry.name}` : entry.name, 120);
      for (const [from, to] of free(start, start + content.length, covered)) { parts.push({ kind, label, start: from, end: to }); covered.push([from, to]); }
      covered.sort((a, b) => a[0] - b[0]);
    }
    for (const [from, to] of free(0, text.length, covered)) if (text.slice(from, to).trim()) parts.push({ kind: fallback, label: fallback === "world" ? "World info" : injected ? "Injected text" : "Prompt text", start: from, end: to });
    parts.sort((a, b) => a.start - b.start);
    const merged: TurnPart[] = [];
    for (const part of parts) { const last = merged.at(-1); if (last?.label === part.label && last.kind === part.kind) last.end = part.end; else merged.push({ ...part }); }
    const bounded = merged.length > MAX_PARTS ? [...merged.slice(0, MAX_PARTS - 1), { ...merged[MAX_PARTS - 1], end: merged.at(-1)!.end, label: `${merged.length - MAX_PARTS + 1} more sources` }] : merged;
    const largest = [...bounded].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    const names = new Set(bounded.map(part => part.label));
    return { ...base, kind: largest?.kind ?? fallback, injected, parts: bounded,
      label: largest ? `${largest.label}${names.size > 1 ? ` +${names.size - 1}` : ""}` : "Empty message" };
  });
}
function changedRange(before: string, after: string): { before: [number, number]; after: [number, number] } {
  const end = Math.min(before.length, after.length); let prefix = 0, suffix = 0;
  while (prefix < end && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  while (suffix < end - prefix && before.charCodeAt(before.length - suffix - 1) === after.charCodeAt(after.length - suffix - 1)) suffix++;
  return { before: [prefix, Math.max(prefix + 1, before.length - suffix)], after: [prefix, Math.max(prefix + 1, after.length - suffix)] };
}
const touched = (turn: OutlineTurn | undefined, [from, to]: [number, number]) => (turn?.parts ?? []).filter(part => part.start < to && part.end > from).map(part => part.label);
/** Providers cache a prefix, so everything after the first difference is written again even when it is identical. */
export function buildTimeline(before: Snapshot | null, beforeOutline: OutlineTurn[] | null, after: Snapshot, afterOutline: OutlineTurn[], comparison: Comparison, tolerated = false): StepTimeline {
  const rows: TimelineRow[] = [];
  const row = (status: TimelineRow["status"], oldIndex: number | undefined, newIndex: number | undefined, root: boolean, sources: string[], headerChanged = false) => {
    const turn = (newIndex !== undefined ? afterOutline[newIndex] : beforeOutline?.[oldIndex!])!, total = Math.max(1, turn.characters);
    // The tail is measured on the previous prompt, so rows it had keep that depth. Added rows say where they land next.
    const depth = before ? oldIndex !== undefined ? before.messages[oldIndex]?.depth : undefined : after.messages[newIndex!]?.depth;
    const nextDepth = before && oldIndex === undefined ? after.messages[newIndex!]?.depth : undefined;
    // A changed message is named for the part that changed, not its largest part.
    const names = [...new Set(sources)], culprit = status === "changed" ? turn.parts.find(part => part.label === names[0]) : undefined;
    const kind = culprit?.kind ?? turn.kind, label = culprit ? `${culprit.label}${names.length > 1 ? ` +${names.length - 1}` : ""}` : turn.label;
    rows.push({ ...(oldIndex !== undefined ? { oldIndex } : {}), ...(newIndex !== undefined ? { newIndex } : {}), status, ...(root ? { root } : {}), role: turn.role, kind, label, preview: turn.preview,
      characters: turn.characters, injected: turn.injected, ...(turn.chatIndex !== undefined ? { chatIndex: turn.chatIndex } : {}), ...(depth !== undefined ? { depth } : {}), ...(nextDepth !== undefined ? { nextDepth } : {}), headerChanged,
      parts: turn.parts.map(part => ({ kind: part.kind, label: part.label, share: (part.end - part.start) / total })), sources: [...new Set(sources)] });
  };
  if (!before) afterOutline.forEach((turn, index) => row("base", undefined, index, false, turn.parts.map(part => part.label)));
  else {
    const { pairs } = alignMessages(before.messages, after.messages);
    let broken = comparison.routeChanged, consumed = 0;
    for (const [oldIndex, newIndex] of pairs) {
      if (oldIndex !== undefined) consumed++;
      const old = oldIndex === undefined ? undefined : before.messages[oldIndex], next = newIndex === undefined ? undefined : after.messages[newIndex];
      if (old && next && old.header === next.header && old.body === next.body) { row(broken ? "rewritten" : "kept", oldIndex, newIndex, false, []); continue; }
      if (old && next) {
        const range = changedRange(old.body, next.body), sources = [...touched(beforeOutline?.[oldIndex!], range.before), ...touched(afterOutline[newIndex!], range.after)];
        // A growing final message keeps its prefix, as with Continue and assistant prefill.
        if (!broken && consumed === before.messages.length && old.header === next.header && next.body.startsWith(old.body)) { row("new", oldIndex, newIndex, false, sources); continue; }
        row("changed", oldIndex, newIndex, !broken, sources, old.header !== next.header); broken = true; continue;
      }
      if (next) {
        const sources = afterOutline[newIndex!].parts.map(part => part.label);
        if (consumed === before.messages.length) { row("new", undefined, newIndex, false, sources); continue; }
        row("added", undefined, newIndex, !broken, sources); broken = true; continue;
      }
      row("removed", oldIndex, undefined, !broken, (beforeOutline?.[oldIndex!].parts ?? []).map(part => part.label)); broken = true;
    }
  }
  const sum = (...statuses: TimelineRow["status"][]) => rows.filter(item => statuses.includes(item.status) && item.newIndex !== undefined).reduce((n, item) => n + item.characters, 0);
  return { rows, kept: sum("kept", "base"), rewritten: sum("rewritten", "changed", "added"), added: sum("new"), problems: rows.filter(item => ["changed", "added", "removed"].includes(item.status)).length, tolerated, routeChanged: comparison.routeChanged };
}
