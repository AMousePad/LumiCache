import type { SpindleAPI } from "lumiverse-spindle-types";
import { BaselineStore } from "./baseline";
import { Guard } from "./guard";
import { HostContexts, type HostContext } from "./host-context";
import { DEFAULT_SETTINGS, errorText, type Settings } from "./shared";
import { HealthService } from "./health/service";
import { compositionSnapshot } from "./health/composition";

import { AgentBridge } from "./agent-bridge";
import { AutoRefresh } from "./auto-refresh";
import { CatBridge } from "./cat-bridge";
import { PromptStore } from "./prompt-store";
import { validateSettings } from "./settings";
const prompts = new PromptStore();
declare const spindle: SpindleAPI;
const guard = new Guard((user, chatId, session) => spindle.sendToFrontend({ type: "changed", chatId }, user,
  session ? { frontendSessionId: session } : undefined), (messages, context) => spindle.tokens.countMessages(messages, { userId: context.userId, model: context.mainDispatch.descriptor?.model }),
  new BaselineStore(spindle), (user, tone, title, message) => spindle.toast[tone](message, { title, userId: user }));
const settingsCache = new Map<string, Promise<Settings>>();
const contexts = new HostContexts();
let agent: AgentBridge;
const health = new HealthService(spindle, (user, chat) => contexts.isActive(user, chat),
  (user, session, completed, name) => {
    agent?.progress(user, session, completed, name);
    spindle.sendToFrontend({ type: "simulationProgress", completed, name }, user, { frontendSessionId: session });
  }, settings);
const autoRefresh = new AutoRefresh({ generate: spindle.generate, prompt: (user, chat) => guard.prompt(user, chat), busy: (user, chat) => contexts.isActive(user, chat),
  toast: (user, tone, title, message) => { spindle.toast[tone](message, { title, userId: user }); },
  changed: (user, state) => { spindle.sendToFrontend({ type: "keepWarm", state }, user); } });
agent = new AgentBridge(spindle, guard, health, prompts);
agent.register();
function settings(user: string): Promise<Settings> {
  let current = settingsCache.get(user);
  if (!current) {
    current = spindle.userStorage.getJson<Settings>("settings.json", { fallback: DEFAULT_SETTINGS, userId: user }).then(validateSettings);
    settingsCache.set(user, current);
    void current.catch(() => { if (settingsCache.get(user) === current) settingsCache.delete(user); });
  }
  return current;
}
/** LumiBooks Cache Friendly mode checks for this endpoint. */
spindle.rpcPool.sync("status", { version: 1 }, { requires: [] });
async function plannedBreakEpoch(chatId: string): Promise<string | null> {
  try {
    const value = await spindle.rpcPool.read<{ epoch?: unknown } | null>(`lumi_books.cache_epoch.${chatId}`);
    return typeof value?.epoch === "string" ? value.epoch : null;
  } catch (error) {
    if (/not registered/i.test(errorText(error))) return null;
    throw error;
  }
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200) throw new Error("Invalid LumiCache request.");
  return value;
}
new CatBridge(spindle, guard, settings, plannedBreakEpoch).register();
if (!spindle.host.capabilities["interceptor-context-v1"]) throw new Error("LumiCache requires a Lumiverse build with bound interceptor context.");
spindle.on("CHAT_DELETED", (event, user) => {
  const id = (event as { id?: unknown } | null)?.id;
  if (user && typeof id === "string") { guard.forget(user, id); autoRefresh.cancel(user, id); }
});
// The saved prompt may hold what was just deleted, so it must not be sent again.
spindle.on("MESSAGE_DELETED", (event, user) => {
  const chat = (event as { chatId?: unknown } | null)?.chatId;
  if (user && typeof chat === "string") autoRefresh.cancel(user, chat);
});
spindle.on("GENERATION_STARTED", (event, user) => { if (user) { contexts.start(user, event); autoRefresh.interrupt(user, event.chatId); } });
spindle.registerInterceptor(async (messages, context) => {
  const raw = context as HostContext;
  if (raw.isDryRun || raw.dryRun) return messages;
  const config = await settings(raw.userId);
  if (config.mode === "off") { guard.unwatched(raw.userId, raw.chatId); return messages; }
  return guard.inspect(messages, await contexts.resolve(raw, spindle), config, await plannedBreakEpoch(raw.chatId));
}, {
  priority: 2_000_000_000, required: true,
  match: { generationTypes: ["normal", "continue", "regenerate", "swipe"] },
});
spindle.on("GENERATION_ENDED", (event, user) => { if (!user) return;
  contexts.finish(user, event);
  if (guard.finish(user, event.generationId, !event.error, event.messageId)) void settings(user).then(config => autoRefresh.start(user, event.chatId, validateSettings(config)), error => console.warn("[LumiCache] Could not start auto-refresh:", error));
});
spindle.on("GENERATION_STOPPED", (event, user) => { if (user) { contexts.finish(user, event); guard.finish(user, event.generationId, false); } });
spindle.on("FRONTEND_SESSION_CLOSED", (event, user) => {
  const session = (event as { frontendSessionId?: unknown } | null)?.frontendSessionId;
  if (user && typeof session === "string") guard.disconnect(user, session);
});
spindle.onFrontendMessage((raw, user, session) => {
  if (!raw || typeof raw !== "object") return;
  const request = raw as { type: string; id: unknown; operation: string; input?: Record<string, unknown> };
  if (!session) return;
  if (request.type !== "request" || typeof request.id !== "string" || request.id.length > 200) return;
  void (async () => {
    let value: unknown;
    try {
      const input = request.input ?? {};
      switch (request.operation) {
        case "agentPresence": agent.presence(user, session, input); break;
        case "agentClaim": value = agent.claim(user, session, text(input.id)); break;
        case "agentFinish": agent.finish(user, session, text(input.id), input); break;
        case "diffList": value = prompts.list(user, session, input as never); break;
        case "diffOpen": value = prompts.open(user, session, input as never); break;
        case "diffPage": value = prompts.page(user, session, input as never); break;
        case "load": {
          const chatId = input.chatId === undefined ? undefined : text(input.chatId);
          if (chatId) guard.resume(user, chatId, session);
          value = { settings: await settings(user), keepWarm: autoRefresh.state(user), ...guard.view(user, chatId, session) }; break;
        }
        case "settings": {
          const before = validateSettings(await settings(user)), next = validateSettings(input);
          await spindle.userStorage.setJson("settings.json", next, { userId: user });
          settingsCache.set(user, Promise.resolve(next)); value = next;
          // Health filters save through here too, and must not reset a running job.
          if (before.autoRefreshEnabled !== next.autoRefreshEnabled || before.autoRefreshMinutes !== next.autoRefreshMinutes || before.autoRefreshLimit !== next.autoRefreshLimit) autoRefresh.restart(user, next);
          spindle.sendToFrontend({ type: "changed" }, user); break;
        }
        case "keepWarm": {
          if (typeof input.enabled !== "boolean") throw new Error("Invalid Keep Cache Warm request.");
          const chatId = input.chatId === undefined ? undefined : text(input.chatId);
          const next = { ...validateSettings(await settings(user)), autoRefreshEnabled: input.enabled };
          await spindle.userStorage.setJson("settings.json", next, { userId: user });
          settingsCache.set(user, Promise.resolve(next));
          if (!next.autoRefreshEnabled) autoRefresh.cancel(user);
          else if (chatId && guard.prompt(user, chatId)) autoRefresh.start(user, chatId, next);
          value = { settings: next, state: autoRefresh.state(user) };
          spindle.sendToFrontend({ type: "changed" }, user); break;
        }
        case "decide":
          if (typeof input.allow !== "boolean") throw new Error("Invalid review decision.");
          guard.decide(user, session, text(input.id), input.allow); break;
        case "clear": guard.clear(user, text(input.chatId)); break;
        case "audit": {
          const auditInput = { chatId: text(input.chatId), ...(input.connectionId ? { connectionId: text(input.connectionId) } : {}) };
          const jobId = input.agentJobId === undefined ? undefined : text(input.agentJobId);
          if (jobId) agent.authorize(user, session, jobId, "audit", auditInput);
          const report = await health.audit(user, { ...auditInput, composition: compositionSnapshot(input.composition) }); agent.auditResult(user, report, jobId); value = report; break;
        }
        case "prepareSimulation": {
          const auditInput = { chatId: text(input.chatId), ...(input.connectionId ? { connectionId: text(input.connectionId) } : {}) };
          const jobId = input.agentJobId === undefined ? undefined : text(input.agentJobId);
          if (jobId) agent.authorize(user, session, jobId, "simulation", auditInput);
          const ticket = await health.prepare(user, session, { ...auditInput, composition: compositionSnapshot(input.composition) });
          if (jobId) agent.attach(user, session, jobId, ticket);
          value = ticket; break;
        }
        case "simulate": {
          const ticket = text(input.id), scratch = text(input.scratchChatId);
          agent.submitted(user, session, ticket, scratch);
          const report = await health.run(user, session, ticket, scratch);
          agent.simulationResult(user, session, ticket, report); value = report; break;
        }
        case "cancelSimulation": health.cancel(user, session, text(input.id)); agent.cancelledTicket(user, session, text(input.id)); break;
        default: throw new Error("Unknown LumiCache operation.");
      }
      spindle.sendToFrontend({ type: "reply", id: request.id, value: prompts.pack(value, user, session) }, user, { frontendSessionId: session });
    } catch (error) { spindle.sendToFrontend({ type: "reply", id: request.id, error: errorText(error) }, user, { frontendSessionId: session }); }
  })();
});
