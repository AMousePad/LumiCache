import { expect, test } from "bun:test";
import { AutoHealth } from "../src/ui/auto-health";
import type { AuditInput, HealthReport } from "../src/health/types";

function fixture() {
  let input: AuditInput | null = { chatId: "one", connectionId: "a" };
  const calls: AuditInput[] = [], accepted: string[] = [], errors: unknown[] = [];
  const pending: { resolve: (report: HealthReport) => void; reject: (error: unknown) => void }[] = [];
  const auto = new AutoHealth({ input: () => input, delay: 5,
    check: value => { calls.push(value); return new Promise((resolve, reject) => pending.push({ resolve, reject })); },
    result: report => accepted.push(report.chatId), error: error => errors.push(error), changed: () => {} });
  return { auto, calls, accepted, errors, set: (value: AuditInput | null) => { input = value; auto.sync(); },
    finish: () => pending.shift()!.resolve({ chatId: calls.at(-1)!.chatId } as HealthReport), fail: () => pending.shift()!.reject(new Error("stale")) };
}
const tick = () => Bun.sleep(15);
test("automatic changes coalesce and never overlap a running preview", async () => {
  const f = fixture(); f.auto.sync(); f.auto.invalidate(); f.auto.invalidate(); await tick(); expect(f.calls).toHaveLength(1);
  f.auto.invalidate(); f.auto.invalidate(); await tick(); expect(f.calls).toHaveLength(1);
  f.finish(); await tick(); expect(f.accepted).toEqual([]); expect(f.calls).toHaveLength(2);
  f.finish(); await tick(); expect(f.accepted).toEqual(["one"]); expect(f.auto.stale).toBe(false); f.auto.dispose();
});
test("chat and connection changes fence old reports and errors", async () => {
  const f = fixture(); f.auto.sync(); await tick(); f.set({ chatId: "two", connectionId: "a" }); f.finish(); await tick();
  expect(f.accepted).toEqual([]); expect(f.calls.at(-1)!.chatId).toBe("two");
  f.set({ chatId: "two", connectionId: "b" }); f.fail(); await tick(); expect(f.errors).toEqual([]);
  expect(f.calls.at(-1)!.connectionId).toBe("b"); f.finish(); await tick(); expect(f.accepted).toEqual(["two"]); f.auto.dispose();
});
test("live generation suspends refresh and resumes one pending check; disposal drops late results", async () => {
  const f = fixture(); f.auto.suspend(true); f.auto.sync(); f.auto.refresh(); await tick(); expect(f.calls).toHaveLength(0);
  f.auto.suspend(false); await tick(); expect(f.calls).toHaveLength(1); f.auto.dispose(); f.finish(); await tick(); expect(f.accepted).toEqual([]);
});
test("an explicitly requested report for another connection cannot replace current health", async () => {
  const f = fixture(); f.auto.accept({ chatId: "foreign" } as HealthReport, { chatId: "one", connectionId: "b" }); expect(f.accepted).toEqual([]);
  f.auto.accept({ chatId: "one" } as HealthReport, { chatId: "one", connectionId: "a" }); expect(f.accepted).toEqual(["one"]); f.auto.dispose();
});
