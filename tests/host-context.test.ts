import { expect, test } from "bun:test";
import type { ConnectionProfileDTO, SpindleAPI } from "lumiverse-spindle-types";
import { HostContexts, type HostContext } from "../src/host-context";
const connection = { id: "connection", name: "Main", model: "configured-model", provider: "custom", api_url: "https://secret:password@example.invalid/private?token=secret", updated_at: 1, is_default: true } as ConnectionProfileDTO;
const api = { connections: { get: async (_id: string, user: string) => { expect(user).toBe("user"); return connection; }, list: async () => [connection] } } as unknown as Pick<SpindleAPI, "connections">;
const raw = (): HostContext => ({ userId: "user", chatId: "chat", connectionId: "connection", dryRun: false, signal: new AbortController().signal });
test("current native context uses the generation event and redacted connection identity", async () => {
  const contexts = new HostContexts(); contexts.start("user", { generationId: "generation", chatId: "chat", model: "effective-model", frontendSessionId: "browser" });
  const resolved = await contexts.resolve(raw(), api);
  expect(resolved.generationId).toBe("generation"); expect(resolved.frontendSessionId).toBe("browser");
  expect(resolved.mainDispatch.descriptor?.model).toBe("effective-model");
  expect(resolved.mainDispatch.descriptor?.endpointOrigin).toBe("https://example.invalid");
  expect(JSON.stringify(resolved)).not.toContain("secret");
});
test("late events cannot clear a newer generation; absent and foreign events cannot create a baseline", async () => {
  const contexts = new HostContexts();
  await expect(contexts.resolve(raw(), api)).rejects.toThrow("could not match");
  contexts.start("other", { generationId: "foreign", chatId: "chat", model: "model" });
  await expect(contexts.resolve(raw(), api)).rejects.toThrow("could not match");
  contexts.start("user", { generationId: "new", chatId: "chat", model: "model" });
  contexts.finish("user", { generationId: "old", chatId: "chat" });
  expect((await contexts.resolve({ ...raw(), connectionId: undefined }, api)).generationId).toBe("new");
  contexts.finish("user", { generationId: "new", chatId: "chat" });
  await expect(contexts.resolve(raw(), api)).rejects.toThrow("could not match");
});
test("stopping during connection lookup cannot authorize the old request", async () => {
  const contexts = new HostContexts(); contexts.start("user", { generationId: "gen", chatId: "chat", model: "model" });
  const stopping = { connections: { get: async () => { contexts.finish("user", { generationId: "gen", chatId: "chat" }); return connection; } } } as unknown as Pick<SpindleAPI, "connections">;
  await expect(contexts.resolve(raw(), stopping)).rejects.toThrow("generation ended");
});
