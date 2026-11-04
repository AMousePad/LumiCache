import { DEFAULT_SETTINGS, type Settings } from "./shared";
export function validateSettings(value: unknown): Required<Settings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid cache settings.");
  const v = value as Record<string, unknown>;
  const result = { ...DEFAULT_SETTINGS, ...v } as Required<Settings>;
  if (!["pause", "warn", "off"].includes(result.mode)) throw new Error("Choose Pause, Warn or Off for LumiCache.");
  for (const [key, max] of [["acceptableDepth", 100_000], ["acceptableTokens", 2_000_000], ["refreshEvery", 100_000], ["autoRefreshMinutes", 1440], ["autoRefreshLimit", 1000]] as const) {
    const n = result[key];
    const required = key !== "acceptableDepth" && key !== "acceptableTokens";
    if (!required && n === null) continue;
    if (typeof n !== "number" || !Number.isInteger(n) || n < (required ? 1 : 0) || n > max) throw new Error(`Invalid ${key}: enter a whole number${required ? " greater than zero" : " or leave the limit blank"}.`);
  }
  for (const key of ["forceConsistency", "refreshEnabled", "autoRefreshEnabled"] as const) if (typeof result[key] !== "boolean") throw new Error(`Invalid ${key}.`);
  if (!["end", "boundary"].includes(result.overflowPlacement)) throw new Error("Choose a valid injection destination.");
  if (!Array.isArray(result.hiddenCategories) || result.hiddenCategories.some(k => !["risk", "issue", "depth", "variabled"].includes(k))) throw new Error("Invalid category filters.");
  return { mode: result.mode, acceptableDepth: result.acceptableDepth, acceptableTokens: result.acceptableTokens,
    forceConsistency: result.forceConsistency, overflowPlacement: result.overflowPlacement,
    refreshEnabled: result.refreshEnabled, refreshEvery: result.refreshEvery,
    autoRefreshEnabled: result.autoRefreshEnabled, autoRefreshMinutes: result.autoRefreshMinutes, autoRefreshLimit: result.autoRefreshLimit, hiddenCategories: [...new Set(result.hiddenCategories)] };
}
