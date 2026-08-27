# Host-Native Workers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session-bound Host Worker objects that use MCP `sampling/createMessage` for reasoning, preserve independent worker context across `send` calls, support bounded parallel sends, and optionally use read-only workspace tools without launching Pi/Claude/Codex/OpenCode provider sessions.

**Architecture:** Each initialized `McpServer` owns one `HostWorkerManager`. The manager stores worker objects and delegates each worker turn to a `HostWorkerRuntime` bound to that same `McpServer`, so sampling always returns to the correct MCP client. DevSpace exposes only object/lifecycle/communication primitives; the MCP host remains the planner/router/coordinator.

**Tech Stack:** TypeScript, Node.js, `@modelcontextprotocol/sdk` 1.29.x sampling APIs, existing DevSpace `WorkspaceRegistry`, existing Pi coding-agent read-only primitives, `node:test` + `assert`.

**Spec:** `docs/host-native-workers-design.md`

## Global Constraints

- No external provider or CLI may be started by the Host Worker path.
- V1 Host Workers are read-only: no write/edit/patch/Bash/process execution.
- Host Worker state is scoped to one live MCP session and is not process-global or persisted across server restart.
- The Host owns decomposition, routing, follow-up decisions, cross-worker evidence transfer, and fan-in.
- Worker-to-worker direct communication is out of scope.
- Maximum four active worker turns per MCP session; maximum eight batch sends; maximum twelve sampling/tool-loop turns per worker turn.
- Missing sampling/tool/task capability must fail explicitly; no fallback to local agents.
- Preserve existing local-agent and Orca behavior unchanged.

---

### Task 1: Capability contract and capability MCP tool

**Files:**
- Create: `src/host-worker-types.ts`
- Create: `src/host-worker-types.test.ts`
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Produces: `HostWorkerCapabilities`, `resolveHostWorkerCapabilities(clientCapabilities)`, and MCP tool `host_workers_capabilities`.

- [ ] **Step 1: Write failing unit tests** for capability mapping: no sampling, sampling only, sampling+tools, and task-augmented sampling.
- [ ] **Step 2: Run** `npx tsx src/host-worker-types.test.ts` and verify failure because the module/API is absent.
- [ ] **Step 3: Implement** `resolveHostWorkerCapabilities()` with `{ sampling, tools, taskSampling, background, maxConcurrency: 4 }`.
- [ ] **Step 4: Run** `npx tsx src/host-worker-types.test.ts` and verify pass.
- [ ] **Step 5: Add failing server contract test** using `Client.registerCapabilities(...)` before connect; assert `host_workers_capabilities` appears and returns the client-advertised capability shape.
- [ ] **Step 6: Run** `npx tsx src/server.test.ts` and verify failure because the tool is absent.
- [ ] **Step 7: Register** `host_workers_capabilities` inside `createMcpServer()` using `server.server.getClientCapabilities()`; no model invocation.
- [ ] **Step 8: Run** focused tests and commit `feat: expose host worker capabilities`.

### Task 2: Session-scoped worker object lifecycle

**Files:**
- Create: `src/host-worker-manager.ts`
- Create: `src/host-worker-manager.test.ts`
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Consumes: `HostWorkerCapabilities`.
- Produces: `HostWorkerManager.create()`, `get()`, `cancel()`, `close()`, stable worker IDs and `HostWorkerSnapshot`.

- [ ] **Step 1: Write failing manager tests** for create→idle snapshot, unknown ID, cancel, closed manager, bounded terminal retention, and distinct manager/session ID isolation.
- [ ] **Step 2: Run** `npx tsx src/host-worker-manager.test.ts` and verify failure.
- [ ] **Step 3: Implement minimal manager state** with `Map`, `AbortController`, stable `hw_` IDs, `idle|queued|running|completed|failed|cancelled`, and terminal FIFO limit 100.
- [ ] **Step 4: Run manager tests** and verify pass.
- [ ] **Step 5: Add failing server tests** for `host_worker_create`, `host_worker_get`, `host_worker_cancel`; create must validate `workspaceId` through `WorkspaceRegistry` and reject when sampling is unavailable.
- [ ] **Step 6: Register the three MCP tools** and instantiate one manager inside `createMcpServer()` so each transport/server owns its own worker namespace.
- [ ] **Step 7: Run focused tests** and commit `feat: add session scoped host worker objects`.

### Task 3: Text-only sampling runtime and persistent send context

**Files:**
- Create: `src/host-worker-runtime.ts`
- Create: `src/host-worker-runtime.test.ts`
- Modify: `src/host-worker-manager.ts`
- Modify: `src/host-worker-manager.test.ts`
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Produces: `HostWorkerRuntime.runTurn(worker, message, signal)` and manager `send(workerId, message)`.
- MCP tool: `host_worker_send`.

- [ ] **Step 1: Write failing runtime test** with a real in-memory MCP `Client` advertising sampling and a `CreateMessageRequestSchema` request handler returning text; assert one sampling request receives the worker task packet plus sent message.
- [ ] **Step 2: Run** `npx tsx src/host-worker-runtime.test.ts` and verify failure.
- [ ] **Step 3: Implement minimal text-only runtime** calling the session-bound `mcpServer.server.createMessage({ messages, maxTokens })`, extracting terminal text and retaining sampling message history on the worker.
- [ ] **Step 4: Add failing follow-up test**: send twice to the same worker; the second sampling request must contain the first assistant response and the second user message.
- [ ] **Step 5: Implement context continuity** without copying the parent conversation.
- [ ] **Step 6: Add manager tests** for completed→queued→running→completed follow-up transitions and cancellation preventing later sends.
- [ ] **Step 7: Register `host_worker_send`** and add server end-to-end sampling test using an in-memory client request handler.
- [ ] **Step 8: Run focused tests** and commit `feat: add host worker sampling sends`.

### Task 4: Bounded parallel send primitive

**Files:**
- Modify: `src/host-worker-manager.ts`
- Modify: `src/host-worker-manager.test.ts`
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`

**Interfaces:**
- Produces: `HostWorkerManager.sendBatch([{ workerId, message }])` and MCP tool `host_workers_send_batch`.

- [ ] **Step 1: Write failing concurrency test** with a controllable runner that records active turns; create eight workers and verify peak active count is exactly four or less while all results map to the correct worker IDs.
- [ ] **Step 2: Run manager test** and verify failure.
- [ ] **Step 3: Implement a small semaphore/queue** inside the manager; reject batches over eight and duplicate simultaneous sends to the same worker.
- [ ] **Step 4: Add failing server batch test** proving two workers can be invoked through one MCP call and return distinct responses.
- [ ] **Step 5: Register `host_workers_send_batch`** as a thin wrapper around manager sends; add no planner/router logic.
- [ ] **Step 6: Run focused tests** and commit `feat: add parallel host worker sends`.

### Task 5: Read-only sampling tool loop

**Files:**
- Create: `src/host-worker-tools.ts`
- Create: `src/host-worker-tools.test.ts`
- Modify: `src/host-worker-runtime.ts`
- Modify: `src/host-worker-runtime.test.ts`

**Interfaces:**
- Produces fixed sampling tools `read`, `grep`, `find`, `ls`; runtime executes tool calls against the worker's resolved workspace root and appends exact MCP `tool_result` blocks.

- [ ] **Step 1: Write failing tool tests** for in-root read/grep/find/ls, malformed input, traversal/outside-root rejection, and absence of mutation tools.
- [ ] **Step 2: Run** `npx tsx src/host-worker-tools.test.ts` and verify failure.
- [ ] **Step 3: Implement tool definitions/execution** using existing Pi coding-agent primitives and DevSpace path containment; do not create a second raw filesystem policy layer.
- [ ] **Step 4: Write failing runtime tool-loop test** where the sampling client returns `tool_use`, receives matching `tool_result`, then returns final text.
- [ ] **Step 5: Implement the loop** with exact tool-use/result pairing, maximum 12 turns, cancellation checks between every sampling/tool step, and explicit unknown-tool/input/protocol errors.
- [ ] **Step 6: Add test** that `requireTools` creation fails when `sampling.tools` is unavailable.
- [ ] **Step 7: Run focused tests** and commit `feat: add read only host worker tools`.

### Task 6: Session shutdown and task-backed background capability boundary

**Files:**
- Modify: `src/host-worker-manager.ts`
- Modify: `src/host-worker-manager.test.ts`
- Modify: `src/server.ts`
- Modify: `src/server-shutdown.ts` only if the existing close path needs an explicit callback hook
- Modify: `src/server.test.ts`

**Interfaces:**
- Session/server close aborts all worker turns and clears session-owned state.
- Background execution remains unavailable unless `tasks.requests.sampling.createMessage` is advertised.

- [ ] **Step 1: Write failing shutdown test**: close manager/server while a sampling turn is blocked; verify the worker becomes cancelled/transport-closed and no subsequent sampling request is issued.
- [ ] **Step 2: Implement manager close integration** in the session-bound server close path.
- [ ] **Step 3: Write capability-boundary test** proving task sampling false never reports background support and no detached Promise path exists.
- [ ] **Step 4: If the SDK task path can be exercised deterministically in-memory**, add a failing test and implement explicit background-send support using `server.experimental.tasks.createMessageStream(..., { task: ... })`; otherwise leave background execution gated off and defer it to the real-host capability gate rather than simulating it.
- [ ] **Step 5: Run focused tests** and commit `feat: bind host workers to session lifecycle`.

### Task 7: Regression, docs, and real ChatGPT gates

**Files:**
- Modify: `package.json` test script to include new host-worker test files.
- Modify: `docs/host-native-workers-design.md` status/results section if capability evidence changes the supported surface.
- Modify: `docs/chatgpt-coding-workflow.md` with the final model-facing worker workflow only after behavior is verified.

**Interfaces:**
- Produces a verified package and an explicit record of the real ChatGPT capability boundary.

- [ ] **Step 1: Add all host-worker tests to `npm test`** and run `npm run typecheck`.
- [ ] **Step 2: Run full** `npm test`.
- [ ] **Step 3: Run** `npm run build` and `git diff --check`.
- [ ] **Step 4: Restart/use the actual local DevSpace service only if required to load the new build, then call `host_workers_capabilities` from this ChatGPT MCP session. Record exact advertised `sampling`, `sampling.tools`, and task-sampling capabilities.
- [ ] **Step 5: If sampling is advertised, create at least two workers, send them distinct repository inspection tasks concurrently, follow up with one worker, and verify no local-agent session is created.
- [ ] **Step 6: If sampling tools are advertised, verify one real read-only file/tool round trip. If task sampling is advertised, verify true background send/get semantics; otherwise report the unsupported boundary without redefining success.
- [ ] **Step 7: Run final full regression gate again, inspect `git status`/diff, and commit verified docs/test wiring.
