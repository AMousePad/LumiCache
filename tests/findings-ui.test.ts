import { beforeAll, afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderFindings, healthPill } from "../src/ui/findings";
import type { Finding } from "../src/health/types";
const window = new Window(), saved = globalThis.document;
beforeAll(() => { globalThis.document = window.document as unknown as Document; });
afterAll(() => { globalThis.document = saved; window.happyDOM.abort(); });
const row = (i: number): Finding => ({ id: `activation-${i}`, level: "risk", category: "World info", group: "Storyworld", groupId: "book", item: `Named entry ${i}`, itemId: `${i}`,
  title: "Keyword activation", source: "Lore", detail: "Keyword matches can change.", suggestion: "Use constant activation." });
test("findings use named category, book and entry levels with compact counts", () => {
  const rows = [row(1), { ...row(1), id: "random-1", title: "Random output", evidence: ["{{pick::a::b}}"] }, row(2),
    { ...row(3), category: "Preset" as const, group: "Preset", groupId: "preset", item: "Opening variation" }];
  const root = renderFindings(rows, new Set());
  expect(root.querySelectorAll(":scope > .lc-group")).toHaveLength(2);
  expect(root.querySelectorAll(".lc-subgroup")).toHaveLength(1);
  expect(root.querySelectorAll(".lc-finding-row")).toHaveLength(3);
  expect(root.querySelector(".lc-finding-summary")!.textContent).toContain("Named entry 1");
  expect(root.querySelector(".lc-finding-summary")!.textContent).toContain("{{pick::a::b}}");
  expect(healthPill(rows).getAttribute("aria-label")).toBe("4 risks, 0 issues");
  expect([...root.querySelectorAll("details")].every(el => !el.open)).toBe(true);
});
test("expanded hierarchy and additional rows survive an automatic update", () => {
  const rows = Array.from({ length: 39 }, (_, i) => row(i)), state = new Set(["World info", "World info/book", "World info/book/1"]);
  let root = renderFindings(rows, state);
  expect(root.querySelectorAll(".lc-finding-row")).toHaveLength(30);
  root.querySelector<HTMLButtonElement>(".lc-text-button")!.click();
  root = renderFindings(rows, state);
  expect(root.querySelectorAll(".lc-finding-row")).toHaveLength(39);
  expect(root.querySelectorAll("details[open]")).toHaveLength(3);
  expect(root.querySelector("summary")!.dataset.focus).toBeDefined();
});
