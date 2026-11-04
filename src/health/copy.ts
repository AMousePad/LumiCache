import { PAST_TURNS } from "./scenarios";
import type { SimulationTicket } from "./types";

interface ExportMessage { id: string; is_user: boolean; name: string; content: string; send_date?: number; swipes?: string[]; swipe_id?: number; swipe_dates?: number[]; extra?: Record<string, unknown> }
export interface ChatExport { chat: { id: string; character_id: string | null; metadata: Record<string, unknown> }; messages: ExportMessage[] }
export function simulationCopy(source: ChatExport, ticket: SimulationTicket) {
  if (source.chat.id !== ticket.sourceChatId || source.messages.at(-1)?.id !== ticket.lastMessageId) throw new Error("The source chat changed during simulation setup. Retry with the latest history.");
  if (!source.chat.character_id) throw new Error("Simulation currently requires a character chat. Cache health checks also work for temporary chats.");
  const metadata = structuredClone(source.chat.metadata);
  const anchorIndex = source.messages.findIndex(message => message.id === metadata.context_history_anchor_message_id);
  for (const key of ["_swipe_variable_state", "branched_from", "branch_at_message", "another_one_applied_variables", "another_one_fork", "context_history_anchor_message_id"]) delete metadata[key];
  metadata.lumicache_simulation = ticket.id;
  metadata.lumicache_simulation_source = ticket.sourceChatId;
  metadata.lumicache_simulation_anchor = anchorIndex;
  let omittedAudio = 0;
  const messages = source.messages.map(message => {
    const extra = structuredClone(message.extra ?? {}); delete extra.variableStateBySwipe;
    // Native chat deletion treats audio as message-owned, unlike shared images/videos.
    if (Array.isArray(extra.attachments)) extra.attachments = extra.attachments.filter(attachment => {
      if (attachment && typeof attachment === "object" && attachment.type === "audio") { omittedAudio++; return false; }
      return true;
    });
    return { is_user: message.is_user, name: message.name, content: message.content, send_date: message.send_date,
      swipes: message.swipes, swipe_id: message.swipe_id, swipe_dates: message.swipe_dates, extra };
  });
  metadata.lumicache_omitted_audio = omittedAudio;
  return { character_id: source.chat.character_id, chat: { name: ticket.branchName, metadata }, messages };
}

export function historicalCutoffs(messages: Array<{ is_user: boolean; content: string }>): number[] {
  const candidates = messages.flatMap((message, index) => index > 0 && !message.is_user && message.content && messages[index - 1].is_user ? [index] : []);
  return candidates.slice(-(PAST_TURNS + 1));
}
