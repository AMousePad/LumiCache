import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { analyze } from "../src/health/analyze";
import { scanMacros, volatileMacros } from "../src/health/macros";
import { compositionFindings, compositionSnapshot } from "../src/health/composition";
import { historyTemplate } from "../src/health/history";
import { regexFindings } from "../src/health/regex";
import { readComposition } from "../src/ui/composition";
import { sources, entry, preview } from "./health.test";

test("known changing configuration is an Issue; unresolved output is a Risk", () => {
  const data = sources();
  data.lore = [false, true].map((vectorized, i) => ({ bookId: "book", bookName: "World", scope: "Chat", entry: entry({ id: `entry${i}`, vectorized }) }));
  data.preset!.prompt_order[0].content = "{{roll::2d6}} {{random::1::100}} {{isotime}}";
  const findings = analyze(data, preview()).findings;
  expect(findings.filter(f => /activation-/.test(f.id)).map(f => f.level)).toEqual(["issue", "issue"]);
  expect(findings.every(f => f.level === "issue")).toBe(true);
  expect(volatileMacros("{{roll::{{getvar::dice}}}}")[0]).toMatchObject({ name: "roll", level: "risk" });
  expect(volatileMacros("{{randomLumia}}")[0].level).toBe("risk");
  expect(volatileMacros("{{pblock::sealed-key}}")[0]).toMatchObject({ level: "risk", kind: "opaque" });
  expect(volatileMacros("{{regexInstalled::rule::sample}}")[0]).toMatchObject({ level: "risk", kind: "opaque" });
  expect(volatileMacros("{{regexInstalled::rule}}")).toEqual([]);
});
test("nested arguments, scoped branches, loops and variable indirection retain random evidence", () => {
  const issues = [
    "{{upper::{{roll::2d6}}}}", "{{uppercase::{{lower::{{pick::red::blue}}}}}}",
    "{{if::1}}{{#trim}}{{roll::2d6}}{{/trim}}{{/if}}",
    "{{if::0}}quiet{{elseif::{{eq::01::1}}}}{{roll::2d6}}{{else}}quiet{{/if}}",
    "{{unless::false}}{{roll:2d6}}{{/unless}}", "{{switch::x::y::quiet::x::{{roll::2d6}}::quiet}}",
    "{{switch::x}}{{case::x}}{{roll::2d6}}{{/case}}{{default}}quiet{{/default}}{{/switch}}",
    "{{let::dice::2d6}}{{roll::{{.dice}}}}{{/let}}",
    "{{setvar::dice::2d6}}{{roll::{{getvar::dice}}}}",
    "{{foreach::yes,no}}{{if .item == yes}}{{roll::2d6}}{{/if}}{{/foreach}}",
    "{{!roll::2d6}}", "{{?roll::2d6}}", "{{~upper::{{roll::2d6}}}}",
  ];
  for (const text of issues) expect(volatileMacros(text).some(f => f.kind === "random" && f.level === "issue")).toBe(true);
  expect(volatileMacros("{{getgvar::template}}", { variables: { "gvar:template": "{{upper::{{roll::2d6}}}}" } })[0].level).toBe("issue");
  const conditional = volatileMacros("{{if::{{getvar::enabled}}}}{{upper::{{roll::2d6}}}}{{/if}}");
  expect(conditional).toHaveLength(1); expect(conditional[0]).toMatchObject({ name: "roll", kind: "random", level: "risk" });
});
test("inactive branches, discarded output and literal data do not become false Issues", () => {
  for (const text of [
    "{{if::0}}{{roll::2d6}}{{/if}}", "{{unless::true}}{{roll::2d6}}{{/unless}}", "{{switch::x::y::{{roll::2d6}}::quiet}}",
    "{{and::0::{{roll::2d6}}}}", "{{or::true::{{roll::2d6}}}}", "{{and::{{roll::2d6}}::0}}",
    "{{if::{{roll::2d6}}}}same{{else}}same{{/if}}", "{{#escape}}{{if::1}}{{roll::2d6}}{{/if}}{{/escape}}",
    "{{comment}}{{roll::2d6}}{{/comment}}", "{{trim::{{roll::2d6}}}}", "{{foreach::}}{{roll::2d6}}{{/foreach}}",
    "{{setvar::x::5}}{{incvar::x}}", "{{roll::{{pick::2d1::2d1}}}}",
  ]) expect(volatileMacros(text)).toEqual([]);
  const conditional = "{{if::{{escape}}literal{{/escape}}}}{{roll::2d6}}{{/if}}";
  expect(volatileMacros(conditional)[0].level).toBe("issue");
});
test("nested scans are bounded for very large prompts, deep syntax and recursive values", () => {
  const text = "word ".repeat(1_000_000) + "{{upper::".repeat(120) + "{{roll::2d6}}" + "}}".repeat(120);
  const start = performance.now(), effects = volatileMacros(text);
  expect(effects).toHaveLength(1); expect(effects[0].level).toBe("issue"); expect(performance.now() - start).toBeLessThan(5000);
  expect(volatileMacros("{{upper::".repeat(600) + "x" + "}}".repeat(600))[0]).toMatchObject({ kind: "opaque", level: "risk" });
  expect(volatileMacros("{{getgvar::x}}", { variables: { "gvar:x": "{{getgvar::x}}" } })[0]).toMatchObject({ kind: "opaque", level: "risk" });
  expect(scanMacros("{{getvar::x}} ".repeat(20_000)).effects).toEqual([]);
  expect(scanMacros("{{constructor}} {{__proto__}}", { references: {}, constants: {} }).effects).toEqual([]);
  const varied = Array.from({ length: 150 }, (_, i) => `{{random::0::${i + 1}}}`).join(" ") + "{{time}}";
  expect(volatileMacros(varied).some(effect => effect.kind === "clock")).toBe(true);
  expect(scanMacros("{{getvar::x}} ".repeat(6000) + "{{loomStyle}}").calls.some(call => call.name === "loomstyle")).toBe(true);
});
test("saved message macros are checked while hidden, clipped and literal messages are excluded", () => {
  const data = sources(); data.preset!.prompt_order.push({ ...data.preset!.prompt_order[0], id: "history", marker: "chat_history", content: "" }); data.messages = [
    { id: "active", index_in_chat: 7, content: "{{upper::{{roll::2d6}}}}", name: "You", is_user: true, extra: {} },
    { id: "hidden", index_in_chat: 8, content: "{{roll::2d6}}", name: "You", extra: { hidden: true } },
    { id: "json", index_in_chat: 9, content: '<json>{"text":"{{roll::2d6}}"}</json>', name: "You", extra: {} },
  ] as never;
  const findings = analyze(data, preview()).findings;
  expect(findings).toHaveLength(1); expect(findings[0]).toMatchObject({ category: "History", itemId: "active", level: "issue" });
  const clipped = preview(); clipped.contextClipStats!.messagesDropped = 1;
  expect(analyze(data, clipped).findings.some(f => f.category === "History")).toBe(false);
  const content = "{{roll::2d6}}", key = createHash("sha256").update(content).digest("hex");
  expect(volatileMacros(historyTemplate({ content, extra: { macro_literal_braces: { [key]: [0, 1, 11, 12] } } }))).toEqual([]);
  expect(volatileMacros(historyTemplate({ content: '<json>{"tag":"</json>","roll":"{{roll::2d6}}"}</json>', extra: {} }))).toEqual([]);
});
const rule = (patch = {}) => ({ id: "rule", name: "Scene operation", target: ["prompt"], placement: ["ai_output"], scope: "chat", find_regex: "quiet", replace_string: "calm", substitute_macros: "none", min_depth: null, max_depth: null, disabled: false, metadata: {}, actions: [], ...patch }) as never;
test("regex inspection follows actual substitution, depth, activation and operation behavior", () => {
  expect(regexFindings([rule()], true, {})).toEqual([]);
  expect(regexFindings([rule({ target: ["display"], replace_string: "{{roll::2d6}}" })], true, {})).toEqual([]);
  expect(regexFindings([rule({ replace_string: "{{upper::{{roll::2d6}}}}" })], true, {})[0].level).toBe("issue"); // Native post-regex macro pass.
  expect(regexFindings([rule({ find_regex: "{{random::a::b}}" })], true, {})).toEqual([]); // Find stays literal in none mode.
  expect(regexFindings([rule({ replace_string: "{{roll::$1}}", substitute_macros: "raw" })], true, {})[0].level).toBe("risk");
  expect(regexFindings([rule({ max_depth: 2 })], true, {})[0].level).toBe("depth");
  expect(regexFindings([rule({ metadata: { match_actions: ["move_top", "repeat_back"] } })], true, {})[0].level).toBe("risk");
  expect(regexFindings([rule({ preset_id: "preset", metadata: { prompt_activation: { mappings: [{ block_ids: ["main"] }], lifetime: "latest" } } })], true, {})[0].level).toBe("issue");
});
test("regex depth windows are Depth Mutable at their deepest edge", () => {
  expect(regexFindings([rule({ min_depth: 5 })], true, {})[0]).toMatchObject({ level: "depth", category: "Depth Mutable", depth: 5, problematic: false, evidence: ["Depth 5–any"] });
  expect(regexFindings([rule({ min_depth: 8 })], true, {})[0].problematic).toBe(true);
  expect(regexFindings([rule({ max_depth: 3 })], true, {})[0]).toMatchObject({ level: "depth", depth: 4, problematic: false, evidence: ["Depth 0–3"] });
  expect(regexFindings([rule({ min_depth: 5, max_depth: 9 })], true, {})[0]).toMatchObject({ level: "depth", depth: 10, problematic: true, evidence: ["Depth 5–9"] });
  expect(regexFindings([rule({ min_depth: 9, max_depth: 5 })], true, {})).toEqual([]);
  expect(regexFindings([rule({ placement: ["world_info"], min_depth: 5 })], true, {})).toEqual([]);
});
test("Compose flags moving filters and reached Sovereign/Loom content, leaving fixed configuration quiet", () => {
  const snapshot = compositionSnapshot({ available: true, sovereign: { enabled: true }, filters: { detailsBlocks: { enabled: true, keepDepth: 2 }, htmlTags: { enabled: false, stripFonts: true } },
    selections: [{ id: "style", name: "Weather", kind: "style", content: "{{upper::{{roll::2d6}}}} {{loomUtils}}" }, { id: "utility", name: "Clock", kind: "utility", content: "{{time}}" }] });
  expect(compositionFindings(snapshot, [], {})).toHaveLength(1);
  const rows = compositionFindings(snapshot, [{ name: "loomstyle", level: "issue" }, { name: "loomsovhand", level: "issue" }], {});
  expect(rows.map(row => row.group)).toEqual(["Context filters", "Narrative styles", "Loom utilities", "Sovereign Hand"]);
  expect(rows.every(row => row.level === "issue")).toBe(true);
  snapshot.filters!.detailsBlocks!.keepDepth = 0; expect(compositionFindings(snapshot, [], {})).toEqual([]);
  expect(scanMacros("{{loomStyle::len}}").calls).toEqual([]);
  expect(compositionFindings({ available: true, filters: { detailsBlocks: { enabled: true, keepDepth: 2 } } }, [], {}, false)).toEqual([]);
});
test("Compose collection reads only its five named settings and reports inaccessible settings as uncertainty", async () => {
  const paths: string[] = [];
  const snapshot = await readComposition(async path => { paths.push(path); return path.endsWith("contextFilters") ? { value: { loomItems: { enabled: true, keepDepth: 5 } } } : null; });
  expect(paths).toHaveLength(5); expect(paths.every(path => path.startsWith("settings/"))).toBe(true);
  expect(snapshot.available).toBe(true); expect(snapshot.filters?.loomItems?.enabled).toBe(true);
  const failed = await readComposition(async () => { throw new Error("Disconnected"); });
  expect(compositionFindings(failed, [], {})[0].level).toBe("risk");
});
