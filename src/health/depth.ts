import type { LlmMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { validateSettings } from "../settings";
import type { Settings } from "../shared";
import type { HealthReport } from "./types";
export async function classifyDepth(report: HealthReport, settings: Settings, messages: LlmMessageDTO[], api?: Pick<SpindleAPI,"tokens">, userId?: string) {
  const policy = validateSettings(settings);
  const history = messages.filter(m => m.__isChatHistory || (m as unknown as Record<string,unknown>).__chatHistorySource === true);
  const counts = new Map<number, { total_tokens: number; approximate: boolean }>();
  for (const finding of report.findings) {
    if (finding.level !== "depth") continue;
    const depth = finding.depth ?? 0;
    finding.problematic = policy.acceptableDepth !== null && depth > policy.acceptableDepth;
    if (policy.acceptableTokens !== null) {
      if (!counts.has(depth) && (history.length || depth === 0) && api) {
        const value = depth === 0 ? { total_tokens: 0, approximate: false } : await api.tokens.countMessages(history.slice(-depth), { model: report.model, userId });
        counts.set(depth,value);
      }
      const result = counts.get(depth);
      if (result) { finding.depthTokens = result.total_tokens; finding.tokenEstimate = result.approximate; }
      finding.problematic ||= !result || result.total_tokens > policy.acceptableTokens;
      finding.detail = result ? `${depth} history messages · ${result.approximate ? "approximately " : ""}${result.total_tokens.toLocaleString()} tokens behind this position.` : "The host did not expose enough history placement data to verify this token limit.";
    }
    finding.suggestion = finding.problematic ? "Outside your allowed tail. Force consistency can move it to the end or the allowed boundary."
      : "Within your configured tolerance. This is not a guarantee of a provider cache hit.";
  }
  return report;
}
