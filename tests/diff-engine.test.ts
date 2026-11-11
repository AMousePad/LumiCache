import { expect, test } from "bun:test";
import { DiffPlan, TextIndex, PAGE_ROWS, ROW_CHARACTERS, type DiffRow } from "../src/diff-engine";
import { PromptStore } from "../src/prompt-store";
import { snapshot } from "../src/compare";
import { context } from "./fixtures";

function reconstruct(plan: DiffPlan) {
  let old = "", next = "", cursor: number | undefined = 0;
  const consume = (row: DiffRow) => { if (row.kind !== "add") old += row.text; if (row.kind !== "remove") next += row.text; expect(row.text.length).toBeLessThanOrEqual(ROW_CHARACTERS); };
  while (cursor !== undefined) {
    const page = plan.page(cursor); expect(page.items.length).toBeLessThanOrEqual(PAGE_ROWS);
    for (const item of page.items) {
      if (item.kind !== "fold") consume(item);
      else {
        let offset: number | undefined = 0;
        while (offset !== undefined) { const context = plan.page(offset, item.id); for (const row of context.items) { if (row.kind === "fold") throw new Error("Nested fold"); consume(row); } offset = context.next; }
      }
    }
    cursor = page.next;
  }
  return { old, next };
}
test("diff pages preserve every character, CRLF, Unicode, empty text and missing final newline", () => {
  const values = ["", "\n", "\r\n", "abc", "abc\n", "line \nline\t", "😀\r\n안녕\n", "x".repeat(1023) + "😀\r\nend", "same\n".repeat(30)];
  for (const old of values) for (const next of values) expect(reconstruct(new DiffPlan(old, next))).toEqual({ old, next });
});
test("seeded insertions, replacements and removals never hide changed characters", () => {
  let seed = 81021; const rand = (n: number) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
  const alphabet = ["a", "x", " ", "\n", "\t", "\r\n", "😀", "안녕"];
  for (let trial = 0; trial < 100; trial++) {
    const old = Array.from({ length: 300 }, () => alphabet[rand(alphabet.length)]).join("");
    let next = old;
    for (let i = 0; i < 5; i++) { const start = rand(next.length + 1); next = next.slice(0, start) + alphabet[rand(alphabet.length)] + next.slice(start + rand(6)); }
    expect(reconstruct(new DiffPlan(old, next))).toEqual({ old, next });
  }
});
test("million-word messages yield compact diffs at the beginning, middle and end", () => {
  const base = "cache ".repeat(1_000_000);
  for (const position of [0, 3_000_000, base.length]) {
    const next = base.slice(0, position) + "CHANGED" + base.slice(position), started = performance.now();
    const plan = new DiffPlan(base, next), page = plan.page();
    expect(performance.now() - started).toBeLessThan(3000);
    expect(JSON.stringify(page).length).toBeLessThan(20_000);
    expect(page.items.some(item => item.kind === "add" && item.text.includes("CHANGED"))).toBe(true);
    expect(page.items.some(item => item.kind === "fold")).toBe(true);
  }
});
test("separated changes collapse unchanged interiors; a total rewrite stays paged and lossless", () => {
  const middle = Array.from({ length: 400 }, (_, i) => `Unchanged line ${i}\n`).join("");
  const plan = new DiffPlan(`old\n${middle}old end`, `new\n${middle}new end`);
  expect(plan.page().items.filter(i => i.kind === "fold")).toHaveLength(1);
  expect(reconstruct(plan)).toEqual({ old: `old\n${middle}old end`, next: `new\n${middle}new end` });
  const rewritten = new DiffPlan("before\n".repeat(3000), "after\n".repeat(3000));
  expect(rewritten.note).toContain("replacement"); expect(rewritten.page().next).toBe(100);
  expect(reconstruct(rewritten)).toEqual({ old: "before\n".repeat(3000), next: "after\n".repeat(3000) });
});
test("snapshot references keep full prompts out of replies and enforce user/session ownership", async () => {
  const store = new PromptStore(), source = snapshot([{ role: "system", content: "cache ".repeat(1_000_000) }], context());
  const view = await store.pack({ source, copies: [source, source] }, "user", "session");
  expect(JSON.stringify(view).length).toBeLessThan(2000); expect(view.source.messages).toHaveLength(0);
  expect(view.source.reference).toBe(view.copies[0].reference);
  const input = { after: view.source.reference!, newIndex: 0 };
  await expect(store.open("foreign", "session", input)).rejects.toThrow("another browser");
  await expect(store.open("user", "foreign", input)).rejects.toThrow("another browser");
  const plan = await store.open("user", "session", input); expect(JSON.stringify(plan).length).toBeLessThan(120_000);
  expect(() => store.page("foreign", "session", { id: plan.id })).toThrow("expired");
  expect(() => store.page("user", "foreign", { id: plan.id })).toThrow("expired");
  for (const cursor of [-1, 0.5, Infinity, NaN, 99_999]) expect(() => store.page("user", "session", { id: plan.id, cursor })).toThrow();
  expect(() => store.page("user", "session", { id: plan.id, fold: 999 })).toThrow();
});
test("concurrent requests share one reference for a snapshot", async () => {
  const store = new PromptStore(), source = snapshot([{ role: "system", content: "cache" }], context());
  const [a, b] = await Promise.all([store.expose(source, "user", "session"), store.expose(source, "user", "session")]);
  expect(a.reference).toBeString(); expect(a.reference).toBe(b.reference);
});
test("inserted messages do not turn unchanged subsequent messages into changes", async () => {
  const store = new PromptStore(), messages = ["one", "two", "three"].map(content => ({ role: "system" as const, content }));
  const a = await store.expose(snapshot(messages, context()), "u", "s");
  const b = await store.expose(snapshot([messages[0], { role: "system", content: "inserted" }, ...messages.slice(1)], context()), "u", "s");
  const page = store.list("u", "s", { before: a.reference, after: b.reference! });
  expect(page.unchanged).toBe(3); expect(page.total).toBe(1); expect(page.items[0]).toMatchObject({ kind: "added", newIndex: 1 });
  expect(store.list("u", "s", { before: a.reference, after: b.reference!, includeUnchanged: true }).total).toBe(4);
});

test("a million newline-heavy rows stay compact and excessive fragmentation fails explicitly", () => {
  const old = "\n".repeat(1_000_000), next = old + "change";
  const started = performance.now(), plan = new DiffPlan(old, next);
  expect(performance.now() - started).toBeLessThan(3000);
  expect(JSON.stringify(plan.page()).length).toBeLessThan(4000);
  const fold = plan.page().items.find(item => item.kind === "fold")!;
  if (fold.kind !== "fold") throw new Error("Expected hidden context");
  expect(plan.page(999_000, fold.id).items).toHaveLength(100);
  expect(() => new TextIndex("\n".repeat(2_000_001))).toThrow("two million display fragments");
});
