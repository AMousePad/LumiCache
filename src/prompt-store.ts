import { createHash } from "node:crypto";
import { diffArrays } from "diff";
import { DiffPlan, type DiffPage } from "./diff-engine";
import type { Snapshot } from "./shared";

export interface MessageChange { oldIndex?: number; newIndex?: number; role: string; kind: "added" | "removed" | "changed" | "unchanged"; headerChanged: boolean; depth?: number; nextDepth?: number }
export interface MessagePage { items: MessageChange[]; total: number; unchanged: number; cursor: number; next?: number; previous?: number; note?: string }
export interface DiffInput { before?: string; after: string; oldIndex?: number; newIndex?: number; part?: "body" | "header" }
interface Stored { user: string; session: string; snapshot: Snapshot; size: number; touched: number }
interface StoredPlan { user: string; session: string; plan: DiffPlan; touched: number; size: number }
const LIMIT = 256_000_000, TTL = 30 * 60_000;
const integer = (value: number | undefined, fallback = 0) => {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid prompt page."); return value;
};
/** Pairs messages by content. Replaced messages pair by position inside each changed run. */
export function alignMessages(a: Snapshot["messages"], b: Snapshot["messages"]): { pairs: [number | undefined, number | undefined][]; aligned: boolean } {
  const hash = (m: Snapshot["messages"][number]) => createHash("sha256").update(m.header).update("\0").update(m.body).digest("hex");
  const parts = diffArrays(a.map(hash), b.map(hash), { timeout: 60, maxEditLength: 1000 });
  const pairs: [number | undefined, number | undefined][] = [];
  if (!parts) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) pairs.push([i < a.length ? i : undefined, i < b.length ? i : undefined]);
    return { pairs, aligned: false };
  }
  let ai = 0, bi = 0, removed: number[] = [], added: number[] = [];
  const flush = () => { for (let i = 0; i < Math.max(removed.length, added.length); i++) pairs.push([removed[i], added[i]]); removed = []; added = []; };
  for (const part of parts) {
    if (part.removed) { for (let i = 0; i < part.value.length; i++) removed.push(ai++); }
    else if (part.added) { for (let i = 0; i < part.value.length; i++) added.push(bi++); }
    else { flush(); for (let i = 0; i < part.value.length; i++) pairs.push([ai++, bi++]); }
  }
  flush();
  return { pairs, aligned: true };
}
export class PromptStore {
  private snapshots = new Map<string, Stored>();
  private plans = new Map<string, StoredPlan>();
  private references = new WeakMap<Snapshot, string>();
  private lists = new Map<string, { items: MessageChange[]; unchanged: number; note?: string }>();
  private prune() {
    for (const [key, value] of this.snapshots) if (value.touched < Date.now() - TTL) this.snapshots.delete(key);
    for (const [key, value] of this.plans) if (value.touched < Date.now() - TTL) this.plans.delete(key);
    let size = [...this.snapshots.values()].reduce((n, value) => n + value.size, 0);
    while (size > LIMIT || this.snapshots.size > 128) {
      const [key, value] = this.snapshots.entries().next().value!; this.snapshots.delete(key); size -= value.size;
    }
    let planSize = [...this.plans.values()].reduce((n, value) => n + value.size, 0);
    while (this.plans.size > 12 || planSize > 192_000_000) {
      const [key, value] = this.plans.entries().next().value!; this.plans.delete(key); planSize -= value.size;
    }
    // Derived list metadata never owns prompt strings.
    if (this.lists.size > 64) this.lists.delete(this.lists.keys().next().value!);
  }
  expose(snapshot: Snapshot, user: string, session: string): Snapshot {
    let reference = this.references.get(snapshot), stored = reference ? this.snapshots.get(reference) : undefined;
    if (!stored || stored.user !== user || stored.session !== session) {
      reference = crypto.randomUUID();
      stored = { user, session, snapshot, size: snapshot.messages.reduce((n, m) => n + m.body.length + m.header.length, 0), touched: Date.now() };
      this.references.set(snapshot, reference); this.snapshots.set(reference, stored);
    } else { stored.touched = Date.now(); this.snapshots.delete(reference!); this.snapshots.set(reference!, stored); }
    this.prune();
    return { at: snapshot.at, route: snapshot.route, model: snapshot.model, messages: [], reference, messageCount: snapshot.messages.length };
  }
  // Replace only snapshot-shaped objects. Prompt bodies never travel in load or
  // simulation replies; the browser requests bounded pages when opened.
  pack<T>(value: T, user: string, session: string): T {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(item => this.pack(item, user, session)) as T;
    const object = value as Record<string, unknown>;
    if (Array.isArray(object.messages) && typeof object.route === "string" && typeof object.at === "number") return this.expose(value as unknown as Snapshot, user, session) as T;
    return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, this.pack(item, user, session)])) as T;
  }
  private get(id: string, user: string, session: string): Snapshot {
    this.prune(); const value = this.snapshots.get(id);
    if (!value || value.user !== user || value.session !== session) throw new Error("This prompt view expired or belongs to another browser. Refresh the live check or rerun the simulation.");
    value.touched = Date.now(); this.snapshots.delete(id); this.snapshots.set(id, value); return value.snapshot;
  }
  list(user: string, session: string, input: { before?: string; after: string; cursor?: number; includeUnchanged?: boolean }): MessagePage {
    const before = input.before ? this.get(input.before, user, session) : undefined, after = this.get(input.after, user, session);
    const key = JSON.stringify([input.before, input.after, !!input.includeUnchanged]);
    let list = this.lists.get(key);
    if (!list) {
      const a = before?.messages ?? [], b = after.messages, alignment = alignMessages(a, b);
      const items: MessageChange[] = []; let unchanged = 0;
      const add = (oldIndex?: number, newIndex?: number) => {
        const old = oldIndex === undefined ? undefined : a[oldIndex], next = newIndex === undefined ? undefined : b[newIndex];
        const same = !!old && !!next && old.header === next.header && old.body === next.body;
        if (same) unchanged++;
        // Same depths as the timeline: the previous prompt's where it exists, and the landing depth for an added message.
        const depth = before ? old?.depth : next?.depth, nextDepth = before && !old ? next?.depth : undefined;
        if (!same || input.includeUnchanged) items.push({ oldIndex, newIndex, role: next?.role ?? old!.role,
          kind: same ? "unchanged" : !old ? "added" : !next ? "removed" : "changed", headerChanged: !!old && !!next && old.header !== next.header,
          ...(depth !== undefined ? { depth } : {}), ...(nextDepth !== undefined ? { nextDepth } : {}) });
      };
      for (const [oldIndex, newIndex] of alignment.pairs) add(oldIndex, newIndex);
      list = { items, unchanged, ...(!alignment.aligned ? { note: "Message alignment reached its work limit; messages are compared by position." } : {}) }; this.lists.set(key, list);
    }
    const cursor = integer(input.cursor), total = list.items.length;
    if (cursor > Math.max(total - 1, 0)) throw new Error("This message page is outside the available range.");
    return { items: list.items.slice(cursor, cursor + 20), total, unchanged: list.unchanged, cursor, note: list.note,
      ...(cursor + 20 < total ? { next: cursor + 20 } : {}), ...(cursor ? { previous: Math.max(0, cursor - 20) } : {}) };
  }
  open(user: string, session: string, input: DiffInput, pageRows = 100): { id: string; page: DiffPage } {
    const before = input.before ? this.get(input.before, user, session) : undefined, after = this.get(input.after, user, session);
    const read = (snapshot: Snapshot | undefined, index: number | undefined) => {
      if (index === undefined) return "";
      const message = snapshot?.messages[integer(index)]; if (!message) throw new Error("This prompt message is unavailable.");
      return input.part === "header" ? message.header : message.body;
    };
    const oldText = read(before, input.oldIndex), newText = read(after, input.newIndex);
    const plan = new DiffPlan(oldText, newText), id = crypto.randomUUID();
    this.plans.set(id, { user, session, plan, touched: Date.now(), size: (oldText.length + newText.length) * 2 + plan.before.starts.byteLength * 3 + plan.after.starts.byteLength * 3 }); this.prune();
    return { id, page: plan.page(0, undefined, pageRows) };
  }
  page(user: string, session: string, input: { id: string; cursor?: number; fold?: number; limit?: number }): DiffPage {
    this.prune(); const stored = this.plans.get(input.id);
    if (!stored || stored.user !== user || stored.session !== session) throw new Error("This diff view expired. Close and reopen the message to load it again.");
    stored.touched = Date.now(); this.plans.delete(input.id); this.plans.set(input.id, stored);
    return stored.plan.page(integer(input.cursor), input.fold === undefined ? undefined : integer(input.fold), input.limit);
  }
}
