import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { SimulationStep } from "../src/health/types";
import { validateSettings } from "../src/settings";
import { cacheMeter } from "../src/ui/health";

const window = new Window(), saved = globalThis.document;
beforeAll(() => { globalThis.document = window.document as unknown as Document; });
afterAll(() => { globalThis.document = saved; window.happyDOM.abort(); });

const step = (kind: "break" | "append", tolerated: boolean, kept: number, rewritten: number, added = 0, routeChanged = false) =>
  ({ comparison: { kind }, timeline: { rows: [], kept, rewritten, added, problems: 0, tolerated, routeChanged } }) as unknown as SimulationStep;
const render = (s: SimulationStep, settings = {}) => {
  const [meter, copy] = cacheMeter(s, validateSettings({ mode: "warn", ...settings }));
  return { risk: meter!.classList.contains("lc-meter-risk"), text: copy!.textContent };
};

describe("simulation cache meter", () => {
  test("a break before the allowed tail puts the unchanged part at risk", () => {
    expect(render(step("break", false, 89, 11))).toEqual({ risk: true,
      text: "89% is consistent but at risk of invalidation due to the remaining 11% breaking cache outside of your allowed tail of depth 2" });
  });
  test("names the saved depth and token limit, and keeps new text", () => {
    expect(render(step("break", false, 80, 10, 10), { acceptableDepth: 4, acceptableTokens: 3000 }).text)
      .toBe("80% is consistent but at risk of invalidation due to the remaining 10% breaking cache outside of your allowed tail of depth 4 and 3,000 tokens · 10% new");
  });
  test("a break inside the allowed tail is only recached", () => {
    expect(render(step("break", true, 89, 11))).toEqual({ risk: false, text: "89% cache consistent · 11% recached" });
  });
  test("appends, route changes and full rewrites are not at risk", () => {
    expect(render(step("append", false, 90, 0, 10))).toEqual({ risk: false, text: "90% cache consistent · 10% new" });
    expect(render(step("break", false, 0, 100, 0, true)).risk).toBe(false);
    expect(render(step("break", false, 0, 100)).risk).toBe(false);
  });
});
