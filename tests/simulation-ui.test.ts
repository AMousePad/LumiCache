import { expect, test } from "bun:test";
import { BackendReplyError, type Bridge } from "../src/ui/bridge";
import { simulate } from "../src/ui/simulation";
import type { SimulationReport, SimulationTicket } from "../src/health/types";

function fixture(failure?: "setup" | "backend" | "network", copy: SimulationTicket["copy"] = "import") {
  const ticket: SimulationTicket = { id: "ticket", sourceChatId: "source", lastMessageId: "message", branchName: "LumiCache simulation ticket", copy };
  const calls: Array<{ path: string; method: string; body: any }> = [], operations: Array<{ operation: string; input: any }> = [];
  const result = { sourceChatId: "source", complete: true, steps: [], history: [], health: { findings: [] }, limitations: [] } as unknown as SimulationReport;
  const bridge = { call: async (operation: string, input: any) => {
    operations.push({ operation, input });
    if (operation === "prepareSimulation") return ticket;
    if (operation === "simulate") {
      if (failure === "backend") throw new BackendReplyError("Ticket cancelled");
      if (failure === "network") throw new Error("Connection lost");
      return result;
    }
  } } as Pick<Bridge, "call">;
  const api = async (path: string, method = "GET", body?: unknown) => {
    calls.push({ path, method, body });
    if (method === "DELETE") return { success: true };
    if (path === "preset-profiles/chat/source") return { preset_id: "preset", block_states: { main: true }, prompt_variables: { main: { tone: "quiet" } } };
    if (path === "chats/source/export") return { chat: { id: "source", character_id: "character", metadata: {} }, messages: [{ id: "message", content: "Hello", name: "User", is_user: true }] };
    if (path === "chats/import") return { chat_id: "copy", name: ticket.branchName };
    if (path === "chats/source/branch") return { id: "copy", name: ticket.branchName, metadata: { branched_from: "source", branch_at_message: "message" } };
    if (path === "preset-profiles/chat/copy" && method === "PUT" && failure === "setup") throw new Error("Profile failed");
    return {};
  };
  return { bridge, api, calls, operations: () => operations.map(item => item.operation), inputs: operations, result };
}
test("frontend setup copies the conversation and private profile, then delegates previews to the backend", async () => {
  const f = fixture(); expect(await simulate(f.bridge, { chatId: "source" }, () => {}, f.api)).toBe(f.result);
  expect(f.calls.find(call => call.path === "chats/import")!.body.chat.metadata.lumicache_simulation).toBe("ticket");
  expect(f.calls.find(call => call.path === "preset-profiles/chat/copy" && call.method === "PUT")!.body.prompt_variables).toEqual({ main: { tone: "quiet" } });
  expect(f.calls.some(call => call.path === "preset-profiles/chat/copy" && call.method === "DELETE")).toBe(true);
  expect(f.calls.some(call => call.method !== "GET" && call.path.includes("/source"))).toBe(false);
  expect(f.operations()).toEqual(["prepareSimulation", "simulate"]);
});
test("a branch ticket copies on the server without downloading or uploading the chat", async () => {
  const f = fixture(undefined, "branch"); expect(await simulate(f.bridge, { chatId: "source" }, () => {}, f.api)).toBe(f.result);
  expect(f.calls.find(call => call.path === "chats/source/branch")).toMatchObject({ method: "POST", body: { message_id: "message", name: "LumiCache simulation ticket" } });
  expect(f.calls.some(call => call.path.endsWith("/export") || call.path === "chats/import")).toBe(false);
  expect(f.inputs.find(item => item.operation === "simulate")!.input).toEqual({ id: "ticket", scratchChatId: "copy" });
});
test("a branch that was never handed over is removed by the backend, which checks it first", async () => {
  const f = fixture("setup", "branch"); await expect(simulate(f.bridge, { chatId: "source" }, () => {}, f.api)).rejects.toThrow("Profile failed");
  expect(f.calls.some(call => call.method === "DELETE" && call.path === "chats/copy")).toBe(false);
  expect(f.inputs.find(item => item.operation === "cancelSimulation")!.input).toEqual({ id: "ticket", scratchChatId: "copy" });
});
test("failed setup removes only its disposable copy and temporary profile", async () => {
  const f = fixture("setup"); await expect(simulate(f.bridge, { chatId: "source" }, () => {}, f.api)).rejects.toThrow("Profile failed");
  expect(f.calls.filter(call => call.method === "DELETE").map(call => call.path)).toEqual(["chats/copy", "preset-profiles/chat/copy"]);
  expect(f.operations()).toContain("cancelSimulation");
});
test("a cancelled ticket is cleaned up, while a lost connection leaves cleanup with the running backend", async () => {
  const rejected = fixture("backend"); await expect(simulate(rejected.bridge, { chatId: "source" }, () => {}, rejected.api)).rejects.toThrow("Ticket cancelled");
  expect(rejected.calls.some(call => call.path === "chats/copy" && call.method === "DELETE")).toBe(true);
  const disconnected = fixture("network"); await expect(simulate(disconnected.bridge, { chatId: "source" }, () => {}, disconnected.api)).rejects.toThrow("Connection lost");
  expect(disconnected.calls.some(call => call.method === "DELETE")).toBe(false);
});
