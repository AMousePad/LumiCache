import { describe, expect, test } from "bun:test";
import { tailStart } from "../src/consistency";
import { classifyDepth } from "../src/health/depth";
import type { HealthReport } from "../src/health/types";
import { loadSettings, saveSettings, validateSettings, type SettingsStorage } from "../src/settings";
import { context } from "./fixtures";

function storage(initial?: Record<string, unknown>) {
  const state = { file: initial, writes: 0, failing: false };
  const api: SettingsStorage = {
    getJson: async <T,>(_path: string, options: { fallback: T }) => (state.file === undefined ? options.fallback : structuredClone(state.file)) as T,
    setJson: async (_path, value) => { if (state.failing) throw new Error("disk full"); state.file = JSON.parse(JSON.stringify(value)); state.writes++; },
  };
  return { api, state };
}

describe("one-time depth migration", () => {
  test("clears an old saved 5 and keeps every other setting", async () => {
    const { api, state } = storage({ mode: "pause", acceptableDepth: 5, refreshEvery: 7 });
    const settings = await loadSettings(api, "user");
    expect(settings).toMatchObject({ mode: "pause", acceptableDepth: null, refreshEvery: 7 });
    expect(state.file).toMatchObject({ acceptableDepth: null, refreshEvery: 7, settingsVersion: 1 });
    expect(state.writes).toBe(1);
  });

  test("runs once, however many times settings load", async () => {
    const { api, state } = storage({ mode: "warn", acceptableDepth: 5 });
    for (let i = 0; i < 3; i++) await loadSettings(api, "user");
    expect(state.writes).toBe(1);
  });

  test("a 5 the user enters after the migration stays", async () => {
    const { api } = storage({ mode: "warn", acceptableDepth: 5 });
    const migrated = await loadSettings(api, "user");
    await saveSettings(api, "user", { ...migrated, acceptableDepth: 5 });
    for (let i = 0; i < 3; i++) expect((await loadSettings(api, "user")).acceptableDepth).toBe(5);
  });

  test("another saved depth is kept, and marks the file so a later 5 stays too", async () => {
    const { api, state } = storage({ mode: "warn", acceptableDepth: 3 });
    expect((await loadSettings(api, "user")).acceptableDepth).toBe(3);
    expect(state.file?.settingsVersion).toBe(1);
    await saveSettings(api, "user", validateSettings({ mode: "warn", acceptableDepth: 5 }));
    expect((await loadSettings(api, "user")).acceptableDepth).toBe(5);
  });

  test("a new user writes nothing, and their first save of 5 stays", async () => {
    const { api, state } = storage();
    expect((await loadSettings(api, "user")).acceptableDepth).toBeNull();
    expect(state.writes).toBe(0);
    await saveSettings(api, "user", validateSettings({ mode: "warn", acceptableDepth: 5 }));
    expect((await loadSettings(api, "user")).acceptableDepth).toBe(5);
  });

  test("a failed write still clears for now and retries on the next load", async () => {
    const { api, state } = storage({ mode: "warn", acceptableDepth: 5 });
    state.failing = true;
    expect((await loadSettings(api, "user")).acceptableDepth).toBeNull();
    state.failing = false;
    expect((await loadSettings(api, "user")).acceptableDepth).toBeNull();
    expect(state.writes).toBe(1);
  });

  test("the marker stays out of the settings the rest of the extension sees", async () => {
    const { api } = storage({ mode: "warn", acceptableDepth: 5 });
    expect(await loadSettings(api, "user")).not.toHaveProperty("settingsVersion");
  });
});

describe("blank depth", () => {
  test("uses the default in the send policy", async () => {
    const history = [1, 2, 3, 4].map(id => ({ role: "user" as const, content: `${id}`, __isChatHistory: true, sourceMessageId: `h${id}`, sourceIndexInChat: id }));
    expect((await tailStart(history, validateSettings({ mode: "warn" }), context())).index).toBe(2);
  });
  test("uses the default in Health", async () => {
    const report = { model: "model", findings: [{ level: "depth", depth: 2 }, { level: "depth", depth: 3 }] } as unknown as HealthReport;
    await classifyDepth(report, { mode: "warn" }, []);
    expect(report.findings.map(finding => finding.problematic)).toEqual([false, true]);
  });
});
