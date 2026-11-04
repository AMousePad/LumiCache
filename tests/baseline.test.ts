import { expect, test } from "bun:test";
import { BaselineStore, type SavedBaseline } from "../src/baseline";

const row = (index: number, content: string, swipes = [content], id = `m${index}`, is_user = false) => ({ id, index_in_chat: index, is_user, content, swipes });
function storage(chat: ReturnType<typeof row>[] = []) {
  const files = new Map<string, { data: Uint8Array; at: number }>();
  let clock = 0;
  const userStorage = {
    exists: async (path: string) => files.has(path),
    readBinary: async (path: string) => files.get(path)!.data,
    writeBinary: async (path: string, data: Uint8Array) => { files.set(path, { data, at: ++clock }); },
    list: async (prefix: string) => [...files.keys()].filter(path => path.startsWith(prefix)),
    delete: async (path: string) => { files.delete(path); },
    stat: async (path: string) => ({ modifiedAt: new Date(files.get(path)!.at).toISOString() }),
  };
  return { files, store: new BaselineStore({ userStorage, chat: { getMessages: async () => chat } } as never), chat };
}
const saved = (content: string): SavedBaseline => ({ at: 1, route: "route", model: "model", messages: [{ role: "user", content }], replies: 2, epoch: null });
const settled = (store: BaselineStore) => store.load("user", "settled");

test("the latest prompt round-trips, compressed, and each chat keeps one file", async () => {
  const { store, files } = storage(), large = "cache ".repeat(100_000);
  store.save("user", "chat", undefined, saved("older"));
  store.save("user", "chat", undefined, saved(large));
  expect(await store.load("user", "chat")).toEqual(saved(large));
  expect(files.size).toBe(1); expect([...files.values()][0].data.length).toBeLessThan(large.length / 10);
  expect(await store.load("user", "other")).toBeNull();
});
test("scopes stay separate, and clearing a chat removes only that chat", async () => {
  const { store } = storage();
  store.save("user", "chat", undefined, saved("main"));
  store.save("user", "chat", "cat", saved("cat"));
  store.save("user", "other", undefined, saved("other"));
  expect((await store.load("user", "chat", "cat"))!.messages[0].content).toBe("cat");
  store.clear("user", "chat");
  expect(await store.load("user", "chat")).toBeNull(); expect(await store.load("user", "chat", "cat")).toBeNull();
  expect((await store.load("user", "other"))!.messages[0].content).toBe("other");
});
test("old chats are pruned past the file limit", async () => {
  const { store, files } = storage();
  for (let i = 0; i < 130; i++) store.save("user", `chat-${i}`, undefined, saved("text"));
  await settled(store);
  expect(files.size).toBe(128);
  expect(await store.load("user", "chat-0")).toBeNull(); expect(await store.load("user", "chat-129")).not.toBeNull();
});
test("a later AI response retires the saved prompt, and an in-flight or user message does not", async () => {
  const chat = [row(0, "Hello"), row(1, "Question", ["Question"], "m1", true), row(2, "Reply")];
  const { store } = storage(chat);
  store.save("user", "chat", undefined, saved("prompt"), "m2");
  expect((await store.load("user", "chat"))!.reply).toEqual({ index: 2, swipes: 1 });
  chat.push(row(3, "Next question", ["Next question"], "m3", true), row(4, "", [""]));
  expect(await store.load("user", "chat")).not.toBeNull();
  chat[2].swipes = ["Reply", ""];
  expect(await store.load("user", "chat")).not.toBeNull();
  chat[4].content = "A reply made while LumiCache was off"; chat[4].swipes = [chat[4].content];
  expect(await store.load("user", "chat")).toBeNull();
});
test("a new swipe on the same reply retires it too, and a deleted reply does not", async () => {
  const chat = [row(0, "Reply")];
  const { store } = storage(chat);
  store.save("user", "chat", undefined, saved("prompt"), "m0");
  await store.load("user", "chat");
  chat[0].swipes = ["Reply", "Another take"];
  expect(await store.load("user", "chat")).toBeNull();
  chat.length = 0;
  expect(await store.load("user", "chat")).not.toBeNull();
});
test("a CAT baseline has no reply to check", async () => {
  const chat = [row(0, "Reply")];
  const { store } = storage(chat);
  store.save("user", "chat", "cat", saved("prompt"));
  chat.push(row(1, "A later reply"));
  expect(await store.load("user", "chat", "cat")).not.toBeNull();
});
