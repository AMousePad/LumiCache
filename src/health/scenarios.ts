import type { LlmMessageDTO } from "lumiverse-spindle-types";
import type { SimulationScenario } from "./types";

export function seededRandom(seed: string): () => number {
  let value = 2166136261;
  for (const ch of seed) value = Math.imul(value ^ ch.charCodeAt(0), 16777619);
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296; };
}
export const PAST_TURNS = 5;
/** Both future tests compare against the prompt that produced the latest reply, since that is what the provider cached. */
export function scenarios(seed: string, endsWithUser: boolean): { scenarios: [SimulationScenario, SimulationScenario, SimulationScenario] } {
  const random = seededRandom(seed);
  const words = ["lantern", "harbour", "garden", "compass", "rain", "window", "bridge", "letter"];
  const word = () => words[Math.floor(random() * words.length)];
  const user: LlmMessageDTO = { role: "user", content: `I found a ${word()} near the ${word()}. What happens next? [Cache simulation]` };
  // A chat waiting on a reply needs one first, or the new message would be two user turns in a row.
  const newTurn: LlmMessageDTO[] = endsWithUser ? [{ role: "assistant", content: "The scene continues. This is a synthetic reply for the cache simulation." }, user] : [user];
  return {
    scenarios: [
      { name: "Reference", purpose: "The prompt that produced your latest reply. Future Turns compare against this.", messages: [] },
      { name: "Regenerate", purpose: "Regenerates your latest reply. The prompt should match exactly.", messages: [] },
      { name: "New turn", purpose: "Sends a new message right after your latest reply. Most/all of your prompt should be the same, with only the latest few turns changing.", messages: newTurn },
    ],
  };
}
