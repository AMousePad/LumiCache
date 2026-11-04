import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { LlmMessageDTO, SpindleAPI } from "lumiverse-spindle-types";

/** Where the reply to this prompt sits. CAT baselines have none, as their swipes run outside native sends. */
export interface ReplyMark { index: number; swipes: number }
/** The final prompt of the last successful send. Everything else in a baseline is derived from it. */
export interface SavedBaseline { at: number; route: string; model: string; messages: LlmMessageDTO[]; replies: number; epoch?: string | null; reply?: ReplyMark }
type ChatRow = { index_in_chat: number; is_user: boolean; content: string; swipes: string[] };
// The host stages a blank message or swipe before assembly, so an in-flight send must not count as a response.
const responses = (message: ChatRow) => Math.max(message.swipes.filter(swipe => swipe.trim()).length, message.content.trim() ? 1 : 0);
/** A later AI response means this was not the last prompt sent, as it passed while LumiCache was not watching. */
export function supersededBy(messages: ChatRow[], mark: ReplyMark) {
  return messages.some(message => !message.is_user && (message.index_in_chat > mark.index ? responses(message) > 0 : message.index_in_chat === mark.index && responses(message) > mark.swipes));
}
export interface BaselinePersistence {
  load(user: string, chat: string, scope?: string): Promise<SavedBaseline | null>;
  save(user: string, chat: string, scope: string | undefined, saved: SavedBaseline, replyId?: string): void;
  clear(user: string, chat: string): void;
}
const DIRECTORY = "baselines", MAX_FILES = 128;
const pack = promisify(gzip), unpack = promisify(gunzip);
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

/** Keeps one compressed prompt per chat, overwritten on each success, so size follows chats and not replies. */
export class BaselineStore implements BaselinePersistence {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private api: Pick<SpindleAPI, "userStorage" | "chat">) {}
  private prefix(chat: string) { return `${DIRECTORY}/${hash(chat)}.`; }
  private path(chat: string, scope?: string) { return `${this.prefix(chat)}${scope ? hash(scope) : "main"}.json.gz`; }
  // Writes run in order, and reads wait for them, so a reload cannot see an older prompt.
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => {});
    return result;
  }
  load(user: string, chat: string, scope?: string): Promise<SavedBaseline | null> {
    return this.enqueue(async () => {
      const path = this.path(chat, scope);
      if (!await this.api.userStorage.exists(path, user)) return null;
      const saved = JSON.parse(new TextDecoder().decode(await unpack(await this.api.userStorage.readBinary(path, user)))) as SavedBaseline;
      return saved.reply && supersededBy(await this.api.chat.getMessages(chat), saved.reply) ? null : saved;
    });
  }
  save(user: string, chat: string, scope: string | undefined, saved: SavedBaseline, replyId?: string) {
    // A failed write only costs the comparison after the next restart, so it must not fail the reply.
    void this.enqueue(async () => {
      const reply = replyId ? (await this.api.chat.getMessages(chat)).find(message => message.id === replyId) : undefined;
      const stored = reply ? { ...saved, reply: { index: reply.index_in_chat, swipes: responses(reply) } } : saved;
      await this.api.userStorage.writeBinary(this.path(chat, scope), new Uint8Array(await pack(JSON.stringify(stored))), user);
      await this.prune(user);
    }).catch(error => console.warn("[LumiCache] Could not save the baseline:", error));
  }
  clear(user: string, chat: string) {
    void this.enqueue(async () => {
      const files = await this.files(user);
      for (const file of files) if (file.startsWith(this.prefix(chat))) await this.api.userStorage.delete(file, user);
    }).catch(error => console.warn("[LumiCache] Could not remove the baseline:", error));
  }
  private async files(user: string) {
    // The host may list paths relative to the folder asked for.
    return (await this.api.userStorage.list(DIRECTORY, user)).map(file => file.startsWith(`${DIRECTORY}/`) ? file : `${DIRECTORY}/${file}`);
  }
  private async prune(user: string) {
    const files = await this.files(user);
    if (files.length <= MAX_FILES) return;
    const dated = await Promise.all(files.map(async file => ({ file, at: Date.parse((await this.api.userStorage.stat(file, user)).modifiedAt) })));
    dated.sort((a, b) => a.at - b.at);
    for (const { file } of dated.slice(0, files.length - MAX_FILES)) await this.api.userStorage.delete(file, user);
  }
}
