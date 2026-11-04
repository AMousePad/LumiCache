import { describe, expect, test } from "bun:test";
import { compare, MAX_PROMPT_CHARACTERS, snapshot } from "../src/compare";
import { context, messages } from "./fixtures";

describe("prompt prefix comparison", () => {
  test("first, identical, appended messages and a growing final message", () => {
    const ctx = context(), before = snapshot(messages(), ctx);
    expect(compare(null, before).kind).toBe("first");
    expect(compare(before, snapshot(messages(), ctx)).kind).toBe("same");
    expect(compare(before, snapshot([...messages(), { role: "assistant", content: "Welcome." }, { role: "user", content: "Next." }], ctx)).kind).toBe("append");
    expect(compare(before, snapshot([{ ...messages()[0] }, { role: "user", content: "Hello. More text." }], ctx)).kind).toBe("append");
  });
  test("edits, insertion, deletion, reordering, roles and names invalidate the prefix", () => {
    const ctx = context(), base = messages(), before = snapshot(base, ctx);
    for (const changed of [messages("Changed system"), [base[1]], [base[1], base[0]], [{ role: "system" as const, content: "New block" }, ...base],
      [{ ...base[0], role: "user" as const }, base[1]], [{ ...base[0], name: "Other" }, base[1]]]) {
      const result = compare(before, snapshot(changed, ctx));
      expect(result.kind).toBe("break"); expect(result.firstMessage).toBe(0);
    }
    expect(compare(before, snapshot([base[0]], ctx)).firstMessage).toBe(1);
  });
  test("reports the exact character prefix without trimming whitespace", () => {
    const ctx = context(), before = snapshot(messages("a\nb "), ctx), after = snapshot(messages("a\nb\t"), ctx);
    expect(compare(before, after)).toMatchObject({ kind: "break", commonCharacters: 3, commonMessages: 0, firstMessage: 0 });
  });
  test("host source metadata, moving cache markers and key order do not alter prompt content", () => {
    const ctx = context(), base = messages();
    expect(compare(snapshot(base, ctx), snapshot(base.map(m => ({ ...m, sourceMessageId: "new", sourceIndexInChat: 4, __isChatHistory: true, cache_control: { type: "ephemeral" } })), ctx)).kind).toBe("same");
    const a = snapshot([{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }], ctx);
    const b = snapshot([{ role: "user", content: [{ text: "hi", type: "text" }] }], ctx);
    expect(compare(a, b).kind).toBe("same");
  });
  test("media and reasoning changes are detected without exposing binary blobs or signatures", () => {
    const ctx = context();
    const a = snapshot([{ role: "user", content: [{ type: "image", data: "first-secret-data", mime_type: "image/png" }] }], ctx);
    const b = snapshot([{ role: "user", content: [{ type: "image", data: "other-secret-data", mime_type: "image/png" }] }], ctx);
    expect(compare(a, b).kind).toBe("break"); expect(JSON.stringify(a)).not.toContain("first-secret-data");
    expect(a.messages[0].body).toContain("sha256:");
    expect(compare(snapshot(messages(), ctx), snapshot(messages().map(m => ({ ...m, reasoning_content: "different" })), ctx)).kind).toBe("break");
  });
  test("tool input fields named cache_control are content, not cache markers", () => {
    const ctx = context();
    const input = (value: string) => snapshot([{ role: "assistant", content: [{ type: "tool_use", id: "call", name: "test", input: { cache_control: value } }] }], ctx);
    expect(compare(input("old"), input("new")).kind).toBe("break");
    expect(input("old").messages[0].body).toContain('"cache_control":"old"');
  });
  test("connection configuration changes flag risk even with the same text", () => {
    const ctx = context(), changed = context({ mainDispatch: { ...ctx.mainDispatch, descriptor: { ...ctx.mainDispatch.descriptor!, model: "other-model" } } });
    expect(compare(snapshot(messages(), ctx), snapshot(messages(), changed))).toMatchObject({ kind: "break", routeChanged: true, firstMessage: null });
  });
  test("type distinctions and message boundaries remain significant", () => {
    const ctx = context();
    expect(compare(snapshot([{ role: "user", content: "[]" }], ctx), snapshot([{ role: "user", content: [] }], ctx)).kind).toBe("break");
    expect(compare(snapshot([{ role: "user", content: "abc" }, { role: "user", content: "d" }], ctx), snapshot([{ role: "user", content: "abcd" }], ctx)).kind).toBe("break");
  });
  test("prompt limits reject rather than compare truncated text", () => {
    expect(() => snapshot(messages("x".repeat(MAX_PROMPT_CHARACTERS)), context())).toThrow("larger than");
  });
});
