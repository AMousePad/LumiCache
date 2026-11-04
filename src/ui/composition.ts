import { compositionSnapshot } from "../health/composition";
import type { CompositionSnapshot } from "../health/types";
import { nativeAPI, type NativeAPI } from "./simulation";
export async function readComposition(api: NativeAPI = nativeAPI): Promise<CompositionSnapshot> {
  const keys = ["sovereignHand", "contextFilters", "selectedLoomStyles", "selectedLoomUtils", "selectedLoomRetrofits"];
  try {
    const settings = await Promise.all(keys.map(key => api(`settings/${key}`, "GET", undefined, true).then(value => value?.value)));
    const selections: NonNullable<CompositionSnapshot["selections"]> = [];
    for (const [index, kind] of (["style", "utility", "retrofit"] as const).entries()) for (const item of Array.isArray(settings[index + 2]) ? settings[index + 2] : []) {
      selections.push({ id: item.id, name: item.name, content: item.content, kind });
    }
    return compositionSnapshot({ available: true, sovereign: settings[0], filters: settings[1], selections });
  } catch { return { available: false }; }
}
