import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AssemblyBreakdownEntryDTO, LlmMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { compare, snapshot } from "../src/compare";
import { DiffPlan, type DiffRow } from "../src/diff-engine";
import { memoryFinding } from "../src/health/memory";
import { buildTimeline, promptOutline } from "../src/health/timeline";
import type { StepTimeline } from "../src/health/types";
import { PromptStore } from "../src/prompt-store";
import type { Bridge } from "../src/ui/bridge";
import { renderFindings } from "../src/ui/findings";
import { renderDiff, renderTurnDiff } from "../src/ui/diff";
import { renderTimeline } from "../src/ui/timeline";
import { cacheModeEndpoint, type Check } from "../src/shared";
import { context } from "./fixtures";

const window = new Window(), saved = globalThis.document;
beforeAll(() => { globalThis.document = window.document as unknown as Document; });
afterAll(() => { globalThis.document = saved; window.happyDOM.abort(); });
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const history = (id: string, role: "user" | "assistant", content: string, index: number) => ({ role, content, __chatHistorySource: true, __sourceMessageId: id, __sourceIndexInChat: index }) as unknown as LlmMessageDTO;
const breakdown: AssemblyBreakdownEntryDTO[] = [
  { type: "block", name: "Main prompt", content: "You are a storyteller.", marker: undefined },
  { type: "world_info", name: "World Info Before: Dragon", content: "A dragon guards the bridge." },
  { type: "block", name: "Character Description", marker: "char_description", content: "Mira is a thief." },
  { type: "authors_note", name: "Author's Note", content: "Keep it short, please." },
];
const prompt = (lore = "A dragon guards the bridge."): LlmMessageDTO[] => [
  { role: "system", content: "You are a storyteller." }, { role: "system", content: `Mira is a thief.\n${lore}` },
  history("m1", "user", "Hello there.", 0), { role: "system", content: "Keep it short, please." }, history("m2", "assistant", "The bridge creaks.", 1),
];
const entries = (lore?: string) => breakdown.map(entry => entry.type === "world_info" && lore ? { ...entry, content: lore } : entry);
function timeline(before: LlmMessageDTO[], beforeEntries: AssemblyBreakdownEntryDTO[], after: LlmMessageDTO[], afterEntries: AssemblyBreakdownEntryDTO[]) {
  const ctx = context(), a = snapshot(before, ctx), b = snapshot(after, ctx);
  return buildTimeline(a, promptOutline(a, before, beforeEntries), b, promptOutline(b, after, afterEntries), compare(a, b));
}

test("each message is named after what produced it, with world info found inside merged text", () => {
  const messages = prompt(), outline = promptOutline(snapshot(messages, context()), messages, breakdown);
  expect(outline.map(turn => turn.kind)).toEqual(["system", "world", "story", "injection", "story"]);
  expect(outline[1].parts.map(part => part.label)).toEqual(["Character Description", "World Info Before: Dragon"]);
  expect(outline[1].parts[0].kind).toBe("character");
  expect(outline[2]).toMatchObject({ label: "User", chatIndex: 0 });
  expect(outline[3].injected).toBe(true);
});
test("a break marks its cause and everything after it as written again, naming the part that changed", () => {
  const result = timeline(prompt(), entries(), prompt("A wyrm guards the bridge."), entries("A wyrm guards the bridge."));
  expect(result.rows.map(row => row.status)).toEqual(["kept", "changed", "rewritten", "rewritten", "rewritten"]);
  expect(result.rows[1].root).toBe(true); expect(result.problems).toBe(1);
  expect(result.rows[1].sources).toEqual(["World Info Before: Dragon"]);
  expect(result.rows[1]).toMatchObject({ kind: "world", label: "World Info Before: Dragon" });
  expect(result.kept).toBeLessThan(result.rewritten);
});
test("normal growth is not a problem, and a message added mid-prompt is", () => {
  const grown = [...prompt(), history("m3", "user", "Onward.", 2)];
  const growth = timeline(prompt(), entries(), grown, entries());
  expect(growth.problems).toBe(0); expect(growth.rows.at(-1)!.status).toBe("new"); expect(growth.rows.some(row => row.root)).toBe(false);
  const inserted = [...prompt().slice(0, 2), { role: "system", content: "Fresh lore." } as LlmMessageDTO, ...prompt().slice(2)];
  const added = timeline(prompt(), entries(), inserted, entries());
  expect(added.rows.map(row => row.status)).toEqual(["kept", "kept", "added", "rewritten", "rewritten", "rewritten"]);
  expect(added.rows[2].root).toBe(true);
});
test("a removed message cannot be read as cached", () => {
  const removed = timeline(prompt(), entries(), prompt().slice(0, 4), entries());
  expect(removed.rows.at(-1)).toMatchObject({ status: "removed", root: true, oldIndex: 4 });
  expect(removed.rows.at(-1)!.newIndex).toBeUndefined();
});
test("word diffs highlight only the changed words, including across long wrapped fragments", () => {
  const rows = (plan: DiffPlan) => plan.page().items.filter((item): item is DiffRow => item.kind !== "fold");
  const short = rows(new DiffPlan("The red fox ran.\nStable line.\n", "The blue fox ran.\nStable line.\n"));
  const old = short.find(row => row.kind === "remove")!, next = short.find(row => row.kind === "add")!;
  expect(old.text.slice(...old.spans![0])).toBe("red"); expect(next.text.slice(...next.spans![0])).toBe("blue"); expect(next.spans).toHaveLength(1);
  const words = Array.from({ length: 800 }, (_, i) => `word${i}`).join(" ");
  const long = rows(new DiffPlan(`${words} ending`, `inserted ${words} ending`));
  expect(long.filter(row => row.kind === "add").flatMap(row => row.spans ?? []).length).toBeLessThanOrEqual(2);
  const unrelated = rows(new DiffPlan("Completely different sentence here.\n", "Nothing shared with the old one!\n"));
  expect(unrelated.every(row => !row.spans)).toBe(true);
});
const client = () => {
  const store = new PromptStore();
  const call: Bridge["call"] = async (operation, input) => {
    if (operation === "diffList") return store.list("user", "session", input as never) as never;
    if (operation === "diffOpen") return store.open("user", "session", input as never) as never;
    if (operation === "diffPage") return store.page("user", "session", input as never) as never;
    throw new Error("Unexpected operation");
  };
  return { store, call };
};
test("live diffs mark changed words as safe text and number lines compactly", async () => {
  const ctx = context(), before = snapshot([{ role: "system", content: "The red fox.\n<b>x</b>\n" }], ctx), after = snapshot([{ role: "system", content: "The blue fox.\n<b>x</b>\n" }], ctx);
  const check: Check = { id: "c", chatId: "chat", generationId: "g", deadline: 0, status: "completed", comparison: compare(before, after), before, after };
  const lazy = client(), root = renderDiff(lazy.store.pack(check, "user", "session"), lazy); await flush();
  expect(root.querySelector(".lc-remove .lc-word")!.textContent).toBe("red"); expect(root.querySelector(".lc-add .lc-word")!.textContent).toBe("blue");
  expect(root.querySelectorAll(".lc-diff-row")[0].querySelectorAll(".lc-line-number")).toHaveLength(1);
  expect(root.querySelector("b")).toBeNull();
  expect(root.textContent).not.toContain("Wrap long lines");
  const toggle = root.querySelector("input")!; toggle.checked = true; toggle.dispatchEvent(new window.Event("change") as unknown as Event);
  expect(root.querySelector(".lc-remove .lc-line-text")!.textContent).toContain("The·");
  expect(root.querySelector(".lc-remove .lc-word")!.textContent).toBe("red");
});
test("side by side pairs a replaced line in one row and shows an unchanged message in one column", async () => {
  const ctx = context(), before = snapshot([{ role: "system", content: "Same\nThe red fox.\nGone line\n" }], ctx), after = snapshot([{ role: "system", content: "Same\nThe blue fox.\n" }], ctx);
  const lazy = client(), [a, b] = lazy.store.pack([before, after], "user", "session");
  const pair = renderTurnDiff(a, b, { oldIndex: 0, newIndex: 0 }, lazy); await flush();
  const rows = [...pair.querySelectorAll(".lc-sbs-row")], changed = rows.find(row => row.textContent!.includes("red"))!;
  expect(changed.textContent).toContain("blue");
  expect(changed.querySelector(".lc-remove .lc-word")!.textContent).toBe("red"); expect(changed.querySelector(".lc-add .lc-word")!.textContent).toBe("blue");
  expect(rows.find(row => row.textContent!.includes("Gone line"))!.querySelector(".lc-sbs-empty")).not.toBeNull();
  const same = renderTurnDiff(a, b, { oldIndex: 0, newIndex: 0, same: true }, lazy); await flush();
  expect(same.querySelector(".lc-sbs-single")).not.toBeNull(); expect(same.querySelector(".lc-sbs-heads")).toBeNull(); expect(same.querySelector(".lc-add")).toBeNull();
  const gone = renderTurnDiff(a, b, { oldIndex: 0 }, lazy); await flush();
  expect(gone.textContent).toContain("Gone line");
});
test("the timeline shows every message, puts problems on its rail and opens the clicked turn", () => {
  const data: StepTimeline = timeline(prompt(), entries(), prompt("A wyrm guards the bridge."), entries("A wyrm guards the bridge."));
  const opened: number[] = [], view = renderTimeline(data, row => opened.push(row.newIndex!));
  const turns = [...view.root.querySelectorAll<HTMLButtonElement>(".lc-turn")];
  expect(turns).toHaveLength(5); expect(view.root.querySelector(".lc-tl-break")!.textContent).toContain("Cache breaks here");
  expect(view.root.querySelectorAll(".lc-rail-problem")).toHaveLength(1);
  expect(view.root.querySelector('.lc-rail')!.getAttribute("role")).toBe("scrollbar");
  expect(view.root.querySelector(".lc-tl-legend")!.textContent).toContain("World info");
  turns[1].click(); expect(opened).toEqual([1]);
  const tolerated = renderTimeline({ ...data, tolerated: true }, () => {});
  expect(tolerated.root.querySelector(".lc-tl-break")!.textContent).toContain("allowed tail"); view.dispose(); tolerated.dispose();
});
const pool = (values: Record<string, unknown>, error = "not registered") => ({ rpcPool: { read: async (endpoint: string) => {
  if (endpoint in values) { if (values[endpoint] instanceof Error) throw values[endpoint]; return values[endpoint]; }
  throw new Error(`Shared RPC endpoint "${endpoint}" is ${error}`);
} } }) as unknown as Pick<SpindleAPI, "rpcPool">;
test("Health recommends LumiBooks unless Cache Friendly mode is confirmed on", async () => {
  expect(cacheModeEndpoint("92tiaFOy")).toBe("lumi_books.cache_mode.3932746961464f79");
  const mode = cacheModeEndpoint("user"), running = { "lumi_books.phoneline": new Error("Unauthorized Codex caller") };
  const id = async (values: Record<string, unknown>) => (await memoryFinding(pool(values), "user", 0))[0]?.id;
  expect(await id({})).toBe("lumibooks-missing");
  expect(await id({ [mode]: { cacheFriendly: false } })).toBe("lumibooks-cache-friendly-off");
  expect(await id(running)).toBe("lumibooks-mode-unknown");
  expect((await memoryFinding(pool({ [mode]: { cacheFriendly: false } }), "user", 0))[0].link).toBeUndefined();
  expect(await memoryFinding(pool({ [mode]: { cacheFriendly: true } }), "user", 0)).toEqual([]);
  expect(await memoryFinding(pool({ [mode]: new Error("worker crashed") }), "user", 0)).toEqual([]);
});
test("a mode that publishes while LumiBooks starts up does not raise a false warning", async () => {
  let reads = 0;
  const api = { rpcPool: { read: async (endpoint: string) => {
    if (endpoint.endsWith("phoneline")) throw new Error("Unauthorized Codex caller");
    if (reads++ === 0) throw new Error("not registered");
    return { cacheFriendly: true };
  } } } as unknown as Pick<SpindleAPI, "rpcPool">;
  expect(await memoryFinding(api, "user", 0)).toEqual([]);
});
test("the LumiBooks finding links out safely", async () => {
  const [finding] = await memoryFinding(pool({}), "user", 0);
  const root = renderFindings([finding], new Set(["Context", "Context/History overflow"]));
  const link = root.querySelector("a")!;
  expect(link.href).toBe("https://github.com/AMousePad/LumiBooks"); expect(link.rel).toContain("noopener"); expect(link.textContent).toBe("Find it here.");
  expect(root.textContent).toContain("obliterating your cachability");
});
