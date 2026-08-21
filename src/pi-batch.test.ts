import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  MAX_PI_BATCH_WORKERS,
  PiBatchManager,
} from "./pi-batch.js";
import type {
  LocalAgentRunInput,
  LocalAgentRunResult,
} from "./local-agent-runtime.js";
import { registerPiBatchTools } from "./server.js";

function piResult(finalResponse: string): LocalAgentRunResult {
  return {
    provider: "pi",
    providerSessionId: null,
    finalResponse,
    items: [],
  };
}

interface DeferredRun {
  resolve: (value: LocalAgentRunResult) => void;
  reject: (error: Error) => void;
}

const calls: string[] = [];
const deferred = new Map<string, DeferredRun>();
const manager = new PiBatchManager((input: LocalAgentRunInput) => {
  calls.push(input.prompt);
  assert.equal(input.writeMode, "read_only");
  return new Promise<LocalAgentRunResult>((resolve, reject) => {
    deferred.set(input.prompt, { resolve, reject });
  });
});

const started = manager.start("/repo", [
  { id: "a", prompt: "first" },
  { id: "b", prompt: "second" },
]);

assert.match(started.batchId, /^pib_/);
assert.deepEqual(calls, ["first", "second"]);
assert.equal(started.status, "running");
assert.deepEqual(started.workers, [
  { id: "a", status: "running" },
  { id: "b", status: "running" },
]);

assert.throws(
  () => manager.start("/repo", []),
  /at least 1 task/i,
);
assert.throws(
  () => manager.start(
    "/repo",
    Array.from({ length: MAX_PI_BATCH_WORKERS + 1 }, (_, index) => ({
      id: `worker-${index}`,
      prompt: `prompt-${index}`,
    })),
  ),
  /at most 8 tasks/i,
);
assert.throws(
  () => manager.start("/repo", [
    { id: "duplicate", prompt: "one" },
    { id: "duplicate", prompt: "two" },
  ]),
  /duplicate worker id/i,
);

deferred.get("first")!.resolve(piResult("first-result"));
deferred.get("second")!.reject(new Error("second-failed"));
await Promise.resolve();
await Promise.resolve();

assert.deepEqual(manager.status(started.batchId), {
  batchId: started.batchId,
  status: "completed",
  workers: [
    { id: "a", status: "completed" },
    { id: "b", status: "error" },
  ],
});

assert.deepEqual(manager.results(started.batchId), {
  batchId: started.batchId,
  status: "completed",
  results: [
    { id: "a", status: "completed", result: "first-result" },
    { id: "b", status: "error", error: "second-failed" },
  ],
});

assert.throws(
  () => manager.status("pib_missing"),
  /Unknown Pi batch id: pib_missing/,
);
assert.throws(
  () => manager.results("pib_missing"),
  /Unknown Pi batch id: pib_missing/,
);

{
  const toolManager = new PiBatchManager(async (input) => piResult(`done:${input.prompt}`));
  const mcpServer = new McpServer({ name: "pi-batch-test-server", version: "1.0.0" });
  registerPiBatchTools(
    mcpServer,
    {
      getWorkspace(workspaceId: string) {
        assert.equal(workspaceId, "ws_test");
        return { root: "/repo" };
      },
    },
    toolManager,
    () => undefined,
  );

  const client = new Client({ name: "pi-batch-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    mcpServer.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      ["pi_batch_results", "pi_batch_start", "pi_batch_status"],
    );

    const start = await client.callTool({
      name: "pi_batch_start",
      arguments: {
        workspaceId: "ws_test",
        tasks: [{ id: "one", prompt: "inspect one" }],
      },
    });
    const startStructured = start.structuredContent as {
      batchId: string;
      status: string;
    };
    assert.match(startStructured.batchId, /^pib_/);

    await Promise.resolve();
    const results = await client.callTool({
      name: "pi_batch_results",
      arguments: { batchId: startStructured.batchId },
    });
    assert.deepEqual(results.structuredContent, {
      batchId: startStructured.batchId,
      status: "completed",
      results: [
        { id: "one", status: "completed", result: "done:inspect one" },
      ],
    });
  } finally {
    await client.close();
  }
}
