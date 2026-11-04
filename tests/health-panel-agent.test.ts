import { beforeAll, afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { HealthPanel } from "../src/ui/health";
import type { HealthReport } from "../src/health/types";

const window = new Window(), saved = globalThis.document;
beforeAll(() => { globalThis.document = window.document as unknown as Document; });
afterAll(() => { globalThis.document = saved; window.happyDOM.abort(); });
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function fixture() {
  let listener: (raw: unknown) => void = () => {}, resolveAudit: (value: HealthReport) => void = () => {};
  const requests: { op: string; input: any }[] = [];
  const report: HealthReport = { chatId: "chat", at: Date.now(), preset: "Fixture", provider: "custom", model: "model", findings: [], blocksScanned: 1, entriesScanned: 0 };
  const bridge = { call: async (op: string, input: any) => {
    requests.push({ op, input });
    if (op === "agentClaim") return { kind: "audit", input: { chatId: "chat", connectionId: "chosen" } };
    if (op === "audit") return new Promise<HealthReport>(resolve => { resolveAudit = resolve; });
  } };
  const panel = new HealthPanel({ onBackendMessage: (fn: typeof listener) => { listener = fn; return () => { listener = () => {}; }; } } as never, bridge as never, () => ({ chatId: "chat", connectionId: "chosen" }), async () => ({ available: true }));
  panel.render();
  return { panel, requests, emit: () => listener({ type: "agentDiagnostic", id: "job" }), finish: () => resolveAudit(report) };
}
test("agent audits use the canonical claim and display their report without a manual click", async () => {
  const f = fixture(); f.emit(); await flush();
  expect(f.requests.find(r => r.op === "audit")?.input).toEqual({ chatId: "chat", connectionId: "chosen", agentJobId: "job", composition: { available: true } });
  expect((f.panel.root.querySelector('[aria-label="Refresh cache health"]') as HTMLButtonElement).disabled).toBe(true);
  f.finish(); await flush(); expect(f.panel.root.querySelector(".lc-health-pill")?.getAttribute("aria-label")).toBe("Filter finding classifications");
  f.panel.dispose();
});
test("an agent audit queues behind a manual refresh without overlapping previews", async () => {
  const f = fixture(); (f.panel.root.querySelector('[aria-label="Refresh cache health"]') as HTMLButtonElement).click(); await Bun.sleep(10);
  f.emit(); await flush();
  expect(f.requests.find(r => r.op === "agentFinish")).toBeUndefined();
  expect((f.panel.root.querySelector('[aria-label="Refresh cache health"]') as HTMLButtonElement).disabled).toBe(true);
  expect(f.requests.filter(r => r.op === "audit")).toHaveLength(1);
  f.finish(); await flush(); expect(f.requests.filter(r => r.op === "audit")).toHaveLength(2);
  expect((f.panel.root.querySelector('[aria-label="Refresh cache health"]') as HTMLButtonElement).disabled).toBe(true);
  f.finish(); await flush(); expect((f.panel.root.querySelector('[aria-label="Refresh cache health"]') as HTMLButtonElement).disabled).toBe(false); f.panel.dispose();
});
