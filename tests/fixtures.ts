import type { InterceptorContextDTO, LlmMessageDTO } from "lumiverse-spindle-types";
export function context(overrides: Partial<InterceptorContextDTO> = {}): InterceptorContextDTO {
  return { userId: "user", chatId: "chat", generationId: crypto.randomUUID(), generationType: "normal", frontendSessionId: "browser",
    isDryRun: false, presetId: "preset", presetMetadata: undefined, personaId: null, characterId: null, personaAddonStates: {},
    mainDispatch: { source: "main", descriptor: { connectionId: "connection", connectionName: "Main", provider: "custom", model: "model", endpointOrigin: "https://example.invalid", dispatchKind: "concrete", connectionDispatchRevision: "1" }, connectionDispatchRevision: "1", dispatchKind: "concrete" },
    prefillCarrier: { kind: "none" } as unknown as InterceptorContextDTO["prefillCarrier"],
    interceptorDeadlineAt: Date.now() + 300_000, boundWorkDeadlineAt: Date.now() + 300_000, signal: new AbortController().signal, ...overrides };
}
export const messages = (system = "Stable system\nKeep the same style."): LlmMessageDTO[] => [
  { role: "system", content: system }, { role: "user", content: "Hello." },
];
