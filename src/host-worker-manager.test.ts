import assert from "node:assert/strict";
import test from "node:test";
import { HostWorkerManager } from "./host-worker-manager.js";

const capabilities = {
  sampling: true,
  tools: true,
  taskSampling: false,
  background: false,
  maxConcurrency: 4,
};

function createInput() {
  return {
    workspaceId: "ws_test",
    workspaceRoot: "/tmp/project",
    goal: "Inspect runtime lifecycle.",
    key: "runtime",
    context: "Focus on shutdown behavior.",
    constraints: ["Read only"],
    expectedOutput: "Evidence-backed findings.",
    requireTools: true,
  };
}

test("create returns an idle worker snapshot with a stable session-local id", () => {
  const manager = new HostWorkerManager(capabilities);
  const created = manager.create(createInput());

  assert.match(created.id, /^hw_[a-f0-9]+$/);
  assert.equal(created.key, "runtime");
  assert.equal(created.workspaceId, "ws_test");
  assert.equal(created.status, "idle");
  assert.equal(typeof created.createdAt, "string");
  assert.deepEqual(manager.get(created.id), created);
});

test("create rejects unavailable sampling and required tools", () => {
  const noSampling = new HostWorkerManager({ ...capabilities, sampling: false, tools: false });
  assert.throws(() => noSampling.create(createInput()), /sampling_not_supported/);

  const noTools = new HostWorkerManager({ ...capabilities, tools: false });
  assert.throws(() => noTools.create(createInput()), /sampling_tools_not_supported/);
});

test("unknown worker ids are rejected", () => {
  const manager = new HostWorkerManager(capabilities);
  assert.throws(() => manager.get("hw_missing"), /worker_not_found/);
  assert.throws(() => manager.cancel("hw_missing"), /worker_not_found/);
});

test("cancel transitions an idle worker and prevents reuse", () => {
  const manager = new HostWorkerManager(capabilities);
  const worker = manager.create(createInput());

  const cancelled = manager.cancel(worker.id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(typeof cancelled.completedAt, "string");
  assert.deepEqual(manager.get(worker.id), cancelled);
});

test("close cancels owned workers and rejects new workers", () => {
  const manager = new HostWorkerManager(capabilities);
  const first = manager.create(createInput());
  const second = manager.create({ ...createInput(), key: "tests" });

  manager.close();

  assert.equal(manager.get(first.id).status, "cancelled");
  assert.equal(manager.get(second.id).status, "cancelled");
  assert.throws(() => manager.create(createInput()), /transport_closed/);
});

test("worker ids are isolated between manager instances", () => {
  const managerA = new HostWorkerManager(capabilities);
  const managerB = new HostWorkerManager(capabilities);
  const workerA = managerA.create(createInput());

  assert.throws(() => managerB.get(workerA.id), /worker_not_found/);
});

test("send preserves one worker context across follow-up turns", async () => {
  const observed: Array<{ historyLength: number; message: string }> = [];
  let manager: HostWorkerManager;
  let workerId = "";
  const runtime = {
    runTurn: async (input: { history: unknown[]; message: string }) => {
      observed.push({ historyLength: input.history.length, message: input.message });
      assert.equal(manager.get(workerId).status, "running");
      const turn = observed.length;
      return {
        finalResponse: `response-${turn}`,
        history: turn === 1
          ? [
              { role: "user" as const, content: { type: "text" as const, text: "first" } },
              { role: "assistant" as const, content: { type: "text" as const, text: "response-1" } },
            ]
          : [
              { role: "user" as const, content: { type: "text" as const, text: "first" } },
              { role: "assistant" as const, content: { type: "text" as const, text: "response-1" } },
              { role: "user" as const, content: { type: "text" as const, text: "second" } },
              { role: "assistant" as const, content: { type: "text" as const, text: "response-2" } },
            ],
      };
    },
  };
  manager = new HostWorkerManager(capabilities, runtime);
  const worker = manager.create(createInput());
  workerId = worker.id;

  const first = await manager.send(worker.id, "first");
  assert.equal(first.status, "completed");
  assert.equal(first.finalResponse, "response-1");

  const second = await manager.send(worker.id, "second");
  assert.equal(second.status, "completed");
  assert.equal(second.finalResponse, "response-2");
  assert.deepEqual(observed, [
    { historyLength: 0, message: "first" },
    { historyLength: 2, message: "second" },
  ]);
});

test("cancelled workers reject follow-up sends", async () => {
  const manager = new HostWorkerManager(capabilities, {
    runTurn: async () => ({ finalResponse: "unused", history: [] }),
  });
  const worker = manager.create(createInput());
  manager.cancel(worker.id);

  await assert.rejects(() => manager.send(worker.id, "continue"), /worker_cancelled/);
});

test("sendBatch limits active worker turns to four and preserves result order", async () => {
  let active = 0;
  let peak = 0;
  const manager = new HostWorkerManager(capabilities, {
    runTurn: async ({ message }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return {
        finalResponse: `done:${message}`,
        history: [],
      };
    },
  });
  const workers = Array.from({ length: 8 }, (_, index) => manager.create({
    ...createInput(),
    key: `worker-${index}`,
  }));

  const results = await manager.sendBatch(
    workers.map((worker, index) => ({ workerId: worker.id, message: `task-${index}` })),
  );

  assert.equal(peak, 4);
  assert.deepEqual(
    results.map((result) => result.finalResponse),
    Array.from({ length: 8 }, (_, index) => `done:task-${index}`),
  );
});

test("sendBatch rejects more than eight sends and duplicate worker ids", async () => {
  const manager = new HostWorkerManager(capabilities, {
    runTurn: async ({ message }) => ({ finalResponse: message, history: [] }),
  });
  const worker = manager.create(createInput());

  await assert.rejects(
    () => manager.sendBatch(Array.from({ length: 9 }, (_, index) => ({
      workerId: worker.id,
      message: `task-${index}`,
    }))),
    /host_worker_batch_limit/,
  );
  await assert.rejects(
    () => manager.sendBatch([
      { workerId: worker.id, message: "a" },
      { workerId: worker.id, message: "b" },
    ]),
    /duplicate_worker_id/,
  );
});
