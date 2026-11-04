import type { SpindleAPI } from "lumiverse-spindle-types";
import type { Finding } from "./types";

export const LUMIBOOKS_URL = "https://github.com/AMousePad/LumiBooks";
const OVERFLOW = "Your context will eventually overflow without a method of cache friendly memory management, obliterating your cachability.";
const BASE = { level: "risk", category: "Context", source: "Context", item: "History overflow" } as const;
const MISSING: Finding = { ...BASE, id: "lumibooks-missing", title: "LumiBooks is not running",
  detail: `${OVERFLOW} LumiBooks is recommended to prevent that!`, suggestion: "Install and enable LumiBooks, then turn on its Cache Friendly mode.", link: { label: "Find it here.", url: LUMIBOOKS_URL } };
const OFF: Finding = { ...BASE, id: "lumibooks-cache-friendly-off", title: "LumiBooks Cache Friendly mode is off",
  detail: `${OVERFLOW} LumiBooks is running, but its Cache Friendly mode is off.`, suggestion: "Turn on Cache Friendly mode in LumiBooks." };
const UNCONFIRMED: Finding = { ...BASE, id: "lumibooks-mode-unknown", title: "Cannot confirm LumiBooks Cache Friendly mode",
  detail: `${OVERFLOW} LumiBooks is running, but it did not report whether Cache Friendly mode is on.`, suggestion: "Update LumiBooks and open it once, then make sure Cache Friendly mode is on.", link: { label: "Get the latest version.", url: LUMIBOOKS_URL } };
type Read = { state: "value"; value: { cacheFriendly?: unknown } | null } | { state: "missing" | "unknown" };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Warns only on evidence. A host error says nothing about LumiBooks, so it stays quiet. */
export async function memoryFinding(api: Pick<SpindleAPI, "rpcPool">, user: string, settleMs = 1500): Promise<Finding[]> {
  const read = async (endpoint: string): Promise<Read> => {
    try { return { state: "value", value: await api.rpcPool.read(endpoint) }; }
    catch (error) { return { state: /not registered/i.test(String((error as Error)?.message ?? error)) ? "missing" : "unknown" }; }
  };
  const mode = `lumi_books.cache_mode.${user}`;
  let result = await read(mode);
  if (result.state === "missing") {
    // A disabled or absent extension has no endpoints. LumiCache cannot tell those two apart.
    if ((await read("lumi_books.phoneline")).state === "missing") return [structuredClone(MISSING)];
    // LumiBooks publishes its mode once this user's settings load, which can trail a restart.
    await wait(settleMs); result = await read(mode);
    if (result.state === "missing") return [structuredClone(UNCONFIRMED)];
  }
  if (result.state !== "value") return [];
  return result.value?.cacheFriendly === true ? [] : [structuredClone(OFF)];
}
