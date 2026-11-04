// A read-only parser for the Lumiverse macro syntax. No host handlers are run.
export type Node = { type: "text"; value: string } | Call;
export interface Call { type: "call"; name: string; args: Node[][]; body?: Node[]; bodyLiteral?: string; flags: string; start: number; end: number; literal: string }
export class ScanLimit extends Error { constructor() { super("Macro analysis exceeded its work or nesting limit."); } }
const MAX_NODES = 100_000, MAX_DEPTH = 512;
export function parseMacros(source: string): Node[] {
  let at = 0, count = 0;
  const push = (list: Node[], text: string) => { if (text) list.push({ type: "text", value: text }); };
  const sequence = (depth: number, mode: "document" | "argument" | "word"): Node[] => {
    if (depth > MAX_DEPTH) throw new ScanLimit();
    const nodes: Node[] = []; let start = at;
    while (at < source.length) {
      if (mode !== "document" && (source.startsWith("}}", at) || source.startsWith("::", at) || mode === "word" && /[ \t]/.test(source[at]))) break;
      if (source[at] === "\\" && /[{}]/.test(source[at + 1] ?? "")) {
        push(nodes, source.slice(start, at)); push(nodes, source[at + 1] === "{" ? "\u0001" : "\u0002"); at += 2; start = at; continue;
      }
      if (source.startsWith("{{", at)) { push(nodes, source.slice(start, at)); nodes.push(call(depth + 1)); start = at; }
      else at++;
    }
    push(nodes, source.slice(start, at)); return pair(nodes, depth);
  };
  const call = (depth: number): Call => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) throw new ScanLimit();
    const start = at; at += 2;
    const skip = () => { while (/[ \t]/.test(source[at] ?? "")) at++; };
    skip(); let flags = "", name = ""; const args: Node[][] = [];
    if (source.startsWith("//", at)) {
      const end = source.indexOf("}}", at + 2); at = end < 0 ? source.length : end + 2;
      return { type: "call", name: "comment", flags: "", args: [], start, end: at, literal: source.slice(start, Math.min(at, start + 180)) };
    }
    while (/[!?~>#/]/.test(source[at] ?? "")) flags += source[at++];
    skip();
    const shorthand = /[.$@]/.test(source[at] ?? "") ? source[at++] : "";
    const idStart = at;
    while (/[\w-]/.test(source[at] ?? "") && !(shorthand && (source.startsWith("--", at) || source.startsWith("-=", at)))) at++;
    name = source.slice(idStart, at).toLowerCase(); skip();
    if (shorthand) {
      const key = name, scope = shorthand === "$" ? "gvar" : shorthand === "@" ? "chatvar" : "var";
      const op = ["++", "--", "+=", "-=", "||", "??", "==", "!=", ">=", "<=", "=", ">", "<"].find(op => source.startsWith(op, at)) ?? "";
      at += op.length; skip();
      name = (op === "=" ? "set" : op === "++" ? "inc" : op === "--" ? "dec" : op === "+=" || op === "-=" ? "add" : "get") + scope;
      args.push([{ type: "text", value: key }]);
      if (op && op !== "++" && op !== "--") { const value = sequence(depth, "argument"); if (op === "-=") value.unshift({ type: "text", value: "-" }); args.push(value); }
    } else {
      while (at < source.length && !source.startsWith("}}", at)) {
        if (source[at] === ":") { at += source.startsWith("::", at) ? 2 : 1; args.push(sequence(depth, "argument")); }
        else {
          skip(); if (source.startsWith("}}", at) || at >= source.length) break;
          const word = sequence(depth, "word");
          if (word.length === 1 && word[0].type === "text" && /^[.$@][a-z][\w-]*$/i.test(word[0].value)) {
            const text = word[0].value; word[0] = { type: "call", name: text[0] === "$" ? "getgvar" : text[0] === "@" ? "getchatvar" : "getvar", flags: "", args: [[{ type: "text", value: text.slice(1) }]], start, end: at, literal: text };
          }
          args.push(word);
        }
      }
    }
    if (source.startsWith("}}", at)) at += 2;
    return { type: "call", name, flags, args, start, end: at, literal: source.slice(start, Math.min(at, start + 180)) + (at - start > 180 ? "…" : "") };
  };
  // Pair in linear time per sequence; ordinary unscoped calls require no lookahead.
  const pair = (nodes: Node[], depth: number): Node[] => {
    const stacks = new Map<string, number[]>(), ends = new Map<number, number>();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]; if (node.type !== "call") continue;
      let stack = stacks.get(node.name); if (!stack) stacks.set(node.name, stack = []);
      if (node.flags.includes("/")) { const open = stack.pop(); if (open !== undefined) ends.set(open, i); }
      else stack.push(i);
    }
    const range = (from: number, to: number, nesting: number): Node[] => {
      if (nesting > MAX_DEPTH) throw new ScanLimit();
      const result: Node[] = [];
      for (let i = from; i < to; i++) {
        const node = nodes[i]; if (node.type === "call" && node.flags.includes("/")) continue;
        const end = ends.get(i);
        if (node.type === "call" && end !== undefined && end < to) { result.push({ ...node, body: range(i + 1, end, nesting + 1), bodyLiteral: source.slice(node.end, (nodes[end] as Call).start) }); i = end; }
        else result.push(node);
      }
      return result;
    };
    return range(0, nodes.length, depth);
  };
  return sequence(0, "document");
}
