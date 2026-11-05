import type { ConnectionProfileDTO } from "lumiverse-spindle-types";
import type { Finding } from "./health/types";
import type { Settings } from "./shared";

export interface Route { provider: string; model: string; endpointOrigin?: string }
/**
 * lumicache: a request parameter LumiCache can add. connection: Lumiverse sets it from the connection.
 * fixed: a known provider with no lifetime setting. unknown: LumiCache can't tell.
 */
export type TtlRoute =
  | { kind: "lumicache"; name: string; parameters: Record<string, unknown> }
  | { kind: "connection"; name: string }
  | { kind: "fixed"; name: string; long?: boolean; lifetime?: string }
  | { kind: "unknown" };

/** Listed in settings, so users know what turning it off affects. */
export const TTL_PROVIDERS = "Kimi K3 and K3.1 Pro on Moonshot (1 hour), and OpenAI GPT-4.1, GPT-5, GPT-5.1, GPT-5.2, GPT-5.4 and GPT-5.5 (24 hours)";

function host(url: string | undefined): string {
  try { return url ? new URL(url).hostname.toLowerCase() : ""; } catch { return ""; }
}
const on = (name: string, domains: string[]) => domains.some(domain => name === domain || name.endsWith(`.${domain}`));
// Moonshot fixes the TTL at the first write and renews it on each hit. It documents cache writes for these two models.
const MOONSHOT_TTL = /^kimi-k3(\.1-pro)?([.-]|$)/i;
// OpenAI lists these for 24h retention. GPT-5.6 and later use prompt_cache_options, whose longer value only works on the Responses API.
const OPENAI_TTL = /^(gpt-5\.5(-pro)?|gpt-5\.4|gpt-5\.2|gpt-5\.1(-codex(-max|-mini)?|-chat-latest)?|gpt-5(-codex)?|gpt-4\.1)(-\d{4}-\d{2}-\d{2})?$/i;
// Known providers whose cache lifetime can't be set per request. long: kept well past 30 minutes, so a pause won't lose it.
const FIXED: Record<string, { name: string; domains: string[]; long?: boolean }> = {
  deepseek: { name: "DeepSeek", domains: ["deepseek.com"], long: true }, google: { name: "Google Gemini", domains: ["generativelanguage.googleapis.com"] },
  xai: { name: "xAI", domains: ["x.ai"] }, zai: { name: "Z.ai", domains: ["z.ai", "bigmodel.cn"] }, mistral: { name: "Mistral", domains: ["mistral.ai"] },
  groq: { name: "Groq", domains: ["groq.com"] }, fireworks: { name: "Fireworks", domains: ["fireworks.ai"] },
};

/** Reported lifetimes, so people can pick a warming interval. Most are not official. */
function lifetime(provider: string, model: string): string | undefined {
  if (provider === "google") return /argon/i.test(model) ? "about 15–20 minutes for Gemini 4 Argon" : "about 3–5 minutes on average, but it varies";
  if (provider === "zai") return "5–30 minutes in one independent test";
  if (provider === "openai") return /^gpt-(5\.([6-9]|\d{2,})|[6-9])/i.test(model) ? "30 minutes" : "usually 5–10 minutes, sometimes up to an hour";
  return undefined;
}
export function ttlRoute(route: Route): TtlRoute {
  // Routers and Vertex prefix the model with its publisher.
  const where = host(route.endpointOrigin), model = route.model.split("/").pop() ?? "";
  const is = (provider: string, domains: string[]) => route.provider === provider || (route.provider === "custom" && on(where, domains));
  if (is("moonshot", ["moonshot.ai", "moonshot.cn", "kimi.ai", "kimi.com"]))
    return MOONSHOT_TTL.test(model) ? { kind: "lumicache", name: "Moonshot", parameters: { prompt_cache_options: { mode: "implicit", ttl: "1h" } } } : { kind: "fixed", name: "Moonshot" };
  if (is("openai", ["api.openai.com"]))
    return OPENAI_TTL.test(model) ? { kind: "lumicache", name: "OpenAI", parameters: { prompt_cache_retention: "24h" } } : { kind: "fixed", name: "OpenAI", lifetime: lifetime("openai", model) };
  if (route.provider === "anthropic") return { kind: "connection", name: "Anthropic" };
  // Vertex serves Gemini with the same implicit cache. Lumiverse sets no cache options for its Claude and open models.
  if (route.provider === "google_vertex") return /^gemini/i.test(model) ? { kind: "fixed", name: "Google Vertex", lifetime: lifetime("google", model) } : { kind: "unknown" };
  if (route.provider === "nanogpt") return /claude/i.test(model) ? { kind: "connection", name: "NanoGPT" } : { kind: "fixed", name: "NanoGPT" };
  for (const [provider, known] of Object.entries(FIXED)) if (is(provider, known.domains)) return { kind: "fixed", name: known.name, long: known.long, lifetime: lifetime(provider, model) };
  return { kind: "unknown" };
}

/** What the interceptor adds to a request, if anything. */
export function ttlParameters(route: Route, settings: Pick<Settings, "cacheTtl">): Record<string, unknown> | undefined {
  const ttl = ttlRoute(route);
  return settings.cacheTtl !== false && ttl.kind === "lumicache" ? ttl.parameters : undefined;
}

const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const KEEP_WARM = "Keep Cache Warm in LumiCache settings";
/** Five minute connections stay flagged unless Keep Cache Warm runs often enough to cover them. */
export function ttlFinding(connection: Pick<ConnectionProfileDTO, "provider" | "name" | "metadata" | "api_url">, model: string, settings: Required<Settings>): Finding | null {
  const ttl = ttlRoute({ provider: connection.provider, model, endpointOrigin: connection.api_url });
  const finding = (level: "issue" | "risk", title: string, detail: string, suggestion: string): Finding =>
    ({ category: "Connection", id: "cache-ttl", level, pinned: true, title, source: "Connection", item: connection.name, detail, suggestion });
  if (ttl.kind === "connection") {
    if (settings.autoRefreshEnabled && settings.autoRefreshMinutes < 5) return null;
    const what = "This connection has only a 5 minute cache timeout. LumiCache can't change it because Lumiverse sets it from the connection.";
    const warm = `, or turn on ${KEEP_WARM} with an interval under 5 minutes.`;
    if (connection.provider === "anthropic") {
      const caching = connection.metadata?.prompt_caching, options = record(caching);
      // Caching off has its own issue.
      if ((caching !== true && !options) || options?.ttl === "1h") return null;
      return finding("issue", "!!! Cache lasts 5 minutes", what, `Open this connection's settings and set Prompt cache TTL to 1h${warm}`);
    }
    const options = record(connection.metadata?.nanogpt_caching);
    if (options?.enabled === true && options.ttl === "1h") return null;
    return finding("issue", "Cache lasts 5 minutes", what, `Open this connection's settings${options?.enabled === true ? "" : ", turn on caching,"} and set the cache TTL to 1h${warm}`);
  }
  if (ttl.kind === "fixed" && ttl.long) return null;
  // Warming is only as good as its interval, and only the user can look up their model's lifetime.
  if (ttl.kind === "fixed") {
    const every = settings.autoRefreshMinutes;
    return finding("risk", "Cache may expire between replies", `${ttl.name} controls the how long your cache is valid for. This provider disallows changes.${ttl.lifetime ? ` Reported lifetime: ${ttl.lifetime}.` : ""}.`,
      settings.autoRefreshEnabled ? `Keep Cache Warm is on and warming every ${every} minutes. PS: Ensure your provider and model's cache lifetime is over ${every} minutes to have this work properly. You can usually find this information on Google.`
        : `If you want to prevent cache timeouts for ${ttl.name}, turn on ${KEEP_WARM}. Find your provider and model's cache lifetime on Google and set the Keep Cache Warm interval below it.`);
  }
  if (settings.autoRefreshEnabled) return null;
  if (ttl.kind === "lumicache") {
    if (settings.cacheTtl) return null;
    return finding("risk", "LumiCache isn't setting your cache lifetime", `${ttl.name} can keep your cache longer if LumiCache asks, but Set long cache lifetime is off.`,
      "Turn this on in the LumiCache settings.");
  }
  return finding("risk", "Check your cache lifetime", "LumiCache doesn't know how this provider caches. Cache lifetime is how long a provider keeps the cache after your last request before deleting it. If it's too short, pauses between messages will invalidate your cache.",
    `If needed, set the cache lifetime high enough in your preset's custom request body, or turn on ${KEEP_WARM} if this is unsupported by your provider.`);
}
