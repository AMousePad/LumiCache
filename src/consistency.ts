import type { LlmMessageDTO } from "lumiverse-spindle-types";
import { stableJson, MAX_PROMPT_CHARACTERS } from "./compare";
import type { InspectionContext, Settings } from "./shared";
export type TokenCounter = (messages: LlmMessageDTO[], context: InspectionContext) => Promise<{ total_tokens: number; approximate: boolean }>;
export const historyMessage = (m: LlmMessageDTO) => m.__isChatHistory === true;
const identity = (m: LlmMessageDTO) => m.sourceMessageId;
const wire = (m: LlmMessageDTO) => stableJson({ ...m, sourceMessageMetadata: undefined, sourceMessageId: undefined, sourceIndexInChat: undefined, __isChatHistory: undefined });
export function retain(messages: LlmMessageDTO[]): { messages: LlmMessageDTO[]; size: number } {
  let size = 0;
  const result = messages.map(m => {
    const copy = { ...m }; delete copy.sourceMessageMetadata;
    size += stableJson(copy).length;
    if (size > MAX_PROMPT_CHARACTERS) throw new Error("The prompt exceeds LumiCache's retention limit. Reset the baseline or turn monitoring off.");
    return structuredClone(copy);
  });
  return { messages: result, size };
}
export async function tailStart(messages: LlmMessageDTO[], policy: Required<Settings>, context: InspectionContext, count?: TokenCounter) {
  const indices = messages.flatMap((m, i) => historyMessage(m) ? [i] : []);
  if (!indices.length) return { index: messages.length, approximate: false };
  let index = policy.acceptableDepth === null ? indices[0] : policy.acceptableDepth === 0 ? messages.length : indices[Math.max(0, indices.length - policy.acceptableDepth)];
  let approximate = false;
  if (policy.acceptableTokens !== null) {
    if (!count) throw new Error("The host token counter is unavailable. Leave the token limit blank to use message depth.");
    const candidates = [...indices.filter(i => i >= index), messages.length];
    let lo = 0, hi = candidates.length - 1;
    while (lo < hi) {
      context.signal.throwIfAborted(); const mid = Math.floor((lo + hi) / 2);
      const result = await count(messages.slice(candidates[mid]).filter(historyMessage), context); approximate ||= result.approximate;
      if (!Number.isFinite(result.total_tokens) || result.total_tokens < 0) throw new Error("The host returned an invalid token count.");
      if (result.total_tokens <= policy.acceptableTokens) hi = mid; else lo = mid + 1;
    }
    index = candidates[lo];
  }
  // Guidance immediately before the boundary belongs to that history depth.
  // Never absorb the leading system/preset prefix into the mutable history tail.
  if (index < messages.length) while (index > indices[0] && !historyMessage(messages[index - 1])) index--;
  return { index, approximate };
}
function keyed(messages: LlmMessageDTO[]) {
  const occurrences = new Map<string, number>();
  return messages.filter(historyMessage).map(message => {
    const id = identity(message); if (!id) throw new Error("Force cache consistency needs source message IDs. Disable it for a prompt whose history identity was removed by another extension.");
    const n = occurrences.get(id) ?? 0; occurrences.set(id, n + 1);
    return { key: `${id}:${n}`, message };
  });
}
export function historyUnchanged(before: LlmMessageDTO[], after: LlmMessageDTO[]) {
  try {
    const a = keyed(before), b = new Map(keyed(after).map(x => [x.key, x.message]));
    return a.length > 0 && a.every(x => b.has(x.key) && wire(x.message) === wire(b.get(x.key)!));
  } catch { return false; }
}
/** Restore the frozen prefix and history content. Fresh injections can only enter the permitted tail. */
export async function preserve(before: LlmMessageDTO[] | null, current: LlmMessageDTO[], policy: Required<Settings>, context: InspectionContext, count?: TokenCounter) {
  const now = keyed(current), old = before ? keyed(before) : [];
  const oldKeys = new Set(old.map(x => x.key));
  const maxOldIndex = old.reduce((max, x) => Math.max(max, x.message.sourceIndexInChat ?? -1), -1);
  const added = now.filter(x => !oldKeys.has(x.key) && (!old.length || x.message.sourceIndexInChat !== undefined && x.message.sourceIndexInChat > maxOldIndex));
  if (old.length && now.some(x => !oldKeys.has(x.key) && x.message.sourceIndexInChat === undefined)) throw new Error("Force cache consistency cannot order new history without source indexes.");
  const ledger = before ? [...old, ...added] : now;
  const first = current.findIndex(historyMessage);
  const oldBoundary = before ? await tailStart(before, policy, context, count) : { index: 0, approximate: false };
  const prefix = before ? before.slice(0, oldBoundary.index) : first < 0 ? [...current] : current.slice(0, first);
  const frozen = new Set(keyed(prefix).map(x => x.key));
  const tail = ledger.filter(x => !frozen.has(x.key));
  const base = [...prefix, ...tail.map(x => x.message)];
  const boundary = await tailStart(base, policy, context, count);
  const minimum = Math.max(prefix.length, boundary.index);
  const baseIndices = new Map(base.map((m,i) => [m,i]));
  const positions = new Map(ledger.map(x => [x.key, baseIndices.get(x.message) ?? -1]));
  const nowKeys = new Map<LlmMessageDTO, string>(now.map(x => [x.message, x.key]));
  const injections: { message: LlmMessageDTO; index: number; order: number }[] = [];
  let relocated = 0;
  // With a fully frozen prefix and no new history, a retry must not append duplicate guidance.
  if (!(before && !added.length && oldBoundary.index === before.length)) {
    let nextKey: string | undefined;
    for (let i = current.length - 1; i > first && first >= 0; i--) {
      const m = current[i]; if (historyMessage(m)) { nextKey = nowKeys.get(m); continue; }
      let index = nextKey ? positions.get(nextKey) ?? base.length : base.length;
      if (index < minimum) { index = policy.overflowPlacement === "end" ? base.length : minimum; relocated++; }
      injections.push({ message: m, index, order: i });
    }
  }
  injections.sort((a, b) => b.index - a.index || b.order - a.order);
  for (const injection of injections) base.splice(injection.index, 0, injection.message);
  const currentByKey = new Map(now.map(x => [x.key,x.message]));
  const restored = before ? old.filter(x => { const m = currentByKey.get(x.key); return !m || wire(m) !== wire(x.message); }).length
    + Number(wireList(before.slice(0, before.findIndex(historyMessage) < 0 ? before.length : before.findIndex(historyMessage))) !== wireList(current.slice(0, first < 0 ? current.length : first))) : 0;
  return { messages: base, restored, relocated, approximate: oldBoundary.approximate || boundary.approximate };
}
const wireList = (messages: LlmMessageDTO[]) => messages.map(wire).join("\n");
