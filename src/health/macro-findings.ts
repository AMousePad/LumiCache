import { scanMacros, type MacroOptions, type VolatileMacro } from "./macros";
import type { Finding } from "./types";
const TITLES = { random: "Random output", clock: "Live date or time", turn: "Changing conversation value", state: "Variable operation", condition: "Conditional output", opaque: "Macro needs runtime inspection", variable: "Variable check" };
const DETAILS = { variable: "This text depends on a variable.", random: "This macro can produce different output each time the prompt is built.", clock: "This value changes with the clock.", turn: "This value depends on the current conversation, so rebuilding earlier prompt content can change it.", state: "This macro changes a variable and emits the result.", condition: "A runtime value controls which content enters the prompt.", opaque: "The output cannot be established by static inspection." };
export function effectFindings(effects: VolatileMacro[], source: string, id: string): Finding[] {
  const groups = new Map<string, VolatileMacro[]>();
  for (const effect of effects) { const key = `${effect.kind}:${effect.level}`; groups.set(key, [...groups.get(key) ?? [], effect]); }
  return [...groups.values()].map(rows => {
    const first = rows[0], suffix = first.kind === "clock" || first.kind === "turn" ? `dynamic-${first.kind}` : first.kind;
    return { id: `${id}-${suffix}${first.level === "risk" ? "-uncertain" : ""}`, level: first.level, source, title: TITLES[first.kind],
      evidence: [...new Set(rows.map(row => row.literal))].slice(0, 6),
      detail: [...new Set(rows.map(row => row.reason).filter((value): value is string => !!value))].slice(0, 2).join(" ") || DETAILS[first.kind],
      suggestion: first.level === "variabled" ? "Stable while this variable keeps its value. Changing it mid-chat rewrites everything after this point." : first.level === "issue" ? "Keep this value outside the stable prefix, or store a fixed result." : "Use simulation or the Cache Diff to check whether this changes the prefix." };
  });
}
export function scanText(content: string, source: string, id: string, options: MacroOptions = {}): Finding[] { return effectFindings(scanMacros(content, options).effects, source, id); }
