import { compositionFindings } from "../src/health/composition";
import { expect, test } from "bun:test";
import { analyze } from "../src/health/analyze";
import { volatileMacros } from "../src/health/macros";
import { sources, entry, preview } from "./health.test";

test("ordinary variable reads, opaque macros, scripts and regexes produce no speculative warnings", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = Array.from({ length: 39 }, (_, i) => ({ ...base, id: String(i), content: `{{getvar::value${i}}} {{getgvar::theme}} {{chatvar::x}} {{memory}} {{custom}}` }));
  data.regex = [{ id: "regex", find_regex: "x", replace_string: "y" }] as never;
  data.chat.metadata = { scripts: ["custom"] };
  data.character!.description = "{{random::a::b}}"; // Unreferenced card field.
  expect(analyze(data, preview()).findings).toEqual([]);
});
test("a conditional that checks a changing value is an issue when its branches differ", () => {
  for (const text of ["{{if::{{random::0::1}}}}A{{else}}B{{/if}}", "{{if::{{lastMessage}}}}A{{/if}}", "{{if::{{time}}}}A{{else}}B{{/if}}"]) expect(volatileMacros(text).map(effect => effect.level)).toEqual(["issue"]);
  expect(volatileMacros("{{if::{{random::0::1}}}}A{{else}}A{{/if}}")).toEqual([]);
  expect(volatileMacros("{{if::{{custom}}}}A{{else}}B{{/if}}").map(effect => effect.level)).toEqual(["risk"]);
});
test("a variable written from a changing value taints reads and checks in other sources", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  const blocks = (...content: string[]) => { data.preset!.prompt_order = content.map((text, i) => ({ ...base, id: String(i), name: `Block ${i}`, content: text })); };
  const level = (name: string) => analyze(data, preview()).findings.filter(finding => finding.item === name).map(finding => finding.level);
  for (const check of ["{{if::{{getvar::mood}}}}Hi{{/if}}", "{{if .mood}}Hi{{/if}}", "{{getvar::mood}}"]) { blocks("{{setvar::mood::{{random::a::b}}}}", check); expect(level("Block 1")).toEqual(["issue"]); }
  blocks("{{setvar::copy::{{getvar::mood}}}}", "{{setvar::mood::{{random::a::b}}}}", "{{if::{{getvar::copy}}}}Hi{{/if}}"); expect(level("Block 2")).toEqual(["issue"]);
  blocks("{{if::{{getvar::mood}}}}{{else}}{{setvar::mood::{{random::a::b}}}}{{/if}}", "{{if::{{getvar::mood}}}}Hi{{/if}}"); expect(level("Block 1")).toEqual(["risk"]);
  blocks("{{incvar::turns}}", "{{if::{{getvar::turns}}}}Hi{{/if}}"); expect(level("Block 1").length).toBeGreaterThan(0);
});
test("a plain variable check is Variabled, and says who sets the variable", () => {
  const levels = (text: string, options = {}) => volatileMacros(text, options).map(effect => effect.level);
  for (const text of ["{{if::{{getvar::mood}}}}A{{else}}B{{/if}}", "{{if::{{getvar::mood}}}}A{{/if}}", "{{if .mood}}A{{/if}}", "{{if::{{eq::{{getvar::mood}}::calm}}}}A{{/if}}", "{{switch::{{getvar::mood}}}}{{case::a}}A{{/case}}{{default}}B{{/default}}{{/switch}}"]) expect(levels(text)).toEqual(["variabled"]);
  // Nothing to pick, or a value the same text just fixed.
  for (const text of ["{{if::{{getvar::mood}}}}A{{else}}A{{/if}}", "{{if::{{getvar::mood}}}}{{/if}}", "{{setvar::mood::1}}{{if::{{getvar::mood}}}}A{{/if}}", "{{getvar::mood}}", "{{let::x::1}}{{if::{{.x}}}}A{{else}}B{{/if}}{{/let}}", "{{foreach::yes,no}}{{if .item == yes}}A{{/if}}{{/foreach}}"]) expect(levels(text)).toEqual([]);
  // A stored value still picks a branch today, but it is the same trick.
  expect(levels("{{if::{{getgvar::theme}}}}A{{else}}B{{/if}}", { variables: { "gvar:theme": "dark" } })).toEqual(["variabled"]);
  expect(volatileMacros("{{if::{{getgvar::theme}}}}A{{else}}B{{/if}}", { variables: { "gvar:theme": "dark" } })[0].reason).toContain('currently "dark"');
  expect(levels("{{if::{{if::{{getvar::mood}}}}x{{/if}}}}A{{/if}}")).toContain("variabled");

  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [{ ...base, id: "a", name: "Style", content: "{{setvar::mood::calm}}" }, { ...base, id: "b", name: "Check", content: "{{if::{{getvar::mood}}}}Hi{{/if}}" }];
  const finding = analyze(data, preview()).findings.find(row => row.item === "Check")!;
  expect(finding).toMatchObject({ level: "variabled", category: "Variabled", title: "Variable check" });
  expect(finding.group).toContain("Preset ·"); expect(finding.detail).toContain('preset block "Style" (to "calm")');
});
test("text that depends only on variables is Variabled, never a risk", () => {
  const levels = (text: string) => volatileMacros(text).map(effect => effect.level);
  for (const text of [
    // Shapes from a real preset.
    "{{if::{{and::{{or::{{eq::{{var::nsfw_on}}::maximal_filth}}::{{eq::{{var::nsfw_on}}::peak_degeneracy}}}}::{{var::taboo_on}}}}}}A{{/if}}",
    "{{if::{{startsWith::{{var::taboo_on}}::Taboo speech: MAX}}}}A{{/if}}", "{{if::{{var::speak_for_user}} == 0}}A{{/if}}", "{{if::{{isMobile}}}}A{{/if}}", "{{if::{{eq::{{var::a}}::{{char}}}}}}A{{/if}}",
    "{{if::{{var::picks::ison::a,b}}}}A{{/if}}", "{{if::{{hasVar::x}}}}A{{/if}}", "{{if::{{hasgvar::x}}}}A{{/if}}",
    // Through a copy, a binding or a loop.
    "{{setvar::x::{{getvar::y}}}}{{if::{{getvar::x}}}}A{{/if}}", "{{let::x::{{getvar::y}}}}{{if::{{.x}}}}A{{/if}}{{/let}}", "{{foreach::{{getvar::list}}}}{{if .item == yes}}A{{/if}}{{/foreach}}",
    // Later branches and unknown text.
    "{{if::{{getvar::a}}}}A{{elseif::{{getvar::b}}}}B{{/if}}", "{{if::{{getvar::a}}}}{{getvar::b}}{{else}}{{getvar::c}}{{/if}}",
  ]) expect(levels(text)).toEqual(["variabled"]);
  expect(levels("{{if::{{var::a}}}}{{if::{{var::b}}}}A{{/if}}{{/if}}")).toEqual(["variabled", "variabled"]);
  expect(volatileMacros("{{setvar::x::{{getvar::y}}}}{{if::{{getvar::x}}}}A{{/if}}")[0].reason).toContain('"y"');
  expect(volatileMacros("{{foreach::{{getvar::list}}}}{{if .item == yes}}A{{/if}}{{/foreach}}")[0].reason).toContain('"list"');
  expect(volatileMacros("{{if::{{isMobile}}}}A{{/if}}")[0].reason).toContain("{{isMobile}}");
  expect(volatileMacros("{{if::{{var::mode}}}}A{{/if}}", { settings: { mode: "fast" } })[0].reason).toContain('preset setting, currently "fast"');
  expect(levels("{{timediff::{{getvar::a}}::{{getvar::b}}}}")).toEqual([]); expect(levels("{{var::mood}}")).toEqual([]);
  // A real unknown or a moving value next to a variable still counts.
  for (const text of ["{{if::{{custom}}}}{{if::{{getvar::x}}}}A{{/if}}{{/if}}", "{{if::{{eq::{{getvar::a}}::{{custom}}}}}}A{{/if}}", "{{if::{{getvar::a}}}}A{{elseif::{{random::0::1}}}}B{{/if}}", "{{switch::{{custom}}}}{{case::a}}A{{/case}}{{default}}B{{/default}}{{/switch}}", "{{foreachmessage}}{{if .item}}A{{/if}}{{/foreachmessage}}"]) expect(levels(text)).toContain("risk");
  expect(levels("{{if::0}}A{{elseif::{{random::0::1}}}}B{{else}}C{{/if}}")).toContain("issue");
  expect(levels("{{if::{{var::a}}}}{{random::0::1}}{{/if}}")).toEqual(["risk"]);
});
test("macros that hold still in a chat are not flagged, and ones that move are", () => {
  const levels = (text: string, options = {}) => volatileMacros(text, options).map(effect => effect.level);
  for (const name of ["groupCardMode", "scenario", "description", "personality", "char", "user", "persona", "isGroupChat", "isMultiplayer", "isNarrator", "players", "charTags", "model", "maxContext", "chatId", "sub", "lumiaDef", "loomStyle", "mcpToolsActive"]) {
    expect(levels(`{{if::{{${name}}}}A{{else}}B{{/if}}`)).toEqual([]); expect(levels(`{{${name}}}`)).toEqual([]);
    expect(levels(`{{switch::{{${name}}}}}{{case::a}}A{{/case}}{{default}}B{{/default}}{{/switch}}`)).toEqual([]);
  }
  for (const text of ["{{if::{{eq::{{groupCardMode}}::swap}}}}A{{/if}}", "{{if::{{startsWith::{{char}}::A}}}}A{{/if}}", "{{if::{{len::{{scenario}}}}}}A{{/if}}", "{{if::{{calc::1+1}}}}A{{/if}}", "{{if::{{messageAt::0}}}}A{{/if}}"]) expect(levels(text)).toEqual([]);
  // Moves with the turn, the fetch or the focus.
  for (const text of ["{{charGroupFocused}}", "{{groupOthers}}", "{{groupLastSpeaker}}", "{{currentPlayer}}", "{{memories}}", "{{databankActive}}", "{{entities}}", "{{loomSummary}}", "{{webSearchContext}}", "{{outlet::x}}", "{{counter::x}}", "{{if::{{charFocused}}}}A{{/if}}"]) expect(levels(text)).toContain("risk");
  for (const text of ["{{lastMessageName}}", "{{lastSwipeId}}", "{{lastGenerationType}}", "{{messagesBy::Bob::2}}", "{{messageAt::-1}}", "{{chatAge}}", "{{lumiaOOCTrigger}}", "{{foreachMessage}}x{{/foreachMessage}}"]) expect(levels(text)).toContain("issue");
  // Group behavior comes from the chat.
  expect(levels("{{charGroupFocused}}", { cardMode: "solo" })).toEqual([]);
  expect(levels("{{if::{{charGroupFocused}}}}A{{/if}}", { cardMode: "solo" })).toEqual([]);
  expect(levels("{{scenario}}", { cardMode: "swap" })).toEqual(["risk"]);
  expect(levels("{{scenario}}", { cardMode: "merge" })).toEqual([]);
  expect(levels("{{charGroupFocused}}", { cardMode: "merge" })).toEqual(["risk"]);
});
test("the analyzer reads solo, swap and merge from the chat", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [{ ...base, id: "a", name: "Mode", content: "{{if::{{eq::{{groupCardMode}}::swap}}}}{{scenario}}{{/if}}{{charGroupFocused}}" }];
  const rows = () => analyze(data, preview()).findings.filter(row => row.item === "Mode").map(row => row.level);
  expect(rows()).toEqual([]);
  data.chat.metadata = { ...data.chat.metadata, group: true, character_ids: ["a", "b"] };
  expect(rows()).toContain("risk");
  data.chat.metadata = { ...data.chat.metadata, group_card_mode: "merge" };
  data.preset!.prompt_order[0].content = "{{if::{{eq::{{groupCardMode}}::swap}}}}{{scenario}}{{/if}}";
  expect(rows()).toEqual([]);
});
test("multiplayer macros follow the room, not the group", () => {
  const levels = (text: string, options = {}) => volatileMacros(text, options).map(effect => effect.level);
  expect(levels("{{currentPlayer}}", { cardMode: "solo", room: false })).toEqual([]);
  expect(levels("{{currentPlayer}}", { cardMode: "solo", room: true })).toEqual(["risk"]);
  expect(levels("{{charGroupFocused}}", { cardMode: "solo", room: true })).toEqual([]);
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [{ ...base, id: "a", name: "Lobby", content: "{{if::{{isMultiplayer}}}}{{currentPlayer}}{{else}}Alone{{/if}}" }];
  const rows = () => analyze(data, preview()).findings.filter(row => row.item === "Lobby").map(row => row.level);
  expect(rows()).toEqual([]);
  data.chat.metadata = { ...data.chat.metadata, multiplayer_room_id: "room" };
  expect(rows()).toEqual(["risk"]);
});
test("a shuffled list that can only move is an issue, even through a variable or nth", () => {
  const levels = (text: string, options = {}) => volatileMacros(text, options).map(effect => effect.level);
  // The shape from a real preset: the list is set in a branch, then picked from.
  const branches = "{{if::{{getvar::on}}}}{{setvar::openers::a,b,c}}{{else}}{{setvar::openers::d,e}}{{/if}}";
  expect(levels(`${branches}{{nth::{{shuffle::{{getvar::openers}}}}::0}}`)).toContain("issue");
  expect(levels("{{nth::{{shuffle::a,b}}::0}}")).toEqual(["issue"]); expect(levels("{{first::{{pick::a::b}}}}")).toEqual(["issue"]);
  // Written by another source.
  expect(levels("{{shuffle::{{getvar::x}}}}", { written: { "var:x": ["a,b"] } })).toEqual(["issue"]);
  // Could hold a list of one, or nothing is known about it.
  expect(levels("{{shuffle::{{getvar::x}}}}", { written: { "var:x": ["a,b", "a"] } })).toEqual(["risk"]);
  expect(levels("{{shuffle::{{getvar::x}}}}")).toEqual(["risk"]);
  // The result cannot show the order.
  expect(levels("{{len::{{shuffle::a,b}}}}")).toEqual(["risk"]);
  // Only runs if the variable allows it.
  expect(levels("{{if::{{getvar::on}}}}{{nth::{{shuffle::a,b}}::0}}{{/if}}")).toEqual(["risk"]);
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [{ ...base, id: "a", name: "Lists", content: "{{setvar::x::a,b}}" }, { ...base, id: "b", name: "Pick", content: "{{nth::{{shuffle::{{getvar::x}}}}::0}}" }];
  expect(analyze(data, preview()).findings.filter(row => row.item === "Pick").map(row => row.level)).toEqual(["issue"]);
});
test("Loom selections keep plain variable checks out of risks", () => {
  const rows = compositionFindings({ available: true, selections: [{ kind: "style", id: "s", name: "Style", content: "{{if::{{var::a}}}}A{{/if}}" }] } as never, [{ name: "loomstyle", level: "risk" }], {});
  expect(rows.map(row => row.level)).toEqual(["variabled"]);
});
test("a preset setting names its value in the finding", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [{ ...base, id: "a", name: "Anti-Echo", content: "{{if::{{var::speak_for_user}} == 0}}Hi{{/if}}", variables: [{ id: "v", name: "speak_for_user", label: "Speak", type: "text", defaultValue: "1" }] }];
  data.preset!.metadata = { promptVariables: { a: { speak_for_user: "0" } } };
  const finding = analyze(data, preview()).findings.find(row => row.item === "Anti-Echo")!;
  expect(finding).toMatchObject({ level: "variabled", category: "Variabled" }); expect(finding.detail).toContain('preset setting, currently "0"');
});
test("deleting a variable counts as writing it", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  data.preset!.prompt_order = [{ ...base, id: "a", name: "A", content: "{{if::{{random::0::1}}}}{{deletevar::mood}}{{/if}}" }, { ...base, id: "b", name: "Check", content: "{{if::{{getvar::mood}}}}Hi{{/if}}" }];
  expect(analyze(data, preview()).findings.filter(row => row.item === "Check").map(row => row.level)).toEqual(["issue"]);
});
test("a variable is not plain when the thing writing it only runs sometimes or moves", () => {
  const data = sources(), base = data.preset!.prompt_order[0];
  const check = { ...base, id: "check", name: "Check", content: "{{if::{{getvar::mood}}}}Hi{{/if}}" };
  const level = () => analyze(data, preview()).findings.filter(row => row.item === "Check").map(row => row.level);
  // A fixed write inside a random branch.
  data.preset!.prompt_order = [{ ...base, id: "a", name: "A", content: "{{if::{{random::0::1}}}}{{setvar::mood::x}}{{/if}}" }, check];
  expect(level()).toEqual(["issue"]);
  // A block limited to some generation types.
  data.preset!.prompt_order = [{ ...base, id: "a", name: "A", injectionTrigger: ["regenerate"], content: "{{setvar::mood::x}}" }, check];
  expect(level()).toEqual(["risk"]);
  // Keyword lore and a regex match.
  data.preset!.prompt_order = [check];
  data.lore = [{ bookId: "book", bookName: "Book", scope: "Chat", entry: entry({ comment: "Trigger", constant: false, content: "{{setvar::mood::x}}" }) }];
  expect(level()).toEqual(["risk"]);
  data.lore = [{ bookId: "book", bookName: "Book", scope: "Chat", entry: entry({ comment: "Always", constant: true, content: "{{setvar::mood::x}}" }) }];
  expect(level()).toEqual(["variabled"]);
  data.lore = [];
  data.regex = [{ id: "r", name: "Rule", target: ["prompt"], placement: ["ai_output"], scope: "chat", find_regex: "x", replace_string: "{{setvar::mood::x}}", substitute_macros: "after", metadata: {} }] as never;
  expect(level()).toEqual(["risk"]);
});
test("only literal volatile invocations with variable output are flagged", () => {
  const stable = ["{{random::5::5}}", "{{random::5::1}}", "{{pick::one}}", "{{pick::same::same}}", "{{roll::2d1}}", "{{roll::0d6}}", "{{roll::invalid}}", "{{shuffle::a,a}}", "{{r_a_n_d_o_m::a::b}}", "\\{{random::a::b}}", "{{if::0}}{{random::a::b}}{{/if}}", "{{//::{{random::a::b}}}}"];
  for (const text of stable) expect(volatileMacros(text)).toEqual([]);
  for (const text of ["{{random}}", "{{random::1::8}}", "{{pick::a::b}}", "{{roll::2d6}}", "{{shuffle::a,b}}", "{{time}}", "{{isodate}}", "{{message_count}}", "{{last_message_id}}"])
    expect(volatileMacros(text)).toHaveLength(1);
});
test("concrete lore activation and macro findings carry book and entry identities", () => {
  const data = sources();
  data.lore = [{ bookId: "book", bookName: "Storyworld", scope: "Chat", entry: entry({ comment: "Hidden passage", vectorized: true, content: "{{time}}" }) }];
  const findings = analyze(data, preview()).findings;
  expect(findings).toHaveLength(2);
  for (const finding of findings) expect(finding).toMatchObject({ category: "World info", group: "Storyworld", groupId: "book", item: "Hidden passage", itemId: "entry" });
  expect(findings[0].title).toBe("Vector activation"); expect(findings[1].evidence).toEqual(["{{time}}"]);
  data.lore[0].entry.constant = true; data.lore[0].entry.content = "Fixed lore";
  expect(analyze(data, preview()).findings).toEqual([]);
});
test("native structural markers ignore stored placeholder content and scan the referenced card field", () => {
  const data = sources(), block = data.preset!.prompt_order[0];
  block.marker = "char_description"; block.content = "{{random::a::b}}";
  expect(analyze(data, preview()).findings).toEqual([]);
  data.character!.description = "{{pick::rain::sun}}";
  expect(analyze(data, preview()).findings.map(f => f.id)).toEqual(["character-description-random"]);
  block.marker = null; block.content = "{{if::0}}{{description}}{{/if}}";
  expect(analyze(data, preview()).findings).toEqual([]);
  block.content = "{{description}}";
  expect(analyze(data, preview()).findings.map(f => f.id)).toEqual(["character-description-random"]);
});
