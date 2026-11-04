import assert from "node:assert/strict";
import { readComposition } from "../src/ui/composition";
import type { Operations } from "../src/shared";
type API = (path: string, method?: string, body?: unknown, allow404?: boolean) => Promise<any>;
export async function testDiagnosticsHost({ api, rpc, connectionId, providerCount, pass }: {
  api: API; rpc: <K extends keyof Operations>(operation: K, input: Operations[K]["input"]) => Promise<Operations[K]["output"]>;
  connectionId: string; providerCount(): number; pass(message: string): void;
}) {
  const original = await api("/api/v1/settings"), sent = providerCount();
  const character = await api("/api/v1/characters", "POST", { name: "Nested diagnostics", first_mes: "Hello." });
  const chat = await api("/api/v1/chats", "POST", { character_id: character.id, name: "Nested diagnostics" });
  const base = { enabled: true, role: "system", position: "pre_history", depth: 0, isLocked: false, color: null, injectionTrigger: [], group: null };
  const preset = await api("/api/v1/presets", "POST", { name: "Diagnostic sources", provider: "loom", prompt_order: [
    { ...base, id: "main", name: "Nested dice", content: "{{if::1}}{{upper::{{roll::20d1000000}}}}{{/if}}", marker: null },
    { ...base, id: "dead", name: "Inactive branch", content: "{{if::0}}{{roll::2d6}}{{/if}}", marker: null },
    { ...base, id: "compose", name: "Compose content", content: "{{loomStyle}}\n{{loomSovHand}}", marker: null },
    { ...base, id: "history", name: "History", content: "", marker: "chat_history" },
  ] });
  await api(`/api/v1/preset-profiles/chat/${chat.id}`, "PUT", { preset_id: preset.id, block_states: {} });
  const composition = () => readComposition((path, method, body, allow404) => api(`/api/v1/${path}`, method, body, allow404));
  const audit = async () => rpc("audit", { chatId: chat.id, connectionId, composition: await composition() });
  const build = () => api("/api/v1/generate/dry-run", "POST", { chat_id: chat.id, connection_id: connectionId, preset_id: preset.id, generation_type: "normal" });
  try {
    await api("/api/v1/settings", "PUT", { contextFilters: { detailsBlocks: { enabled: true, keepDepth: 2 } }, sovereignHand: { enabled: true, excludeLastMessage: true, includeMessageInPrompt: true },
      selectedLoomStyles: [{ id: "style", name: "Nested weather", content: "{{upper::{{roll::20d1000000}}}}", category: "narrative_style" }], selectedLoomUtils: [], selectedLoomRetrofits: [] });
    await api(`/api/v1/chats/${chat.id}/messages`, "POST", { is_user: true, name: "User", content: "Keep this. <details>Future secret.</details>" });
    let report = await audit();
    assert(report.findings.some(f => f.item === "Nested dice" && f.level === "issue")); assert(!report.findings.some(f => f.item === "Inactive branch"));
    assert(report.findings.some(f => f.category === "Compose" && f.group === "Sovereign Hand" && f.level === "issue"));
    assert(report.findings.some(f => f.category === "Compose" && f.item === "Nested weather" && f.level === "issue"));
    pass("native audits classify nested dice and reached Compose sources as Issues while suppressing an inactive branch");
    const first = await build();
    assert(first.messages.some((m: any) => typeof m.content === "string" && m.content.includes("Future secret.")));
    await api(`/api/v1/chats/${chat.id}/messages`, "POST", { is_user: false, name: "Assistant", content: "A stable answer." });
    await api(`/api/v1/chats/${chat.id}/messages`, "POST", { is_user: true, name: "User", content: "A new turn." });
    const next = await build(); assert(!next.messages.some((m: any) => typeof m.content === "string" && m.content.includes("Future secret.")));
    assert(report.findings.some(f => f.id === "compose-detailsBlocks" && f.level === "issue"));
    pass("Compose's moving details filter rewrites a previously included message as history grows");
    const history = await api(`/api/v1/chats/${chat.id}/messages`, "POST", { is_user: true, name: "User", content: "History dice: {{upper::{{roll::20d1000000}}}}" });
    report = await audit(); assert(report.findings.some(f => f.category === "History" && f.itemId === history.id && f.level === "issue"));
    const built = await build(); assert(built.messages.some((m: any) => typeof m.content === "string" && /History dice: \d+/.test(m.content)));
    pass("nested macros in saved chat history are both executed by the host and identified under their message");
    await api("/api/v1/regex-scripts", "POST", { name: "Nested replacement", target: ["prompt"], placement: ["ai_output"], scope: "chat", scope_id: chat.id, find_regex: "stable", replace_string: "{{upper::{{roll::20d1000000}}}}", substitute_macros: "none", disabled: false });
    await api("/api/v1/regex-scripts", "POST", { name: "Repeat operation", target: ["prompt"], placement: ["ai_output"], scope: "chat", scope_id: chat.id, find_regex: "answer", replace_string: "$&", metadata: { match_actions: ["repeat_back"] }, disabled: false });
    report = await audit();
    assert(report.findings.some(f => f.category === "Regex" && f.item === "Nested replacement" && f.level === "issue"));
    assert(report.findings.some(f => f.category === "Regex" && f.item === "Repeat operation" && f.level === "risk"));
    assert.equal(providerCount(), sent);
    pass("native regex replacement and repeat-operation findings distinguish Issues from Risks without making model requests");
  } finally {
    const restored: Record<string, unknown> = {};
    for (const key of ["contextFilters", "sovereignHand", "selectedLoomStyles", "selectedLoomUtils", "selectedLoomRetrofits"]) restored[key] = original[key] ?? (key.startsWith("selected") ? [] : {});
    await api("/api/v1/settings", "PUT", restored);
  }
  return { chatId: chat.id, presetId: preset.id };
}
