import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostWorkerCapabilities } from "./host-worker-types.js";

test("host worker capabilities are unavailable without sampling", () => {
  assert.deepEqual(resolveHostWorkerCapabilities(undefined), {
    sampling: false,
    tools: false,
    taskSampling: false,
    background: false,
    maxConcurrency: 4,
  });
});

test("sampling enables reasoning without tools or background", () => {
  assert.deepEqual(resolveHostWorkerCapabilities({ sampling: {} }), {
    sampling: true,
    tools: false,
    taskSampling: false,
    background: false,
    maxConcurrency: 4,
  });
});

test("sampling tools are reported independently from task sampling", () => {
  assert.deepEqual(resolveHostWorkerCapabilities({ sampling: { tools: {} } }), {
    sampling: true,
    tools: true,
    taskSampling: false,
    background: false,
    maxConcurrency: 4,
  });
});

test("task augmented sampling enables genuine background execution", () => {
  assert.deepEqual(resolveHostWorkerCapabilities({
    sampling: { tools: {} },
    tasks: {
      requests: {
        sampling: {
          createMessage: {},
        },
      },
    },
  }), {
    sampling: true,
    tools: true,
    taskSampling: true,
    background: true,
    maxConcurrency: 4,
  });
});
