import type { StepTimeline } from "./health/types";
export type Mode = "pause" | "warn" | "off";
export type Classification = "risk" | "issue" | "depth" | "variabled";
export interface Settings {
  mode: Mode;
  acceptableDepth?: number | null;
  acceptableTokens?: number | null;
  forceConsistency?: boolean;
  overflowPlacement?: "end" | "boundary";
  refreshEnabled?: boolean;
  refreshEvery?: number;
  /** Replays the last prompt while a chat is idle. Each replay is billed, so it stays off until asked for. */
  autoRefreshEnabled?: boolean;
  autoRefreshMinutes?: number;
  autoRefreshLimit?: number;
  hiddenCategories?: Classification[];
}
export interface InspectionContext {
  userId: string; chatId: string; generationId: string; frontendSessionId?: string;
  isDryRun: boolean; signal: AbortSignal; interceptorDeadlineAt: number;
  mainDispatch: { descriptor: { connectionId: string; provider: string; model: string; endpointOrigin: string; connectionDispatchRevision: string | null } | null;
    dispatchKind: string | null; connectionDispatchRevision: string | null };
  /** Parallel senders in one chat keep separate baselines, one per scope. */
  scope?: string;
  label?: string;
}
export const DEFAULT_SETTINGS: Required<Settings> = { mode: "warn", acceptableDepth: 2, acceptableTokens: null,
  forceConsistency: false, overflowPlacement: "end", refreshEnabled: true, refreshEvery: 20, autoRefreshEnabled: false, autoRefreshMinutes: 10, autoRefreshLimit: 3, hiddenCategories: [] };
export interface PromptMessage { role: string; header: string; body: string }
export interface Snapshot {
  /** Frontend views carry a session-bound reference instead of message bodies. */
  reference?: string;
  messageCount?: number;
  at: number;
  route: string;
  model: string;
  messages: PromptMessage[];
}
export interface Comparison {
  kind: "first" | "same" | "append" | "break";
  routeChanged: boolean;
  firstMessage: number | null;
  commonMessages: number;
  commonCharacters: number;
  previousCharacters: number;
  summary: string;
}
export type CheckStatus = "waiting" | "allowed" | "completed" | "cancelled" | "failed";
export interface Check {
  id: string;
  chatId: string;
  generationId: string;
  deadline: number;
  status: CheckStatus;
  comparison: Comparison;
  before: Snapshot | null;
  after: Snapshot;
  timeline?: StepTimeline;
  policy?: { action: "tolerated" | "preserved" | "refresh" | "seed"; restored: number; relocated: number; replies: number; approximate: boolean; accepted?: boolean };
}
/** A running Keep Cache Warm job. nextIn is null while a refresh is being sent. */
export interface KeepWarmState { chatId: string; done: number; limit: number; nextIn: number | null }
export interface View { settings: Settings; check: Check | null; hasBaseline: boolean; canDecide: boolean; keepWarm?: KeepWarmState | null }
export interface Operations {
  agentPresence: { input: { chatId?: string; connectionId?: string; offline?: boolean }; output: void };
  agentClaim: { input: { id: string }; output: { kind: "audit" | "simulation"; input: import("./health/types").AuditInput } };
  agentFinish: { input: { id: string; error?: string; cleanupError?: string; scratchChatId?: string }; output: void };
  diffList: { input: { before?: string; after: string; cursor?: number; includeUnchanged?: boolean }; output: import("./prompt-store").MessagePage };
  diffOpen: { input: import("./prompt-store").DiffInput; output: { id: string; page: import("./diff-engine").DiffPage } };
  diffPage: { input: { id: string; cursor?: number; fold?: number }; output: import("./diff-engine").DiffPage };
  load: { input: { chatId?: string }; output: View };
  settings: { input: Settings; output: Settings };
  keepWarm: { input: { enabled: boolean; chatId?: string }; output: { settings: Settings; state: KeepWarmState | null } };
  decide: { input: { id: string; allow: boolean }; output: void };
  clear: { input: { chatId: string }; output: void };
  audit: { input: import("./health/types").AuditInput & { agentJobId?: string }; output: import("./health/types").HealthReport };
  prepareSimulation: { input: import("./health/types").AuditInput & { agentJobId?: string }; output: import("./health/types").SimulationTicket };
  simulate: { input: { id: string; scratchChatId: string }; output: import("./health/types").SimulationReport };
  cancelSimulation: { input: { id: string }; output: void };
}
export interface Reply { type: "reply"; id: string; value?: unknown; error?: string }
export const COVERAGE = "Compares assembled prompts before sending. Later host/provider changes, tools, cache expiry and provider cache state are not visible here. This is a cache-risk check, not a confirmed cache hit or miss.";
export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
