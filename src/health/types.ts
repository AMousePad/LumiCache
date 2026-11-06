import type { ContextClipStatsDTO, LlmMessageDTO } from "lumiverse-spindle-types";
import type { Comparison, Snapshot } from "../shared";

export interface CompositionSnapshot {
  available: boolean; incomplete?: boolean;
  sovereign?: { enabled: boolean; excludeLastMessage: boolean; includeMessageInPrompt: boolean };
  filters?: Partial<Record<"htmlTags" | "detailsBlocks" | "loomItems", { enabled: boolean; keepDepth: number; keepOnly?: boolean; stripFonts?: boolean; fontKeepDepth?: number }>>;
  selections?: { id: string; name: string; kind: "style" | "utility" | "retrofit"; content: string }[];
}
export interface AuditInput { chatId: string; connectionId?: string; composition?: CompositionSnapshot }
export type FindingCategory = "World info" | "Preset" | "Compose" | "Regex" | "History" | "Character" | "Persona" | "Context" | "Connection" | "Simulation" | "Depth Mutable" | "Variabled";
export interface Finding {
  category?: FindingCategory;
  group?: string;
  groupId?: string;
  item?: string;
  itemId?: string;
  evidence?: string[];
  id: string;
  level: "risk" | "issue" | "observed" | "info" | "unknown" | "depth" | "variabled";
  depth?: number;
  depthTokens?: number;
  tokenEstimate?: boolean;
  problematic?: boolean;
  /** Shown open above every category. */
  pinned?: boolean;
  title: string;
  source: string;
  detail: string;
  suggestion: string;
  link?: { label: string; url: string };
}
export type TurnKind = "system" | "character" | "persona" | "world" | "story" | "injection" | "memory" | "extension" | "other";
export interface TurnPart { kind: TurnKind; label: string; start: number; end: number }
export interface OutlineTurn { role: string; kind: TurnKind; label: string; preview: string; characters: number; injected: boolean; chatIndex?: number; parts: TurnPart[] }
/** base: reference prompt. kept: stays cached. new: normal growth. rewritten: identical, but after the break. */
export type TurnStatus = "base" | "kept" | "new" | "rewritten" | "changed" | "added" | "removed";
export interface TimelineRow {
  oldIndex?: number; newIndex?: number; status: TurnStatus; root?: boolean; role: string; kind: TurnKind; label: string; preview: string;
  characters: number; injected: boolean; chatIndex?: number;
  /** depth: in the previous prompt, which the tail is measured on. nextDepth: where an added row lands. */
  depth?: number; nextDepth?: number; headerChanged: boolean; parts: { kind: TurnKind; label: string; share: number }[]; sources: string[];
}
export interface StepTimeline { rows: TimelineRow[]; kept: number; rewritten: number; added: number; problems: number; tolerated: boolean; routeChanged: boolean }
export interface CacheUsage { read?: number; write?: number; model: string; messageId: string }
export interface HealthReport {
  chatId: string; at: number; preset: string; model: string; provider: string;
  findings: Finding[]; entriesScanned: number; blocksScanned: number;
  clipping?: ContextClipStatsDTO; usage?: CacheUsage;
  findingsOmitted?: number;
}
export interface SimulationTicket { id: string; sourceChatId: string; lastMessageId: string; branchName: string }
export interface SimulationScenario { name: string; purpose: string; messages: LlmMessageDTO[] }
export interface SimulationStep {
  name: string; purpose: string; inputs: LlmMessageDTO[]; snapshot: Snapshot; comparison: Comparison;
  clipping?: ContextClipStatsDTO; changedSources: string[];
  timeline?: StepTimeline;
  historyThrough?: number;
  recordedPrompt?: Snapshot;
  recordedUsage?: CacheUsage;
}
export interface SimulationReport {
  sourceChatId: string; at: number; complete: boolean; error?: string; cleanupError?: string; scratchChatId?: string;
  health: HealthReport; steps: SimulationStep[]; history: SimulationStep[]; seed: string; limitations: string[];
}
