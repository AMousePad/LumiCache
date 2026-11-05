import { describe, expect, test } from "bun:test";
import type { LlmMessageDTO, SavedBreakdownDTO } from "lumiverse-spindle-types";
import { Guard } from "../src/guard";
import { reportedUsage, sentUsage } from "../src/health/analyze";
import { validateSettings } from "../src/settings";
import { context } from "./fixtures";

const history = (id: number, content = `History ${id}`): LlmMessageDTO => ({ role: id % 2 ? "user" : "assistant", content, __isChatHistory: true, sourceMessageId: `h${id}`, sourceIndexInChat: id });
const prompt = (...ids: number[]): LlmMessageDTO[] => [{ role: "system", content: "Stable" }, ...ids.map(id => history(id))];

function setup(mode: "warn" | "pause" = "warn") {
  const toasts: { tone: string; title: string; message: string }[] = [];
  const guard = new Guard(() => {}, undefined, undefined, (_user, tone, title, message) => { toasts.push({ tone, title, message }); });
  const send = async (messages: LlmMessageDTO[], usage?: { read?: number; write?: number }, overrides = {}) => {
    const sent = context(overrides);
    await guard.inspect(messages, sent, validateSettings({ mode: "warn", acceptableDepth: 2 }));
    guard.finish(sent.userId, sent.generationId, true, undefined, usage);
  };
  return { guard, send, toasts, mode };
}

describe("cache miss toast", () => {
  test("stays quiet on the first reply and on hits", async () => {
    const { send, toasts } = setup();
    await send(prompt(1), { read: 0, write: 5000 });
    await send(prompt(1, 2), { read: 5000, write: 300 });
    await send(prompt(1, 2, 3), { read: 5300, write: 200 });
    expect(toasts).toEqual([]);
  });

  test("calls an unchanged prompt that missed an expiry", async () => {
    const { send, toasts } = setup();
    await send(prompt(1), { read: 0, write: 5000 });
    await send(prompt(1, 2), { read: 0, write: 5300 });
    expect(toasts).toEqual([{ tone: "warning", title: "Cache miss: 5,000 tokens", message: "The provider read 0 of 5,000 cached tokens. The prompt didn't change, so the cache likely expired." }]);
  });

  test("names the depth of a break that cost tokens", async () => {
    const { send, toasts } = setup();
    await send(prompt(1, 2, 3, 4), { read: 0, write: 8000 });
    await send([{ role: "system", content: "Changed" }, ...prompt(1, 2, 3, 4).slice(1)], { read: 0, write: 8000 });
    expect(toasts.at(-1)!.title).toBe("Cache miss: 8,000 tokens");
    expect(toasts.at(-1)!.message).toContain("The prompt changed at depth 5.");
  });

  test("blames a model change", async () => {
    const { send, toasts } = setup();
    await send(prompt(1), { read: 0, write: 5000 });
    const descriptor = { connectionId: "connection", connectionName: "Main", provider: "custom", model: "other", endpointOrigin: "https://example.invalid", dispatchKind: "concrete", connectionDispatchRevision: "1" };
    await send(prompt(1, 2), { read: 0, write: 5000 }, { mainDispatch: { source: "main", descriptor, connectionDispatchRevision: "1", dispatchKind: "concrete" } });
    expect(toasts.at(-1)!.message).toContain("The model or connection changed.");
  });

  test("accepts a break inside the allowed tail", async () => {
    const { send, toasts } = setup();
    await send([...prompt(1, 2), { role: "system", content: "Injected" }, history(3)], { read: 0, write: 5000 });
    await send(prompt(1, 2, 3), { read: 3000, write: 2000 });
    expect(toasts).toEqual([]);
  });

  test("ignores small drops, and needs usage on both replies", async () => {
    const { send, toasts } = setup();
    await send(prompt(1), { read: 0, write: 100_000 });
    await send(prompt(1, 2), { read: 96_000, write: 4000 });
    await send(prompt(1, 2, 3));
    await send(prompt(1, 2, 3, 4), { read: 0, write: 100_000 });
    expect(toasts).toEqual([]);
  });

  test("a failed send leaves the expected count alone", async () => {
    const { guard, send, toasts } = setup();
    await send(prompt(1), { read: 0, write: 5000 });
    const failed = context();
    await guard.inspect(prompt(1, 2), failed, validateSettings({ mode: "warn", acceptableDepth: 2 }));
    guard.finish(failed.userId, failed.generationId, false);
    await send(prompt(1, 2), { read: 0, write: 5000 });
    expect(toasts.at(-1)!.title).toBe("Cache miss: 5,000 tokens");
  });
});

describe("provider usage shapes", () => {
  const saved = (provider_raw: Record<string, unknown>) => ({ usage: { provider_raw }, model: "model" }) as unknown as SavedBreakdownDTO;
  // Shapes come from each provider's docs. None have been checked against a live response.
  const shapes: [string, Record<string, unknown>, number][] = [
    ["Anthropic", { input_tokens: 10, cache_read_input_tokens: 800, cache_creation_input_tokens: 5 }, 800],
    ["OpenAI Chat Completions, xAI, Groq, Mistral, Z.ai", { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 800 } }, 800],
    ["OpenAI Responses", { input_tokens: 1000, input_tokens_details: { cached_tokens: 800 } }, 800],
    ["Gemini and Vertex", { promptTokenCount: 1000, cachedContentTokenCount: 800 }, 800],
    ["DeepSeek", { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200 }, 800],
    ["Moonshot's flat field", { prompt_tokens: 1000, cached_tokens: 800 }, 800],
    ["A router with a zero beside the real count", { prompt_tokens: 1000, prompt_tokens_details: { cached_tokens: 0 }, cache_read_input_tokens: 800 }, 800],
  ];
  for (const [name, raw, read] of shapes) test(name, () => { expect(reportedUsage(saved(raw), "")?.read).toBe(read); });

  test("a prompt size with no count is unknown to Health and Keep Cache Warm, and zero after a send", () => {
    for (const raw of [{ prompt_tokens: 1000 }, { input_tokens: 1000 }, { promptTokenCount: 1000 }]) {
      expect(reportedUsage(saved(raw), "")).toBeUndefined();
      expect(sentUsage({ provider_raw: raw })).toEqual({ read: 0 });
    }
  });
  test("no usage, or a host that drops it, stays unknown", () => {
    expect(sentUsage(undefined)).toBeUndefined();
    expect(sentUsage({ prompt_tokens: 1000 })).toBeUndefined();
    expect(sentUsage({ provider_raw: { groundingMetadata: {} } })).toBeUndefined();
  });
  test("a provider that omits the count on a miss still gets the toast", async () => {
    const { send, toasts } = setup();
    await send(prompt(1), sentUsage({ provider_raw: { prompt_tokens: 5000, prompt_tokens_details: { cached_tokens: 4096 } } }));
    await send(prompt(1, 2), sentUsage({ provider_raw: { prompt_tokens: 5300 } }));
    expect(toasts.at(-1)!.title).toBe("Cache miss: 4,096 tokens");
  });
  test("a provider that never reports a count stays quiet", async () => {
    const { send, toasts } = setup();
    await send(prompt(1), sentUsage({ provider_raw: { prompt_tokens: 5000 } }));
    await send(prompt(1, 2), sentUsage({ provider_raw: { prompt_tokens: 5300 } }));
    expect(toasts).toEqual([]);
  });
});
