import assert from "node:assert/strict";
import { Result } from "better-result";
import type { SamplingMessage } from "@modelcontextprotocol/sdk/types.js";
import { HostWorkerProviderRuntime } from "./host-worker-provider-runtime.js";
import type { LocalAgentRecord, LocalAgentWorkspaceScope } from "./local-agent-store.js";
import type { RunOverrides, StartLocalAgentInput } from "./local-agent-manager.js";

interface FakeClientCall {
  kind: "start" | "continue" | "get";
  provider?: string;
  agentId?: string;
  prompt?: string;
}

class FakeLocalAgentClient {
  readonly calls: FakeClientCall[] = [];
  private nextId = 1;
  private readonly records = new Map<string, LocalAgentRecord>();
  private readonly terminalByProvider = new Map<string, Array<Partial<LocalAgentRecord>>>();

  queue(provider: string, terminal: Partial<LocalAgentRecord>): void {
    const queue = this.terminalByProvider.get(provider) ?? [];
    queue.push(terminal);
    this.terminalByProvider.set(provider, queue);
  }

  async start(input: StartLocalAgentInput) {
    this.calls.push({ kind: "start", provider: input.target, prompt: input.prompt });
    const id = `agt_${this.nextId++}`;
    const record = agentRecord(id, input.target, "running");
    this.records.set(id, record);
    return Result.ok(record);
  }

  async continue(agentId: string, prompt: string, _overrides: RunOverrides, _scope: LocalAgentWorkspaceScope) {
    const current = this.records.get(agentId)!;
    this.calls.push({ kind: "continue", provider: current.provider, agentId, prompt });
    const running = { ...current, status: "running" as const, latestResponse: undefined, error: undefined, errorCode: undefined };
    this.records.set(agentId, running);
    return Result.ok(running);
  }

  async get(agentId: string, _scope: LocalAgentWorkspaceScope) {
    const current = this.records.get(agentId)!;
    this.calls.push({ kind: "get", provider: current.provider, agentId });
    if (current.status !== "running" && current.status !== "starting") return Result.ok(current);
    const queue = this.terminalByProvider.get(current.provider) ?? [];
    const terminal = queue.shift();
    assert.ok(terminal, `missing terminal record for ${current.provider}`);
    const next = { ...current, ...terminal, updatedAt: new Date().toISOString() };
    this.records.set(agentId, next);
    return Result.ok(next);
  }
}

const baseInput = () => ({
  workerId: "hw_test",
  workspaceId: "ws_test",
  workspaceRoot: "/tmp/project",
  taskPacket: "Goal: inspect runtime",
  history: [] as SamplingMessage[],
  message: "Inspect the code.",
  signal: new AbortController().signal,
});

{
  const client = new FakeLocalAgentClient();
  client.queue("codex", { status: "idle", latestResponse: "codex result" });
  const runtime = new HostWorkerProviderRuntime(client, { pollIntervalMs: 0, timeoutMs: 1_000 });
  const result = await runtime.runTurn(baseInput());
  assert.equal(result.finalResponse, "codex result");
  assert.deepEqual(client.calls.filter((call) => call.kind === "start").map((call) => call.provider), ["codex"]);
}

{
  const client = new FakeLocalAgentClient();
  client.queue("codex", { status: "error", errorCode: "PROVIDER_EXECUTION_ERROR", error: "generic failure" });
  const runtime = new HostWorkerProviderRuntime(client, { pollIntervalMs: 0, timeoutMs: 1_000 });
  await assert.rejects(runtime.runTurn(baseInput()), /PROVIDER_EXECUTION_ERROR/);
  assert.deepEqual(client.calls.filter((call) => call.kind === "start").map((call) => call.provider), ["codex"]);
}

{
  const client = new FakeLocalAgentClient();
  client.queue("codex", { status: "error", errorCode: "PROVIDER_QUOTA_EXHAUSTED", error: "quota" });
  client.queue("pi", { status: "idle", latestResponse: "pi fallback result" });
  const runtime = new HostWorkerProviderRuntime(client, { pollIntervalMs: 0, timeoutMs: 1_000 });
  const result = await runtime.runTurn(baseInput());
  assert.equal(result.finalResponse, "pi fallback result");
  assert.deepEqual(client.calls.filter((call) => call.kind === "start").map((call) => call.provider), ["codex", "pi"]);
}

{
  const client = new FakeLocalAgentClient();
  client.queue("codex", { status: "error", errorCode: "PROVIDER_QUOTA_EXHAUSTED", error: "quota" });
  client.queue("pi", { status: "error", errorCode: "PROVIDER_UNAVAILABLE", error: "pi missing" });
  client.queue("claude", { status: "idle", latestResponse: "claude fallback result" });
  const runtime = new HostWorkerProviderRuntime(client, { pollIntervalMs: 0, timeoutMs: 1_000 });
  const result = await runtime.runTurn(baseInput());
  assert.equal(result.finalResponse, "claude fallback result");
  assert.deepEqual(client.calls.filter((call) => call.kind === "start").map((call) => call.provider), ["codex", "pi", "claude"]);
}

{
  const client = new FakeLocalAgentClient();
  client.queue("codex", { status: "error", errorCode: "PROVIDER_QUOTA_EXHAUSTED", error: "quota" });
  client.queue("pi", { status: "error", errorCode: "PROVIDER_EXECUTION_ERROR", error: "pi bug" });
  const runtime = new HostWorkerProviderRuntime(client, { pollIntervalMs: 0, timeoutMs: 1_000 });
  await assert.rejects(runtime.runTurn(baseInput()), /PROVIDER_EXECUTION_ERROR/);
  assert.deepEqual(client.calls.filter((call) => call.kind === "start").map((call) => call.provider), ["codex", "pi"]);
}

{
  const client = new FakeLocalAgentClient();
  client.queue("codex", { status: "idle", latestResponse: "first" });
  client.queue("codex", { status: "idle", latestResponse: "second" });
  const runtime = new HostWorkerProviderRuntime(client, { pollIntervalMs: 0, timeoutMs: 1_000 });
  const first = await runtime.runTurn(baseInput());
  const second = await runtime.runTurn({
    ...baseInput(),
    history: first.history,
    message: "Follow up.",
  });
  assert.equal(second.finalResponse, "second");
  assert.equal(client.calls.filter((call) => call.kind === "start").length, 1);
  assert.equal(client.calls.filter((call) => call.kind === "continue").length, 1);
}

function agentRecord(id: string, provider: string, status: LocalAgentRecord["status"]): LocalAgentRecord {
  const now = new Date().toISOString();
  return {
    id,
    workspaceId: "ws_test",
    workspaceRoot: "/tmp/project",
    profileName: provider,
    provider,
    status,
    createdAt: now,
    updatedAt: now,
  };
}
