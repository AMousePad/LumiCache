import type { ActivePresetDTO, CharacterDTO, ChatDTO, ChatMessageDTO, ConnectionProfileDTO, PersonaDTO, RegexScriptDTO, SpindleAPI, UserPresetDTO, WorldBookEntryDTO } from "lumiverse-spindle-types";
import type { AuditInput, Finding } from "./types";

export interface LoreSource { bookId: string; bookName: string; scope: string; entry: WorldBookEntryDTO }
export interface Sources {
  input: AuditInput; chat: ChatDTO; character: CharacterDTO | null; persona: PersonaDTO | null;
  preset: UserPresetDTO | null; active: ActivePresetDTO; connection: ConnectionProfileDTO;
  lore: LoreSource[]; regex: RegexScriptDTO[]; notes: Finding[];
  messages?: ChatMessageDTO[];
}
export async function allPages<T>(read: (offset: number) => Promise<{ data: T[]; total: number }>): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await read(rows.length);
    if (!page || !Array.isArray(page.data) || !Number.isFinite(page.total)) throw new Error("The host returned an invalid audit page.");
    rows.push(...page.data);
    if (rows.length >= page.total) return rows;
    if (!page.data.length) throw new Error("The source list changed during the audit. Run the check again.");
    if (rows.length > 50_000) throw new Error("This audit exceeds 50,000 source entries. Narrow the attached lorebooks before retrying.");
  }
}
export async function collectSources(api: SpindleAPI, user: string, input: AuditInput): Promise<Sources> {
  const chat = await api.chats.get(input.chatId, user);
  if (!chat) throw new Error("This chat is no longer available.");
  const [active, persona, globalBooks, connection] = await Promise.all([
    api.presets.getActive(chat.id, user), api.personas.getActive(user), api.world_books.getGlobal(user),
    input.connectionId ? api.connections.get(input.connectionId, user) : api.connections.list(user).then(rows => rows.find(c => c.is_default) ?? null),
  ]);
  if (!connection) throw new Error("Select a connection before checking cache health.");
  const [character, preset] = await Promise.all([
    chat.character_id ? api.characters.get(chat.character_id, user) : null,
    active.preset_id ? api.presets.get(active.preset_id, user) : null,
  ]);
  if (active.preset_id && !preset) throw new Error("The active preset is no longer available.");
  const notes: Finding[] = [];
  const books = new Map<string, string>();
  const add = (ids: unknown, scope: string) => {
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === "string" && id && !books.has(id)) books.set(id, scope);
  };
  add(character?.world_book_ids, "Character");
  if (chat.metadata.group) {
    notes.push({ id: "group-scope", level: "unknown", title: "Group chat sources can change with the speaker", source: "Chat",
      detail: "The audit includes potential group-member lorebooks. The next speaker, muted members and card mode can change the actual set.", suggestion: "Check the Cache Diff when the focused character changes." });
    const ids = Array.isArray(chat.metadata.character_ids) ? chat.metadata.character_ids.filter((id): id is string => typeof id === "string") : [];
    for (const id of ids) if (id !== character?.id) add((await api.characters.get(id, user))?.world_book_ids, "Group member (potential)");
  }
  const effectivePersona = chat.metadata.temporary === true ? null : persona ?? await api.personas.getDefault(user);
  if (effectivePersona?.attached_world_book_id) add([effectivePersona.attached_world_book_id], "Persona");
  add(chat.metadata.chat_world_book_ids, "Chat"); add(globalBooks, "Global");
  const lore: LoreSource[] = [];
  let sourceCharacters = JSON.stringify({ character, preset, persona: effectivePersona }).length;
  if (sourceCharacters > 32_000_000) throw new Error("The active preset and character sources exceed the audit size limit.");
  for (const [id, scope] of books) {
    const book = await api.world_books.get(id, user);
    if (!book) { notes.push({ id: `missing-book-${id}`, level: "unknown", title: "An attached lorebook is unavailable", source: scope, detail: id, suggestion: "Check this chat's lorebook attachments." }); continue; }
    const entries = await allPages(offset => api.world_books.entries.list(id, { limit: 200, offset, userId: user }));
    if (!entries.length && book.metadata.source === "character") notes.push({ id: `embedded-book-${id}`, level: "unknown", title: "Embedded lore may need runtime inspection", source: book.name,
      detail: "This character-backed book exposes no native entries. Its embedded source was not statically audited.", suggestion: "Inspect the simulation and live prompt diffs." });
    for (const entry of entries) if (!entry.disabled) {
      sourceCharacters += JSON.stringify(entry).length;
      if (sourceCharacters > 32_000_000) throw new Error("The enabled audit sources exceed 32 million characters. Narrow the attached lorebooks before running this check.");
      lore.push({ bookId: id, bookName: book.name, scope, entry });
    }
  }
  const [regex, messages] = await Promise.all([api.regex_scripts.getActive({ target: "prompt", characterId: character?.id, chatId: chat.id, userId: user }), api.chat.getMessages(chat.id)]);
  // No size cap on history: long chats are normal, and the audit only scans the part that reaches the prompt, which the context limit bounds.
  return { input: { ...input, connectionId: connection.id }, chat, character, persona: effectivePersona, preset, active, connection, lore, regex, notes, messages };
}
