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
