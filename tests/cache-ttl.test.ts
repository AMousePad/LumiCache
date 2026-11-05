import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { ttlFinding, ttlParameters, ttlRoute } from "../src/cache-ttl";
import type { Finding } from "../src/health/types";
import { validateSettings } from "../src/settings";
import { renderFindings } from "../src/ui/findings";

const settings = (patch = {}) => validateSettings({ mode: "warn", ...patch });
const connection = (provider: string, metadata: Record<string, unknown> = {}, api_url = "") => ({ provider, name: "Main", metadata, api_url });
const kind = (provider: string, model: string, endpointOrigin?: string) => ttlRoute({ provider, model, endpointOrigin }).kind;

describe("routes", () => {
  test("LumiCache sets Kimi K3 on Moonshot, by provider or endpoint", () => {
    expect(ttlParameters({ provider: "moonshot", model: "kimi-k3" }, settings())).toEqual({ prompt_cache_options: { mode: "implicit", ttl: "1h" } });
    expect(kind("moonshot", "kimi-k3.1-pro")).toBe("lumicache");
    expect(kind("custom", "kimi-k3", "https://api.moonshot.ai")).toBe("lumicache");
    expect(kind("custom", "kimi-k3", "https://api.kimi.ai/v1")).toBe("lumicache");
    expect(kind("moonshot", "kimi-k2-0905")).toBe("fixed");
    expect(kind("moonshot", "kimi-k30")).toBe("fixed");
    expect(kind("custom", "kimi-k3", "https://notmoonshot.ai")).toBe("unknown");
  });
  test("LumiCache sets the OpenAI models listed for 24 hour retention", () => {
    expect(ttlParameters({ provider: "openai", model: "gpt-5.1" }, settings())).toEqual({ prompt_cache_retention: "24h" });
    for (const model of ["gpt-4.1", "gpt-4.1-2025-04-14", "gpt-5", "gpt-5-codex", "gpt-5.1-codex-max", "gpt-5.2", "gpt-5.4", "gpt-5.5-pro"]) expect(kind("openai", model)).toBe("lumicache");
    for (const model of ["gpt-4.1-mini", "gpt-5-mini", "gpt-5.6", "gpt-4o"]) expect(kind("openai", model)).toBe("fixed");
    expect(kind("custom", "gpt-5.1", "https://api.openai.com")).toBe("lumicache");
  });
  test("turning the setting off sends nothing", () => {
    expect(ttlParameters({ provider: "moonshot", model: "kimi-k3" }, settings({ cacheTtl: false }))).toBeUndefined();
    expect(ttlParameters({ provider: "deepseek", model: "deepseek-chat" }, settings())).toBeUndefined();
  });
  test("connection-set, fixed and unknown providers", () => {
    expect(kind("anthropic", "claude-opus")).toBe("connection");
    expect(kind("nanogpt", "anthropic/claude-sonnet")).toBe("connection");
    expect(kind("nanogpt", "deepseek-v4")).toBe("fixed");
    for (const provider of ["deepseek", "google", "xai", "zai", "mistral", "groq", "fireworks"]) expect(kind(provider, "model")).toBe("fixed");
    expect(kind("custom", "deepseek-chat", "https://api.deepseek.com")).toBe("fixed");
    for (const provider of ["openrouter", "chutes", "bedrock", "custom"]) expect(kind(provider, "model")).toBe("unknown");
  });
});

describe("Health item", () => {
  test("Anthropic and NanoGPT Claude at 5 minutes are issues", () => {
    for (const caching of [true, { type: "ephemeral" }, { ttl: "5m" }]) expect(ttlFinding(connection("anthropic", { prompt_caching: caching }), "claude", settings())).toMatchObject({ level: "issue", pinned: true, item: "Main" });
    expect(ttlFinding(connection("anthropic", { prompt_caching: { ttl: "1h" } }), "claude", settings())).toBeNull();
    expect(ttlFinding(connection("anthropic"), "claude", settings())).toBeNull();
    expect(ttlFinding(connection("nanogpt"), "claude-sonnet", settings())?.suggestion).toContain("turn on caching");
    expect(ttlFinding(connection("nanogpt", { nanogpt_caching: { enabled: true, ttl: "1h" } }), "claude-sonnet", settings())).toBeNull();
  });
  test("Keep Cache Warm under 5 minutes covers a 5 minute connection, and a longer interval doesn't", () => {
    const anthropic = connection("anthropic", { prompt_caching: true });
    expect(ttlFinding(anthropic, "claude", settings({ autoRefreshEnabled: true, autoRefreshMinutes: 4 }))).toBeNull();
    expect(ttlFinding(anthropic, "claude", settings({ autoRefreshEnabled: true, autoRefreshMinutes: 10 }))?.level).toBe("issue");
  });
  test("other providers get a risk unless LumiCache sets the lifetime", () => {
    expect(ttlFinding(connection("moonshot"), "kimi-k3", settings())).toBeNull();
    expect(ttlFinding(connection("moonshot"), "kimi-k3", settings({ cacheTtl: false }))).toMatchObject({ level: "risk", title: "LumiCache isn't setting your cache lifetime" });
    expect(ttlFinding(connection("moonshot"), "kimi-k3", settings({ cacheTtl: false }))?.suggestion).toBe("Turn this on in the LumiCache settings.");
    expect(ttlFinding(connection("google"), "gemini-3-pro", settings())).toMatchObject({ level: "risk", title: "Cache may expire between replies" });
    expect(ttlFinding(connection("google"), "gemini-3-pro", settings())?.suggestion).toContain("If you want to prevent cache timeouts for Google Gemini");
    expect(ttlFinding(connection("openrouter"), "any", settings())).toMatchObject({ level: "risk", title: "Check your cache lifetime" });
    expect(ttlFinding(connection("openrouter"), "any", settings())?.suggestion).toContain("custom request body");
  });
  test("a provider that keeps its cache for hours needs no warning", () => {
    expect(ttlFinding(connection("deepseek"), "deepseek-chat", settings())).toBeNull();
    expect(ttlFinding(connection("custom", {}, "https://api.deepseek.com"), "deepseek-chat", settings())).toBeNull();
  });
  test("Keep Cache Warm clears the unknown and setting-off risks", () => {
    for (const [provider, model] of [["openrouter", "x"], ["moonshot", "kimi-k3"]] as const)
      expect(ttlFinding(connection(provider), model, settings({ autoRefreshEnabled: true, cacheTtl: false }))).toBeNull();
  });
  test("a known short lifetime stays flagged, and asks for an interval under it", () => {
    const warm = ttlFinding(connection("google"), "gemini-4-argon", settings({ autoRefreshEnabled: true, autoRefreshMinutes: 10 }))!;
    expect(warm.detail).toContain("Reported lifetime: about 15–20 minutes for Gemini 4 Argon");
    expect(warm.suggestion).toBe("Keep Cache Warm is on and warming every 10 minutes. PS: Ensure your provider and model's cache lifetime is over 10 minutes to have this work properly. You can usually find this information on Google.");
    const cold = ttlFinding(connection("google"), "gemini-2.5-flash", settings())!;
    expect(cold.detail).toContain("about 3–5 minutes on average");
    expect(cold.suggestion).toBe("If you want to prevent cache timeouts for Google Gemini, turn on Keep Cache Warm in LumiCache settings. Find your provider and model's cache lifetime on Google and set the Keep Cache Warm interval below it.");
    expect(ttlFinding(connection("openai"), "gpt-5.6", settings())?.detail).toContain("Reported lifetime: 30 minutes.");
    expect(ttlFinding(connection("xai"), "grok", settings())?.detail).not.toContain("Reported lifetime");
  });
  test("the setting defaults on and is validated", () => {
    expect(settings().cacheTtl).toBe(true);
    expect(settings({ cacheTtl: false }).cacheTtl).toBe(false);
    expect(() => settings({ cacheTtl: "yes" })).toThrow();
  });
});

describe("pinned findings", () => {
  const window = new Window(), saved = globalThis.document;
  beforeAll(() => { globalThis.document = window.document as unknown as Document; });
  afterAll(() => { globalThis.document = saved; window.happyDOM.abort(); });
  test("render open above every category, and only there", () => {
    const pinned = ttlFinding(connection("google"), "gemini-3-pro", settings())!;
    const other: Finding = { category: "Preset", id: "x", level: "issue", title: "Other", source: "Preset", item: "Block", detail: "d", suggestion: "s" };
    const root = renderFindings([other, pinned], new Set());
    expect(root.firstElementChild?.className).toBe("lc-pinned lc-pinned-risk");
    expect(root.firstElementChild?.textContent).toContain("Cache may expire between replies");
    expect(root.querySelectorAll(".lc-pinned")).toHaveLength(1);
    expect([...root.querySelectorAll(".lc-group-name")].map(node => node.textContent)).toEqual(["Preset"]);
  });
});
