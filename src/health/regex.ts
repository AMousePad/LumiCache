import type { RegexScriptDTO } from "lumiverse-spindle-types";
import { scanText } from "./macro-findings";
import type { MacroOptions } from "./macros";
import type { Finding } from "./types";
/** The text of a prompt rule whose macros the host will run. */
export function regexMacroFields(script: RegexScriptDTO, preset: boolean): [string, string][] {
  if (script.disabled || !script.target?.includes("prompt") || !script.placement?.length) return [];
  const fields: [string, string][] = [];
  if (script.substitute_macros && script.substitute_macros !== "none") fields.push(["Match pattern", script.find_regex]);
  // The native preset pipeline resolves macros again after prompt regexes, even in 'none'/'find' mode.
  if (preset || ["raw", "escaped", "after"].includes(script.substitute_macros)) fields.push(["Replacement", script.replace_string]);
  return fields;
}
export function regexFindings(scripts: RegexScriptDTO[], preset: boolean, options: MacroOptions): Finding[] {
  const result: Finding[] = [];
  for (const script of scripts) {
    if (script.disabled || !script.target?.includes("prompt") || !script.placement?.length) continue;
    const location = { category: "Regex" as const, group: script.scope === "chat" ? "Chat" : script.scope === "character" ? "Character" : "Global / preset", item: script.name, itemId: script.id };
    const source = `Regex: ${script.name}`, add = (id: string, level: "issue" | "risk", title: string, detail: string, evidence?: string[]) => result.push({ ...location, source, id: `regex-${script.id}-${id}`, level, title, detail, evidence,
      suggestion: level === "issue" ? "Use stable replacements without moving depth limits in the cached prefix." : "Compare a simulation or the Cache Diff to check this operation's effect." });
    const history = script.placement.some(value => value === "user_input" || value === "ai_output");
    // Older messages never change again, so the deepest edge of the window is how much of the tail moves.
    const min = script.min_depth ?? 0, max = script.max_depth ?? null, ended = max !== null && max >= 0, depth = ended ? max + 1 : min;
    if (history && depth > 0 && (!ended || max >= min)) result.push({ ...location, source, category: "Depth Mutable", group: `Regex · ${location.group}`, groupId: `regex:${script.scope}`, id: `regex-${script.id}-depth`, level: "depth", depth, problematic: depth > 5, title: `Depth ${depth}`, evidence: [`Depth ${min}–${ended ? max : "any"}`],
      detail: ended ? `This rule stops applying once a message passes depth ${max}, which rewrites that message. Older messages stay stable.` : "This rule starts applying to a message at this depth and keeps applying, so older messages stay stable.", suggestion: "Compared with your acceptable depth and optional history-token limit." });
    const activation = script.metadata?.prompt_activation as { mappings?: unknown[]; lifetime?: string } | undefined;
    if (script.preset_id && activation?.mappings?.length) add("activation", "issue", "Changes preset block activation", "Regex matches enable or disable preset blocks as conversation input changes.", [activation.lifetime === "chat" ? "Chat-wide activation" : "Latest-message activation"]);
    const actions = Array.isArray(script.metadata?.match_actions) ? script.metadata.match_actions.filter((value: unknown) => ["move_top", "move_bottom", "repeat_back"].includes(String(value))) : [];
    if (actions.length) add("operations", "risk", "Moves or repeats matched text", "These operations rearrange text or reuse a prior message's match. Their effect on the prefix depends on the matched content and history.", actions.map((value: unknown) => String(value)));
    for (const [field, text] of regexMacroFields(script, preset)) result.push(...scanText(text, `${source} / ${field}`, `regex-${script.id}-${field}`, { ...options, unknownCaptures: field === "Replacement" }).map(finding => ({ ...finding, ...location, title: `${field}: ${finding.title.toLowerCase()}` })));
  }
  return result;
}
