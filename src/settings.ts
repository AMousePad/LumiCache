import { DEFAULT_SETTINGS, type Settings } from "./shared";
export interface SettingsStorage {
  getJson<T>(path: string, options: { fallback: T; userId: string }): Promise<T>;
  setJson(path: string, value: unknown, options: { userId: string }): Promise<void>;
}
const FILE = "settings.json";
/** Every write carries this, so a depth of 5 in a marked file is one the user chose. It lives in the same file so that the cleared value and the marker land together. */
const SETTINGS_VERSION = 1;
export function saveSettings(storage: SettingsStorage, user: string, settings: Required<Settings>): Promise<void> {
  return storage.setJson(FILE, { ...settings, settingsVersion: SETTINGS_VERSION }, { userId: user });
}
export async function loadSettings(storage: SettingsStorage, user: string): Promise<Required<Settings>> {
  const saved = await storage.getJson<Record<string, unknown> | null>(FILE, { fallback: null, userId: user });
  if (!saved) return validateSettings(DEFAULT_SETTINGS);
  if (saved.settingsVersion) return validateSettings(saved);
  // Saving used to write the old default of 5 for everyone, so a 5 from before the marker is cleared this one time.
  const migrated = validateSettings(saved.acceptableDepth === 5 ? { ...saved, acceptableDepth: null } : saved);
  // A failed write retries on the next load. The next save marks the file anyway.
  try { await saveSettings(storage, user, migrated); }
  catch (error) { console.warn("[LumiCache] Could not save migrated settings:", error); }
  return migrated;
}
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
