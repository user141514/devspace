import assert from "node:assert/strict";
import type { HostWorkerProviderRunTurnInput } from "./host-worker-provider-runtime.js";
import { HostWorkerExecutionRouter } from "./host-worker-execution-router.js";

const input = (): HostWorkerProviderRunTurnInput => ({
  workerId: "hw_test",
  workspaceId: "ws_test",
  workspaceRoot: "/tmp/project",
  taskPacket: "Goal: inspect",
  history: [],
  message: "Inspect.",
  signal: new AbortController().signal,
});

function runtime(label: string, calls: string[]) {
  return {
    async runTurn(turn: HostWorkerProviderRunTurnInput) {
      calls.push(label);
      return {
        finalResponse: `${label}:${turn.message}`,
        history: turn.history,
      };
    },
  };
}

{
  const calls: string[] = [];
  const router = new HostWorkerExecutionRouter(
    () => ({
      sampling: true,
      tools: false,
      taskSampling: false,
      background: false,
      providerBacked: true,
      available: true,
      preferredMode: "sampling",
      maxConcurrency: 4,
    }),
    runtime("native", calls),
    runtime("provider", calls),
  );
  const result = await router.runTurn(input());
  assert.equal(result.finalResponse, "native:Inspect.");
  assert.deepEqual(calls, ["native"]);
}

{
  const calls: string[] = [];
  const router = new HostWorkerExecutionRouter(
    () => ({
      sampling: false,
      tools: false,
      taskSampling: false,
      background: false,
      providerBacked: true,
      available: true,
      preferredMode: "provider",
      maxConcurrency: 4,
    }),
    runtime("native", calls),
    runtime("provider", calls),
  );
  const result = await router.runTurn(input());
  assert.equal(result.finalResponse, "provider:Inspect.");
  assert.deepEqual(calls, ["provider"]);
}

{
  const calls: string[] = [];
  const router = new HostWorkerExecutionRouter(
    () => ({
      sampling: false,
      tools: false,
      taskSampling: false,
      background: false,
      providerBacked: false,
      available: false,
      preferredMode: "unavailable",
      maxConcurrency: 4,
    }),
    runtime("native", calls),
    runtime("provider", calls),
  );
  await assert.rejects(router.runTurn(input()), /host_worker_execution_unavailable/);
  assert.deepEqual(calls, []);
}
