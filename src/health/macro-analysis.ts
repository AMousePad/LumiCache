import { parseMacros, ScanLimit, type Node, type Call } from "./macro-syntax";
import { ABSORBING, CARD, CLOCK, DELETES, FIXED, FOCUS, KEY_WRITES, PEEKS, PURE, RETRIEVED, ROOM_TURN, SETTINGS, TURN } from "./macro-catalog";
export type MacroKind = "random" | "clock" | "turn" | "state" | "condition" | "opaque" | "variable";
export interface VolatileMacro { name: string; literal: string; kind: MacroKind; level: "issue" | "risk" | "variabled"; reason?: string }
// `reads` remembers which outside variables a stored value came from.
// `possible` holds the values a writer may have stored when the current one is unknown.
interface Value { text?: string; effects: VolatileMacro[]; assigned?: boolean; reads?: string[]; possible?: string[] }
/** A variable some source writes a changing value to, so reading it anywhere can change the prompt. */
export interface ChangingVariable { kind: MacroKind; level: "issue" | "risk"; reason: string }
export interface MacroOptions { changing?: Record<string, ChangingVariable>; writers?: Record<string, string[]>; /** Literal values other sources store in a variable. */ written?: Record<string, string[]>; settings?: Record<string, string>; /** How group chats use character cards: solo, swap, merge or merge_ignore_muted. */ cardMode?: string; /** Whether this chat has an open multiplayer room. */ room?: boolean; variables?: Record<string, string>; constants?: Record<string, string>; references?: Record<string, string>; characterTags?: string[]; unknownCaptures?: boolean; onCall?: (call: MacroScan["calls"][number]) => void }
export interface MacroScan { effects: VolatileMacro[]; calls: { name: string; literal: string; level: "issue" | "risk" }[]; writes: { id: string; kind: MacroKind; level: "issue" | "risk" }[]; sets: { id: string; value?: string }[] }
const TRANSPARENT = new Set(["upper", "lower", "capitalize", "trim", "reverse"]);
const ALIASES: Record<string, string> = { where: "filter", any: "some", all: "every", for_each_message: "foreachmessage", for_each_var: "foreachvar", for_each_chat_var: "foreachchatvar", foreachgvar: "foreachglobalvar", for_each_global_var: "foreachglobalvar", var: "getvar", promptvar: "getvar", presetvar: "getvar", uppercase: "upper", toupper: "upper", lowercase: "lower", tolower: "lower", titlecase: "capitalize", getglobalvar: "getgvar", setglobalvar: "setgvar", incglobalvar: "incgvar", decglobalvar: "decgvar", addglobalvar: "addgvar", withvar: "let", scope: "let", elif: "elseif", fallback: "default", coalesce: "default", each: "foreach", for_each: "foreach", collect: "map", random_tag: "randomtag", randomchartag: "randomtag" };
const empty = (): Value => ({ text: "", effects: [] });
const unique = (effects: VolatileMacro[]) => {
  const values = new Map<string, VolatileMacro>();
  for (const effect of effects) { const key = `${effect.kind}:${effect.literal}`; if (values.get(key)?.level !== "issue") values.set(key, effect); }
  const retained = new Map<string, number>();
  return [...values.values()].filter(value => { const key = `${value.kind}:${value.level}`, count = retained.get(key) ?? 0; retained.set(key, count + 1); return count < 6; });
};
// A plain variable check stays one wherever it is nested.
const uncertain = (effects: VolatileMacro[], reason: string) => effects.map(effect => effect.kind === "variable" ? effect : { ...effect, level: "risk" as const, reason });
const combine = (values: Value[], separator = ""): Value => {
  const length = values.reduce((sum, value) => sum + (value.text?.length ?? 0) + separator.length, 0);
  if (length > 32_000_000) throw new ScanLimit();
  return { text: values.every(value => value.text !== undefined) ? values.map(value => value.text).join(separator) : undefined, effects: unique(values.flatMap(value => value.effects)), possible: values.length === 1 ? values[0].possible : undefined };
};
const list = (text: string, delimiter = ",") => (delimiter ? text.split(delimiter) : [text]).map(value => value.trim()).filter(Boolean);
function truth(text: string | undefined): boolean | undefined {
  if (text === undefined || /(^|\s)[.$@][a-z]/i.test(text)) return undefined;
  let value = text.trim(), negate = false;
  if (value.startsWith("!")) { negate = true; value = value.slice(1).trim(); }
  const comparison = /^(.*?)(==|!=|>=|<=|>|<)(.*)$/s.exec(value);
  let result: boolean;
  if (comparison) {
    const left = comparison[1].trim(), right = comparison[3].trim(), a = parseFloat(left), b = parseFloat(right), numeric = !Number.isNaN(a) && !Number.isNaN(b);
    const x = numeric ? a : left, y = numeric ? b : right;
    result = comparison[2] === "==" ? x === y : comparison[2] === "!=" ? x !== y : comparison[2] === ">" ? x > y : comparison[2] === "<" ? x < y : comparison[2] === ">=" ? x >= y : x <= y;
  } else result = !["", "0", "false", "null", "undefined", "no", "off"].includes(value.toLowerCase());
  return negate ? !result : result;
}

/** Walk nested syntax and propagate possible output changes without executing host handlers. */
export function scanMacros(text: string, options: MacroOptions = {}): MacroScan {
  if (!text.includes("{{")) return { effects: [], calls: [], writes: [], sets: [] };
  const variables = new Map<string, Value>(Object.entries(options.variables ?? {}).map(([key, value]) => [key, { text: value, effects: [] }]));
  const calls: MacroScan["calls"] = [], writes: MacroScan["writes"] = [], sets: MacroScan["sets"] = [], reads: string[] = [], controls: VolatileMacro[][] = [], sideEffects: VolatileMacro[] = [], expanding = new Set<string>();
  // `unresolved` counts macros nothing is known about; `fixed` counts ones known to hold still.
  let work = 0, unresolved = 0, fixed = 0;
  const stored = new Map<string, string[]>();
  const mark = (node: Call, kind: MacroKind, level: VolatileMacro["level"], reason?: string): VolatileMacro => ({ name: node.name, literal: node.literal, kind, level, reason });
  // Set by this same text, or by {{let}} and loops, rather than coming from outside it.
  const settled = (id: string) => { const value = variables.get(id); return !!value && (!!value.assigned || !Object.hasOwn(options.variables ?? {}, id)); };
  const read = (id: string) => { if (settled(id)) reads.push(...variables.get(id)?.reads ?? []); else reads.push(id); };
  const explain = (ids: string[]) => ids.slice(0, 2).map(id => {
    const key = id.slice(id.indexOf(":") + 1), writer = options.writers?.[id], stored = options.variables?.[id], setting = id.startsWith("var:") ? options.settings?.[key] : undefined;
    if (id.startsWith("flag:")) return `{{${key}}} only changes if you change this chat or your setup.`;
    if (setting !== undefined && !writer?.length) return `"${key}" is a preset setting, currently "${setting.length > 40 ? `${setting.slice(0, 40)}…` : setting}".`;
    if (writer?.length) return `"${key}" is set by ${writer.slice(0, 2).join(" and ")}.`;
    if (stored !== undefined) return `"${key}" is currently "${stored.length > 40 ? `${stored.slice(0, 40)}…` : stored}".`;
    return `Nothing LumiCache can see sets "${key}", so it changes only if you or an extension change it.`;
  }).join(" ");
  const restore = (saved: Map<string, Value>) => { variables.clear(); for (const [key, entry] of saved) variables.set(key, entry); };
  const walk = (nodes: Node[], depth = 0, potential = false): Value => {
    if (depth > 512 || (work += nodes.length) > 100_000) throw new ScanLimit();
    return combine(nodes.map(node => node.type === "text" ? { text: options.unknownCaptures && /\$(?:\d|&|<|`|')/.test(node.value) ? undefined : node.value, effects: [] } : evaluate(node, depth + 1, potential)));
  };
  const expand = (key: string, value: Value, depth: number, potential: boolean): Value => {
    if (!value.text?.includes("{{")) return value;
    if (expanding.has(key)) return { effects: [...value.effects, { name: key, literal: `{{${key}}}`, kind: "opaque", level: "risk", reason: "Recursive macro reference." }] };
    expanding.add(key);
    try { const result = walk(parseMacros(value.text), depth + 1, potential); return { ...result, effects: unique([...value.effects, ...result.effects]) }; }
    finally { expanding.delete(key); }
  };
  const branch = (nodes: Node[], depth: number, potential: boolean) => {
    const saved = new Map(variables), value = walk(nodes, depth, potential); if (potential) restore(saved); return value;
  };
  const evaluate = (node: Call, depth: number, potential: boolean): Value => {
    const name = Object.hasOwn(ALIASES, node.name) ? ALIASES[node.name] : node.name, level = potential ? "risk" : "issue";
    const countOnly = ["loomstyle", "loomutils", "loomretrofits"].includes(name) && node.args[0]?.length === 1 && node.args[0][0].type === "text" && node.args[0][0].value === "len";
    if (!countOnly && !calls.some(call => call.name === name && call.level === level)) {
      if (calls.length >= 5000) throw new ScanLimit(); calls.push({ name, literal: node.literal, level });
    }
    if (name === "escape") return { text: (node.bodyLiteral ?? "").replaceAll("{", "\u0001").replaceAll("}", "\u0002"), effects: [] };
    const arg = (index: number, maybe = potential) => walk(node.args[index] ?? [], depth, maybe);
    const unknownBranch = (value: Value) => ({ ...value, effects: uncertain(value.effects, `Execution depends on ${node.literal}`) });
    if (name === "if" || name === "unless") {
      const readsBefore = reads.length, unresolvedBefore = unresolved, fixedBefore = fixed, condition = combine(node.args.map((_, i) => arg(i)), " ");
      // The host also accepts bare variable names here, such as {{if .mood}}.
      for (const [, scope, key] of (condition.text ?? "").matchAll(/(?:^|[\s!])([.$@])([a-zA-Z][\w-]*)/g)) {
        const taint = options.changing?.[`${scope === "$" ? "gvar" : scope === "@" ? "chatvar" : "var"}:${key}`];
        if (taint) condition.effects = unique([...condition.effects, mark(node, taint.kind, potential ? "risk" : taint.level, taint.reason)]);
        else read(`${scope === "$" ? "gvar" : scope === "@" ? "chatvar" : "var"}:${key}`);
      }
      const choice = truth(condition.text), gate = reads.slice(readsBefore), moving = condition.effects.filter(effect => effect.kind !== "variable"), later: VolatileMacro[] = [];
      let unknownGate = unresolved > unresolvedBefore, stableGate = fixed > fixedBefore;
      if (!node.body) return { text: choice === undefined ? undefined : (name === "unless" ? !choice : choice) ? "true" : "", effects: condition.effects };
      const branches: { condition?: Node[][]; nodes: Node[] }[] = [{ condition: node.args, nodes: [] }];
      for (const child of node.body) {
        if (child.type === "call" && !child.body && ["else", "elseif", "elif"].includes(child.name)) branches.push({ condition: child.name === "else" ? undefined : child.args, nodes: [] });
        else branches.at(-1)!.nodes.push(child);
      }
      let possible = false; const values: Value[] = [];
      // What a branch writes is only as stable as the check that picked it.
      controls.push(moving);
      for (let i = 0; i < branches.length; i++) {
        const testReads = reads.length, testUnresolved = unresolved, testFixed = fixed;
        const part = branches[i], test = i === 0 ? condition : part.condition ? combine(part.condition.map(nodes => walk(nodes, depth, potential || possible)), " ") : { text: "true", effects: [] };
        if (i > 0) { gate.push(...reads.slice(testReads)); unknownGate ||= unresolved > testUnresolved; stableGate ||= fixed > testFixed; later.push(...test.effects); moving.push(...test.effects.filter(effect => effect.kind !== "variable")); }
        let yes = truth(test.text); if (i === 0 && name === "unless" && yes !== undefined) yes = !yes;
        if (yes === false) continue;
        const value = branch(part.nodes, depth, potential || possible || yes === undefined);
        values.push(possible || yes === undefined ? unknownBranch(value) : value);
        if (yes === true) break; possible = true;
      }
      controls.pop();
      const result = combine(values);
      if (choice === undefined && branches.some(part => !part.condition) && values.length && values.every(value => value.text !== undefined && value.text === values[0].text)) return { text: values[0].text, effects: result.effects };
      const checked = [...new Set(gate)], settledBranches = !result.effects.some(effect => effect.kind !== "variable");
      const differs = choice === undefined ? values.some(value => value.text === undefined) || values.length === 1 && values[0].text !== "" || new Set(values.map(value => value.text)).size > 1
        : branches.length > 1 || branches[0].nodes.length > 0;
      // A branch that already reports a changing value says more than the check around it.
      if (!moving.length && checked.length && !unknownGate && differs && settledBranches) result.effects.push(mark(node, "variable", "variabled", explain(checked)));
      else if ((unknownGate || !checked.length && !stableGate) && choice === undefined && !moving.length && settledBranches && differs)
        result.effects.push(mark(node, "condition", "risk", "The selected branch depends on a runtime value."));
      // When the branches read differently, a changing check is a changing prompt.
      const texts = values.map(value => value.text), picks = texts.every(value => value !== undefined) && (branches.some(part => !part.condition) ? new Set(texts).size > 1 : texts.some(value => value !== ""));
      const control = [...condition.effects, ...later].map(effect => picks && effect.level === "issue" ? { ...effect, reason: effect.reason ?? "This conditional checks a value that can change, so the text it picks can change." } : uncertain([effect], "A changing value controls this conditional; its effect depends on the selected branch.")[0]);
      return { text: possible ? undefined : result.text, effects: unique([...control, ...result.effects]) };
    }
    if (name === "switch") {
      const readsBefore = reads.length, unresolvedBefore = unresolved, fixedBefore = fixed, selected = arg(0), candidates: { match?: Node[]; output: Node[] }[] = [], checked = [...new Set(reads.slice(readsBefore))], unknownGate = unresolved > unresolvedBefore, stableGate = fixed > fixedBefore;
      if (node.body) {
        for (const child of node.body) if (child.type === "call" && child.body && (child.name === "case" || child.name === "default")) candidates.push({ match: child.name === "case" ? child.args[0] ?? [] : undefined, output: child.body });
      } else for (let i = 1; i < node.args.length; i += 2) candidates.push(i + 1 < node.args.length ? { match: node.args[i], output: node.args[i + 1] } : { output: node.args[i] });
      let maybe = false; const outcomes: Value[] = [];
      for (const candidate of candidates) {
        const match = candidate.match ? walk(candidate.match, depth, potential || maybe) : undefined, known = !match || selected.text !== undefined && match.text !== undefined;
        if (known && match && match.text!.trim() !== selected.text!.trim()) continue;
        outcomes.push(branch(candidate.output, depth, potential || maybe || !known)); if (known) break; maybe = true;
      }
      const value = combine(outcomes), calm = candidates.length > 1 && ![...selected.effects, ...value.effects].some(effect => effect.kind !== "variable");
      const own = !calm ? [] : checked.length && !unknownGate ? [mark(node, "variable", "variabled", explain(checked))] : selected.text === undefined && (unknownGate || !stableGate) ? [mark(node, "condition", "risk", "The selected branch depends on a runtime value.")] : [];
      return { text: maybe ? undefined : value.text, effects: unique([...selected.effects, ...value.effects, ...own]) };
    }
    if (["and", "or", "default"].includes(name)) {
      if (name === "default" && node.body && !node.args.length) return walk(node.body, depth, potential);
      const values: Value[] = []; let maybe = potential;
      for (let i = 0; i < node.args.length; i++) {
        const value = arg(i, maybe); values.push(value); const yes = truth(value.text);
        if (name === "default" && yes === true && !maybe) return value;
        if (name === "and" && yes === false) return empty();
        if (name === "or" && yes === true) return { text: "true", effects: [] };
        if (yes === undefined) maybe = true;
      }
      return { text: maybe ? undefined : name === "and" && values.length ? "true" : name === "default" ? values.at(-1)?.text ?? "" : "", effects: combine(values).effects };
    }
    if (name === "let") {
      const saved = new Map(variables);
      for (let i = 0; i + 1 < node.args.length; i += 2) { const key = arg(i).text, before = reads.length, value = arg(i + 1); if (key !== undefined) variables.set(`var:${key.trim()}`, { ...value, reads: reads.slice(before) }); }
      const value = walk(node.body ?? [], depth, potential); restore(saved); return value;
    }
    if (["foreach", "map", "filter", "some", "every", "find", "foreachmessage", "foreachvar", "foreachchatvar", "foreachglobalvar"].includes(name)) {
      const itemsBefore = reads.length, items = arg(0), origins = reads.slice(itemsBefore), delimiter = node.args[2] ? arg(2).text : ",";
      if (items.text !== undefined && delimiter !== undefined && ["foreach", "map", "filter", "some", "every", "find"].includes(name)) {
        const values = list(items.text, delimiter); if (!values.length) return empty();
        const saved = new Map(variables), key = arg(1).text || "item", results: Value[] = [];
        for (const [index, value] of values.slice(0, 1000).entries()) {
          variables.set(`var:${key}`, { text: value, effects: [], reads: origins }); variables.set(`var:${key}_index`, { text: String(index), effects: [], reads: origins });
          results.push(walk(node.body ?? [], depth, potential || !["foreach", "map"].includes(name)));
        }
        restore(saved); const result = combine(results); return { ...result, effects: unique([...items.effects, ...result.effects]) };
      }
      const saved = new Map(variables), key = arg(1).text || "item";
      for (const bound of [key, `${key}_index`]) variables.set(`var:${bound}`, { effects: [], reads: origins });
      const body = walk(node.body ?? [], depth, true); restore(saved);
      return { effects: unique([...items.effects, ...body.effects, ...(name === "foreachmessage" ? [mark(node, "turn", level)] : [])]) };
    }
    if (Object.hasOwn(PEEKS, name)) {
      const key = arg(0).text?.trim(), id = `${PEEKS[name]}:${key}`, taint = options.changing?.[id];
      if (taint && !variables.get(id)?.assigned) return { effects: [mark(node, taint.kind, potential ? "risk" : taint.level, taint.reason)] };
      if (key !== undefined) read(id); return { effects: [] };
    }
    if (Object.hasOwn(DELETES, name) || Object.hasOwn(KEY_WRITES, name) || name === "counter" || name === "toggle") {
      const scope = name === "counter" || name === "toggle" ? "var" : DELETES[name] ?? KEY_WRITES[name], clear = Object.hasOwn(DELETES, name);
      const key = arg(0).text?.trim(), id = `${scope}:${key}`, value = combine(node.args.slice(1).map((_, i) => arg(i + 1)));
      sideEffects.push(...uncertain(value.effects, "The computed value is stored in a variable; later prompt use determines its effect."));
      if (key === undefined) return empty();
      variables.set(id, clear ? { text: "", effects: [], assigned: !potential } : { effects: [] });
      // A counter's own output moves every time it runs.
      if (name === "counter" || name === "toggle") { writes.push({ id, kind: "state", level: "risk" }); return { effects: [mark(node, "state", "risk", "This changes a variable each time it runs and emits the new value.")] }; }
      const changing = [...value.effects, ...controls.flat()].find(effect => !["opaque", "condition", "variable"].includes(effect.kind));
      if (changing) writes.push({ id, kind: changing.kind, level: changing.level === "issue" ? "issue" : "risk" }); else sets.push({ id, value: clear ? "" : undefined });
      return empty();
    }
    const getter = /^(get|set|add|inc|dec)(var|gvar|chatvar)$/.exec(name);
    if (getter) {
      const key = arg(0).text?.trim(), id = `${getter[2]}:${key}`, previous = variables.get(id);
      const taint = getter[1] === "get" && !previous?.assigned ? options.changing?.[id] : undefined;
      if (taint) return { effects: [mark(node, taint.kind, potential ? "risk" : taint.level, taint.reason)] };
      // A value this same text just fixed is not a check on anything outside it.
      if (getter[1] === "get" && key !== undefined) read(id);
      // {{var::name::ison::a,b}} asks about the variable instead of returning it.
      if (getter[1] === "get" && node.args.length > 1) return { effects: [] };
      if (getter[1] === "get") {
        if (key === undefined) return { effects: [] };
        const output = expand(id, previous ?? { effects: [] }, depth, potential), possible = [...stored.get(id) ?? [], ...options.written?.[id] ?? []];
        return output.text === undefined && possible.length ? { ...output, possible } : output;
      }
      const setReads = reads.length, value = node.body ? walk(node.body, depth, potential) : arg(1);
      if (getter[1] === "set") {
        if (key !== undefined) variables.set(id, { ...value, assigned: !potential, reads: reads.slice(setReads) });
        if (key !== undefined && value.text !== undefined) stored.set(id, [...stored.get(id) ?? [], value.text]);
        const changing = [...value.effects, ...controls.flat()].sort((a, b) => Number(b.level === "issue") - Number(a.level === "issue")).find(effect => !["opaque", "condition", "variable"].includes(effect.kind));
        if (key !== undefined && changing) writes.push({ id, kind: changing.kind, level: changing.level === "issue" ? "issue" : "risk" });
        else if (key !== undefined) sets.push({ id, value: value.text });
        sideEffects.push(...uncertain(value.effects, "The computed value is stored in a variable; later prompt use determines its effect.")); return empty();
      }
      const amount = getter[1] === "inc" ? 1 : getter[1] === "dec" ? -1 : value.text !== undefined ? parseFloat(value.text) || 0 : undefined;
      const fixed = previous?.assigned === true && previous.text !== undefined && amount !== undefined;
      const result: Value = { assigned: fixed, text: fixed ? String((parseFloat(previous!.text!) || 0) + amount!) : undefined, effects: unique([...(previous?.effects ?? []), ...value.effects]) };
      if (!fixed && amount !== 0) { result.effects.push(mark(node, "state", getter[2] === "var" ? "risk" : level, "This operation changes a variable and emits its new value.")); if (key !== undefined) writes.push({ id, kind: "state", level: getter[2] === "var" ? "risk" : level }); }
      sideEffects.push(...uncertain(result.effects, "This operation changes a variable; later prompt use determines its effect."));
      if (key !== undefined) variables.set(id, result); return result;
    }
    if (ROOM_TURN.has(name)) return options.room === false ? { text: "", effects: [] } : { effects: [mark(node, "turn", "risk", "This follows whichever player is taking the turn.")] };
    if (FOCUS.has(name)) return options.cardMode === "solo" ? { text: "", effects: [] } : { effects: [mark(node, "turn", "risk", "This follows whichever character is taking the turn.")] };
    if (options.cardMode === "swap" && CARD.has(name)) return { effects: [mark(node, "turn", "risk", "This group chat swaps character cards, so this follows whichever character is focused.")] };
    if (options.references && Object.hasOwn(options.references, name)) return expand(`reference:${name}`, { text: options.references[name], effects: [] }, depth, potential);
    if (options.constants && Object.hasOwn(options.constants, name)) return { text: options.constants[name], effects: [] };
    if (SETTINGS.has(name)) { reads.push(`flag:${node.literal.replace(/^\{\{\W*|\W*\}\}$/g, "").split("::")[0]}`); return { effects: [] }; }
    const hidden = ["comment", "note", "noop", "case", "elseif", "else"].includes(name), callsBefore = calls.length, argReads = reads.length;
    const known = PURE.has(name) || TRANSPARENT.has(name) || CLOCK.has(name) || TURN.has(name) || ["random", "pick", "roll", "shuffle", "randomtag", "randomlumia", "datetimeformat", "timediff", "time_diff", "eq", "ne", "not"].includes(name);
    const args = node.args.map((_, i) => arg(i, potential || !known)), body = node.body ? walk(node.body, depth, potential || !known) : undefined;
    const input = combine([...args, ...(body ? [body] : [])]);
    if (hidden) { calls.splice(callsBefore); return empty(); }
    if (["presetblock", "pblock"].includes(name) || ["regexinstalled", "regex_installed", "hasregex", "has_regex"].includes(name) && (node.body || node.args.length > 1))
      return { effects: [...input.effects, mark(node, "opaque", "risk", "This macro invokes content or a rule whose output is not available in this source. Inspect the assembled diff.")] };
    if (FIXED.has(name)) { fixed++; return { effects: input.effects }; }
    const fetched = RETRIEVED.get(name);
    if (fetched) return { effects: [...input.effects, mark(node, "turn", "risk", fetched)] };
    if (name === "messageat" || name === "message_at" || name === "msgat") {
      // A counted-from-the-start message holds still; counting from the end moves every turn.
      const index = args[0]?.text?.trim();
      if (index !== undefined && /^\d+$/.test(index)) { fixed++; return { effects: input.effects }; }
      if (index === undefined) return { effects: [...input.effects, mark(node, "turn", "risk")] };
      return { effects: [...input.effects, mark(node, "turn", level)] };
    }
    if (CLOCK.has(name) || name.startsWith("time_utc")) return { effects: [...input.effects, mark(node, "clock", level)] };
    if (TURN.has(name)) return { effects: [...input.effects, mark(node, "turn", level)] };
    if (["random", "pick", "roll", "shuffle", "randomtag"].includes(name)) {
      const texts = args.map(value => value.text); let variable: boolean | undefined, fixed: string | undefined;
      if (name === "roll") {
        if (!args.length || texts[0] === "") variable = true;
        else if (texts[0] !== undefined) { const dice = /^(\d+)d(\d+)$/i.exec(texts[0]); variable = !!dice && Number(dice[1]) > 0 && Number(dice[2]) > 1 && Number.isFinite(Number(dice[2])); if (!variable) fixed = dice && Number(dice[2]) === 1 ? String(Math.min(100, Number(dice[1]))) : "0"; }
      } else if (name === "randomtag") { variable = options.characterTags ? new Set(options.characterTags.map(value => value.trim()).filter(Boolean)).size > 1 : undefined; if (variable === false) fixed = options.characterTags?.[0] ?? ""; }
      // Every list this variable can hold has more than one item, so the order will move.
      else if (name === "shuffle" && texts[0] === undefined && args[0]?.possible?.length) { if (args[0].possible.every(value => new Set(list(value)).size > 1)) variable = true; }
      else if (texts.every((value): value is string => value !== undefined)) {
        if (name === "random" && !texts.length) variable = true;
        else if (name === "random" && texts.length <= 2 && texts.every(value => value.trim() !== "" && !Number.isNaN(Number(value)))) { const low = parseInt(texts[0], 10) || 0, high = parseInt(texts[1], 10) || 1; variable = high > low; if (!variable) fixed = String(low); }
        else { const choices = name === "shuffle" ? list(texts[0] ?? "") : texts; variable = new Set(choices).size > 1; if (!variable) fixed = choices[0] ?? ""; }
      }
      const effects = [...input.effects];
      if (variable !== false) effects.push(mark(node, "random", variable === undefined ? "risk" : level, variable === undefined ? "The possible results depend on runtime arguments or the available selection pool." : undefined));
      return { text: fixed, effects };
    }
    if (name === "timediff" || name === "time_diff") {
      const from = args[0]?.text, to = args[1]?.text;
      if (!args.length) return { text: "invalid date", effects: [] };
      if (from !== undefined && !Number.isFinite(Date.parse(from))) return { text: "invalid date", effects: input.effects };
      if (from !== undefined && to) return { effects: input.effects };
      // Two dates from variables involve no clock.
      if (args[1] && to !== "" && reads.length > argReads) return { effects: input.effects };
      return { effects: [...input.effects, mark(node, "clock", from !== undefined && (!args[1] || to === "") ? level : "risk")] };
    }
    if (name === "randomlumia" || name === "idleduration" || name === "idle_duration") return { effects: [...input.effects, mark(node, name === "randomlumia" ? "random" : "clock", "risk", "The output depends on runtime arguments or available content.")] };
    if (TRANSPARENT.has(name)) {
      if (name === "trim" && !node.body) { calls.splice(callsBefore); return empty(); }
      const value = body ?? args[args[0]?.text === "@data" ? 1 : 0] ?? empty(), constant = value.text;
      return { text: constant === undefined ? undefined : name === "upper" ? constant.toUpperCase() : name === "lower" ? constant.toLowerCase() : name === "trim" ? constant.trim() : name === "reverse" ? [...constant].reverse().join("") : name === "capitalize" ? constant.charAt(0).toUpperCase() + constant.slice(1) : constant, effects: value.effects };
    }
    if (["eq", "ne", "not"].includes(name) && args.every(value => value.text !== undefined)) {
      const a = (args[0]?.text ?? "").trim(), b = (args[1]?.text ?? "").trim(), x = parseFloat(a), y = parseFloat(b);
      const same = !Number.isNaN(x) && !Number.isNaN(y) ? x === y : a === b;
      const result = (name === "not" ? !truth(a) : name === "ne" ? !same : same) ? "true" : "";
      return { text: result, effects: input.effects };
    }
    if (PURE.has(name)) { fixed++; if (!ABSORBING.has(name)) return { effects: input.effects }; }
    else if (reads.length === argReads) unresolved++;
    return { effects: uncertain(input.effects, `Nested in ${node.literal}; its final output depends on this operation.`) };
  };
  try { const value = walk(parseMacros(text)); for (const call of calls) options.onCall?.(call); return { effects: unique([...value.effects, ...sideEffects]), calls, writes, sets }; }
  catch (error) {
    if (!(error instanceof ScanLimit || error instanceof RangeError)) throw error;
    return { effects: [{ kind: "opaque", level: "risk", name: "analysis-limit", literal: "Macro analysis limit", reason: "This source exceeds the static analysis budget. Use simulation and the Cache Diff to inspect its output." }], calls, writes: [], sets: [] };
  }
}
export const volatileMacros = (text: string, options?: MacroOptions) => scanMacros(text, options).effects;
