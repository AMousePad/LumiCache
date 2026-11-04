/** Behavioral comparison with the installed Lumiverse engine, in an isolated process. */
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { scanMacros } from "../src/health/macros";
import { regexFindings } from "../src/health/regex";
const repo = resolve(import.meta.dir, ".."), host = resolve(process.argv[2] || "../Lumiverse"), dir = join(repo, "local", "macro-host", String(Date.now()));
mkdirSync(dir, { recursive: true }); process.env.DATA_DIR = join(dir, "data"); process.chdir(dir);
const fromHost = (path: string) => import(pathToFileURL(join(host, "src", path)).href);
const engine = await fromHost("macros/index.ts"); engine.initMacros();
const makeEnv = () => engine.buildEnv({ character: { id: "character", name: "Fixture", tags: ["a", "b"], extensions: {} }, persona: null,
  chat: { id: "chat", metadata: {} }, messages: [], generationType: "normal", commit: false });
const originalRandom = Math.random, checks: string[] = [];
const cases: [string, boolean][] = [
  ["{{roll::2d6}}", true], ["{{upper::{{roll::2d6}}}}", true], ["{{uppercase::{{lower::{{pick::red::blue}}}}}}", true],
  ["{{if::1}}{{#trim}}{{roll::2d6}}{{/trim}}{{/if}}", true],
  ["{{if::0}}fixed{{elseif::{{eq::01::1}}}}{{roll::2d6}}{{else}}fixed{{/if}}", true],
  ["{{unless::false}}{{roll:2d6}}{{/unless}}", true], ["{{switch::x::y::fixed::x::{{roll::2d6}}::fixed}}", true],
  ["{{switch::x}}{{case::x}}{{roll::2d6}}{{/case}}{{default}}fixed{{/default}}{{/switch}}", true],
  ["{{let::dice::2d6}}{{roll::{{.dice}}}}{{/let}}", true], ["{{setvar::dice::2d6}}{{roll::{{getvar::dice}}}}", true],
  ["{{foreach::yes,no}}{{if .item == yes}}{{roll::2d6}}{{/if}}{{/foreach}}", true],
  ["{{!roll::2d6}}", true], ["{{?roll::2d6}}", true], ["{{~upper::{{roll::2d6}}}}", true],
  ["{{upper::".repeat(120) + "{{roll::2d6}}" + "}}".repeat(120), true],
  ["{{if::0}}{{roll::2d6}}{{/if}}", false], ["{{unless::true}}{{roll::2d6}}{{/unless}}", false],
  ["{{switch::x::y::{{roll::2d6}}::fixed}}", false], ["{{and::0::{{roll::2d6}}}}", false], ["{{or::true::{{roll::2d6}}}}", false],
  ["{{and::{{roll::2d6}}::0}}", false], ["{{if::{{roll::2d6}}}}same{{else}}same{{/if}}", false],
  ["{{#escape}}{{if::1}}{{roll::2d6}}{{/if}}{{/escape}}", false], ["{{comment}}{{roll::2d6}}{{/comment}}", false],
  ["{{trim::{{roll::2d6}}}}", false], ["{{foreach::}}{{roll::2d6}}{{/foreach}}", false], ["{{setvar::x::5}}{{incvar::x}}", false],
  ["{{roll::{{pick::2d1::2d1}}}}", false], ["{{if::{{escape}}literal{{/escape}}}}{{roll::2d6}}{{/if}}", true],
];
try {
  for (const [template, changes] of cases) {
    Math.random = () => .05; const first = await engine.evaluate(template, makeEnv(), engine.registry);
    Math.random = () => .9; const second = await engine.evaluate(template, makeEnv(), engine.registry);
    assert.equal(first.text !== second.text, changes, `Native output: ${template.slice(0, 140)}`);
    const scan = scanMacros(template);
    assert.equal(scan.effects.some(effect => effect.level === "issue"), changes, `Issue classification: ${template.slice(0, 140)} ${JSON.stringify(scan.effects)}`);
    checks.push(`Macro: ${template.slice(0, 140)}`);
  }
  const { applyRegexScripts } = await fromHost("services/regex-scripts.service.ts");
  const { resolvePromptMacrosAfterRegexPass } = await fromHost("services/prompt-assembly.service.ts");
  const rule = { id: "rule", name: "Fixture", target: ["prompt"], placement: ["ai_output"], scope: "chat", find_regex: "X", replace_string: "{{upper::{{roll::2d6}}}}",
    flags: "g", substitute_macros: "none", disabled: false, min_depth: null, max_depth: null, metadata: {}, actions: [], trim_strings: [] };
  const resolveRule = async (seed: number, depth = 0) => {
    Math.random = () => seed; const env = makeEnv(), content = await applyRegexScripts("X", [rule], "ai_output", depth, env);
    const messages = [{ role: "assistant", content }]; await resolvePromptMacrosAfterRegexPass(messages, env); return messages[0].content;
  };
  assert.notEqual(await resolveRule(.05), await resolveRule(.9)); assert.equal(regexFindings([rule as never], true, {})[0].level, "issue"); checks.push("Native post-regex macro pass expands a nested roll even with substitution mode none");
  rule.replace_string = "fixed"; assert.equal(await resolveRule(.05), await resolveRule(.9)); assert.equal(regexFindings([rule as never], true, {}).length, 0); checks.push("A deterministic regex replacement is quiet");
  (rule as any).max_depth = 1; assert.notEqual(await resolveRule(.05, 0), await resolveRule(.05, 2)); assert.equal(regexFindings([rule as never], true, {})[0].level, "issue"); checks.push("Moving regex depth changes the same saved message");
  await Bun.write(join(dir, "results.json"), JSON.stringify({ checks }, null, 2));
  console.log(`NATIVE MACRO COMPLETE: ${checks.length} checks. Evidence: ${join(dir, "results.json")}`);
} finally { Math.random = originalRandom; }
process.exit(0);
