import { createHash } from "node:crypto";
import type { ChatMessageDTO, ContextClipStatsDTO } from "lumiverse-spindle-types";
import { ScanLimit } from "./macro-syntax";

/** Respect the native provenance map for braces saved as literal message data. */
export function historyTemplate(message: Pick<ChatMessageDTO, "content" | "extra">): string {
  let text = message.content;
  const provenance = message.extra?.macro_literal_braces as Record<string, unknown> | undefined;
  const positions = provenance?.[createHash("sha256").update(text).digest("hex")];
  if (Array.isArray(positions)) {
    const chunks: string[] = []; let start = 0, valid = true;
    for (const position of positions) {
      if (!Number.isSafeInteger(position) || position < start || position >= text.length || !"{}".includes(text[position])) { valid = false; break; }
      chunks.push(text.slice(start, position), text[position] === "{" ? "\u0001" : "\u0002"); start = position + 1;
    }
    if (valid) text = chunks.join("") + text.slice(start);
  }
  if (!/<json>/i.test(text)) return text;
  // Valid top-level <json> blocks are data in native history, including braces in strings.
  const chunks: string[] = []; let start = 0, depth = 0, work = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && /[{}]/.test(text[i + 1] ?? "")) { i++; continue; }
    if (text.startsWith("{{", i)) { depth++; i++; continue; }
    if (depth && text.startsWith("}}", i)) { depth--; i++; continue; }
    if (depth || text.slice(i, i + 6).toLowerCase() !== "<json>") continue;
    let quoted = false, close = -1;
    for (let j = i + 6; j < text.length; j++) {
      if (++work > Math.min(text.length * 4, 64_000_000)) throw new ScanLimit();
      if (quoted && text[j] === "\\") { j++; continue; }
      if (text[j] === '"') { quoted = !quoted; continue; }
      if (!quoted && text.slice(j, j + 7).toLowerCase() === "</json>") { close = j; break; }
      if (!quoted && text.slice(j, j + 6).toLowerCase() === "<json>") break;
    }
    if (close < 0) continue;
    try { JSON.parse(text.slice(i + 6, close)); } catch { continue; }
    chunks.push(text.slice(start, i), "[literal JSON data]"); start = close + 7; i = start - 1;
  }
  return chunks.join("") + text.slice(start);
}
export function includedHistory(messages: ChatMessageDTO[], metadata: Record<string, unknown>, clipping?: ContextClipStatsDTO): ChatMessageDTO[] {
  let visible = messages.filter(message => message.extra?.hidden !== true);
  if (clipping?.anchorActive) {
    const index = visible.findIndex(message => message.id === metadata.context_history_anchor_message_id);
    if (index >= 0) visible = visible.slice(index);
  } else if (clipping?.enabled && !clipping.budgetInvalid && clipping.messagesDropped) visible = visible.slice(clipping.messagesDropped);
  return visible;
}
