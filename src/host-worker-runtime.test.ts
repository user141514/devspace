import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CreateMessageRequestSchema,
  type SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import { HostWorkerRuntime } from "./host-worker-runtime.js";

test("text-only sampling preserves worker context across follow-up sends", async (t) => {
  const server = new McpServer({ name: "host-worker-runtime-test", version: "1.0.0" });
  const client = new Client({ name: "sampling-client", version: "1.0.0" });
  client.registerCapabilities({ sampling: {} });

  const observed: SamplingMessage[][] = [];
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    observed.push(request.params.messages);
    return {
      model: "test-model",
      role: "assistant",
      content: {
        type: "text",
        text: `response-${observed.length}`,
      },
      stopReason: "endTurn",
    };
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  t.after(async () => {
    await client.close();
    await server.close();
  });

  const runtime = new HostWorkerRuntime(server);
  const first = await runtime.runTurn({
    taskPacket: "Goal: inspect runtime lifecycle.\nWorkspace: /tmp/project",
    history: [],
    message: "Start with shutdown behavior.",
    signal: new AbortController().signal,
  });

  assert.equal(first.finalResponse, "response-1");
  assert.equal(observed.length, 1);
  assert.equal(observed[0].length, 1);
  const firstContent = observed[0][0].content;
  assert.equal(Array.isArray(firstContent), false);
  assert.match((firstContent as { type: "text"; text: string }).text, /Goal: inspect runtime lifecycle/);
  assert.match((firstContent as { type: "text"; text: string }).text, /Start with shutdown behavior/);

  const second = await runtime.runTurn({
    taskPacket: "Goal: inspect runtime lifecycle.\nWorkspace: /tmp/project",
    history: first.history,
    message: "Now inspect restart behavior.",
    signal: new AbortController().signal,
  });

  assert.equal(second.finalResponse, "response-2");
  assert.equal(observed.length, 2);
  assert.equal(observed[1].length, 3);
  assert.equal(observed[1][0].role, "user");
  assert.equal(observed[1][1].role, "assistant");
  assert.equal(observed[1][2].role, "user");
  const followUp = observed[1][2].content;
  assert.equal(Array.isArray(followUp), false);
  assert.equal((followUp as { type: "text"; text: string }).text, "Now inspect restart behavior.");
});
