import type { LlmMessageDTO } from "lumiverse-spindle-types";
import { createHash } from "node:crypto";
import type { Comparison, InspectionContext, PromptMessage, Snapshot } from "./shared";

export const MAX_PROMPT_CHARACTERS = 32_000_000;
/** The label LumiBooks puts on its injected summaries, or undefined for any other message. */
export function lumibooksSummary(message: LlmMessageDTO): string | undefined {
  const tag = (message as { __lumibooksSummary?: unknown }).__lumibooksSummary;
  return typeof tag === "string" ? tag : undefined;
}
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return part;
    return Object.fromEntries(Object.keys(part).sort().map(key => [key, part[key]]));
  });
}

function fingerprint(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `[sha256:${createHash("sha256").update(value).digest("hex")} · ${value.length} characters]`;
}
function inspectPart(value: object): unknown {
  const part = { ...value } as Record<string, unknown>;
  delete part.cache_control;
  if (["image", "audio", "video"].includes(String(part.type)) && typeof part.data === "string") part.data = fingerprint(part.data);
  if (typeof part.thought_signature === "string") part.thought_signature = fingerprint(part.thought_signature);
  return part;
}

function commonPrefix(a: string, b: string): number {
  const end = Math.min(a.length, b.length);
  let i = 0;
  while (i < end && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

export function snapshot(messages: LlmMessageDTO[], context: InspectionContext): Snapshot {
  const route = context.mainDispatch.descriptor;
  const normalized: PromptMessage[] = [];
  let size = 0;
  for (const message of messages) {
    // Only provider-facing fields participate; source IDs and placement metadata change independently of the prompt.
    const wire = message as LlmMessageDTO & { thought_signature?: string };
    const header = stableJson({ role: message.role, name: message.name, contentKind: typeof message.content === "string" ? "text" : "parts",
      thought_signature: fingerprint(wire.thought_signature), reasoning_content: message.reasoning_content,
      thinking_blocks: message.thinking_blocks?.map(block => ({ ...block, data: fingerprint(block.data), signature: fingerprint(block.signature) })),
      reasoning_details: message.reasoning_details });
    const body = typeof message.content === "string" ? message.content : stableJson(message.content.map(inspectPart));
    size += header.length + body.length;
    if (size > MAX_PROMPT_CHARACTERS) throw new Error("LumiCache cannot inspect prompts larger than 32 million characters. Turn monitoring off in LumiCache to send this request.");
    normalized.push({ role: message.role, header, body });
  }
  // Lumiverse's depth: how many chat messages follow. The leading prefix sits above all history, so it has none.
  const history = (m: LlmMessageDTO) => m.__isChatHistory === true || (m as { __chatHistorySource?: boolean }).__chatHistorySource === true;
  // A LumiBooks summary stands in for the chat it covers, so history starts there too. Older LumiBooks has no tag, and its summaries stay prefix.
  const first = messages.findIndex(m => history(m) || lumibooksSummary(m) !== undefined);
  for (let index = messages.length - 1, depth = 0; first >= 0 && index >= first; index--) {
    normalized[index].depth = depth;
    if (history(messages[index])) depth++;
  }
  return { at: Date.now(), model: route?.model ?? "Unresolved connection", route: stableJson(route ? {
    connectionId: route.connectionId, provider: route.provider, model: route.model, endpointOrigin: route.endpointOrigin,
    revision: route.connectionDispatchRevision,
  } : { dispatchKind: context.mainDispatch.dispatchKind, revision: context.mainDispatch.connectionDispatchRevision }), messages: normalized };
}

export function compare(before: Snapshot | null, after: Snapshot): Comparison {
  const result: Comparison = { kind: "first", routeChanged: false, firstMessage: null, commonMessages: 0,
    commonCharacters: 0, previousCharacters: before?.messages.reduce((n, m) => n + m.body.length, 0) ?? 0,
    summary: "First request. A baseline will be kept after generation completes successfully." };
  if (!before) return result;
  result.routeChanged = before.route !== after.route;
  let extended = false;
  for (let index = 0; index < before.messages.length; index++) {
    const old = before.messages[index], next = after.messages[index];
    if (!next || old.header !== next.header) { result.firstMessage = index; break; }
    const prefix = commonPrefix(old.body, next.body);
    result.commonCharacters += prefix;
    if (old.body === next.body) { result.commonMessages++; continue; }
    // A growing final message preserves its old prefix (e.g. assistant prefill / Continue).
    if (index === before.messages.length - 1 && prefix === old.body.length) { extended = true; break; }
    result.firstMessage = index; break;
  }
  if (result.routeChanged || result.firstMessage !== null) {
    result.kind = "break";
    result.summary = result.routeChanged ? "The connection, model or connection configuration changed."
      : `The previous prompt prefix changes at message ${result.firstMessage! + 1} (${before.messages[result.firstMessage!].role}).`;
  } else {
    result.kind = extended || after.messages.length > before.messages.length ? "append" : "same";
    result.summary = result.kind === "append" ? "The previous prompt prefix is unchanged; new content follows it." : "The assembled prompt is unchanged.";
  }
  return result;
}
