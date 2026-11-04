import { scanMacros, type MacroOptions, type VolatileMacro } from "./macros";
import { effectFindings } from "./macro-findings";
import type { CompositionSnapshot, Finding } from "./types";
const KINDS = ["style", "utility", "retrofit"] as const;
const LABELS = { style: "Narrative styles", utility: "Loom utilities", retrofit: "Retrofits" };
const MACROS = { style: "loomstyle", utility: "loomutils", retrofit: "loomretrofits" };
/** Accept only the read-only settings fields needed by the audit. */
export function compositionSnapshot(raw: unknown): CompositionSnapshot {
  const input = raw as CompositionSnapshot | null;
  if (!input || input.available !== true) return { available: false };
  const out: CompositionSnapshot = { available: true, incomplete: input.incomplete === true, filters: {}, selections: [] };
  const depth = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : fallback;
  if (input.sovereign) out.sovereign = { enabled: input.sovereign.enabled === true, excludeLastMessage: input.sovereign.excludeLastMessage !== false, includeMessageInPrompt: input.sovereign.includeMessageInPrompt !== false };
  for (const key of ["htmlTags", "detailsBlocks", "loomItems"] as const) {
    const value = input.filters?.[key]; if (!value) continue;
    out.filters![key] = { enabled: value.enabled === true, keepDepth: depth(value.keepDepth, key === "loomItems" ? 5 : 3), keepOnly: value.keepOnly === true,
      stripFonts: value.stripFonts === true, fontKeepDepth: depth(value.fontKeepDepth, 3) };
  }
  let chars = 0;
  for (const item of Array.isArray(input.selections) ? input.selections : []) {
    if (!item || !KINDS.includes(item.kind) || typeof item.content !== "string") continue;
    if ((chars += item.content.length) > 2_000_000 || out.selections!.length >= 200) { out.incomplete = true; continue; }
    out.selections!.push({ id: String(item.id ?? "").slice(0, 200), name: String(item.name ?? "Loom item").slice(0, 300), kind: item.kind, content: item.content });
  }
  return out;
}
export function compositionFindings(snapshot: CompositionSnapshot | undefined, calls: { name: string; level: "risk" | "issue" }[], options: MacroOptions, historyActive = true): Finding[] {
  const result: Finding[] = [], base = { category: "Compose" as const, source: "Compose" };
  if (!snapshot?.available) return [{ ...base, id: "compose-unavailable", level: "risk", title: "Compose settings unavailable", detail: "This check could not read the Compose configuration.", suggestion: "Refresh health in a connected Lumiverse browser." }];
  const add = (id: string, item: string, detail: string, evidence: string[]) => result.push({ ...base, group: "Context filters", item, id, level: "issue", title: "Changes older messages", detail, evidence, suggestion: "Disable the moving depth filter to keep earlier prompt text stable." });
  for (const key of ["htmlTags", "detailsBlocks", "loomItems"] as const) {
    const filter = snapshot.filters?.[key]; if (!historyActive || !filter?.enabled) continue;
    const name = key === "htmlTags" ? "HTML tags" : key === "detailsBlocks" ? "Details blocks" : "Loom tags";
    if (filter.keepDepth > 0) add(`compose-${key}`, name, "Messages are treated differently as they leave the recent-message window.", [`Keep in last ${filter.keepDepth} messages`, filter.keepOnly ? "Keep only matching content" : "Strip matching content"]);
    if (key === "htmlTags" && filter.stripFonts && (filter.fontKeepDepth ?? 3) > 0) add("compose-fonts", "Font tags", "Font tags are removed when a message leaves the recent-message window.", [`Keep in last ${filter.fontKeepDepth ?? 3} messages`]);
  }
  const active = new Map<string, "issue" | "risk">();
  for (const call of calls) if (active.get(call.name) !== "issue") active.set(call.name, call.level);
  const visited = new Set<string>();
  // Follow selected Loom content transitively: a style may invoke a utility or retrofit.
  for (let pass = 0; pass < 3; pass++) for (const item of snapshot.selections ?? []) {
    const level = active.get(MACROS[item.kind]), id = `${item.kind}:${item.id}`;
    if (!level || visited.has(id)) continue; visited.add(id);
    const scan = scanMacros(item.content, options);
    const effects: VolatileMacro[] = level === "risk" ? scan.effects.map(effect => effect.kind === "variable" ? effect : { ...effect, level: "risk", reason: "The containing Loom selection is conditional." }) : scan.effects;
    result.push(...effectFindings(effects, `Compose: ${LABELS[item.kind]} / ${item.name}`, `compose-${id}`).map(finding => ({ ...finding, category: "Compose" as const, group: LABELS[item.kind], item: item.name, itemId: item.id })));
    for (const call of scan.calls) if (active.get(call.name) !== "issue") active.set(call.name, level === "risk" ? "risk" : call.level);
  }
  if (snapshot.sovereign?.enabled) for (const name of ["loomsovhand", "loomcontinueprompt"]) {
    const level = active.get(name); if (!level) continue;
    result.push({ ...base, group: "Sovereign Hand", item: name === "loomsovhand" ? "Co-pilot prompt" : "Continuation prompt", id: `compose-${name}`, level,
      title: "Changes with the current turn", evidence: [`{{${name}}}`], detail: "This enabled Compose prompt changes with the latest speaker or user directive.", suggestion: "Keep the changing directive after the stable prefix." });
  }
  if (snapshot.incomplete) result.push({ ...base, id: "compose-limit", level: "risk", title: "Some Loom content was not inspected", detail: "Selected Loom content exceeds the 200-item or 2-million-character inspection budget.", suggestion: "Use simulation and the Cache Diff for the remaining content." });
  return result;
}
