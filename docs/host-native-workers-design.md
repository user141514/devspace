# Host-Native Workers Design

Date: 2026-08-27
Status: Proposed

## 1. Summary

DevSpace will add a host-native worker execution path that delegates bounded worker reasoning back to the current MCP host through `sampling/createMessage` instead of starting an external Pi, Claude, OpenCode, Codex, Grok, Cursor, or Copilot provider session.

The resulting execution model has three independent layers:

1. **Host-native workers** — lightweight fan-out using the current MCP client's sampling capability.
2. **DevSpace local agents** — independent provider-backed sessions for Pi, Claude, OpenCode, Codex, and other configured providers.
3. **Orca** — higher-level DAG, dependency, gate, and multi-worker orchestration.

Host-native workers do not replace local agents or Orca. They fill the missing low-cost fan-out layer while preserving DevSpace's rule that the host remains the orchestrator.

## 2. Goals

- Let the current MCP host execute multiple bounded worker tasks without DevSpace launching an additional provider-backed agent.
- Support true parallel fan-out when the host supports MCP sampling.
- Support genuine call-now/fetch-later background workers only when the host advertises task-augmented `sampling/createMessage`.
- Let coding workers inspect the current DevSpace workspace through a small read-only tool set when the host advertises sampling tool support.
- Keep worker lifecycle, capability, status, result, and failure explicit and inspectable.
- Bind every host worker to the MCP client/session that created it so sampling is never routed to the wrong host.
- Fail explicitly when a required host capability is unavailable. Never silently fall back to an external provider.

## 3. Non-goals

- No write-capable host workers in V1.
- No Bash or arbitrary command execution from host workers in V1.
- No attempt to copy the full parent conversation into a worker.
- No guarantee that host-side sampling uses the exact same hidden model instance or hidden conversation state as the parent turn. DevSpace requests sampling from the current MCP client; model selection, quota, and accounting remain host policy.
- No replacement of DevSpace local-agent sessions.
- No replacement or reimplementation of Orca DAG semantics.
- No automatic fallback from host workers to Pi/Claude/etc.
- No restoration of the previous Claude-native `agents` profile patch as part of this change. That invariant is orthogonal and can be ported separately onto the new local-agent driver architecture.

## 4. Terminology and ownership

### Host

The MCP client connected to the current DevSpace server session, such as ChatGPT or another MCP-capable coding host.

### Host worker

A bounded reasoning job whose model invocation is requested through the current MCP client's `sampling/createMessage` capability.

### Local agent

An existing DevSpace provider-backed worker managed by the local-agent daemon/runtime, such as Pi or Claude.

### Orca worker

A worker participating in Orca's higher-level orchestration/DAG protocol.

The ownership boundary is:

```text
Host orchestrator
  |
  +-- Host-native worker -> MCP sampling -> current host model
  |
  +-- DevSpace local agent -> local-agent runtime -> configured provider
  |
  +-- Orca -> DAG / dependencies / gates -> workers
```

## 5. Capability model

Capabilities are evaluated per MCP session from `server.server.getClientCapabilities()`.

DevSpace exposes four meaningful levels:

| Capability | Meaning | Available behavior |
| --- | --- | --- |
| no `sampling` | Host cannot sample | Host workers unavailable |
| `sampling` | Host can reason over supplied context | Reasoning-only worker |
| `sampling.tools` | Host can return tool calls during sampling | Read-only coding worker |
| `tasks.requests.sampling.createMessage` | Host supports task-augmented sampling | Genuine background worker lifecycle |

`sampling.tools` and task-augmented sampling are independent capability checks.

The capability result should expose at least:

```ts
interface HostWorkerCapabilities {
  sampling: boolean;
  tools: boolean;
  taskSampling: boolean;
  background: boolean;
  maxConcurrency: number;
}
```

`background` is true only when task-augmented sampling is available and the server can maintain the required session-bound request lifecycle.

## 6. Session binding

The current server creates one `McpServer` for each initialized `StreamableHTTPServerTransport`. Host-worker state must follow that same boundary.

`HostWorkerManager` is therefore created inside or immediately adjacent to `createMcpServer(...)` and captures that specific `McpServer` instance. It must not be a process-global singleton.

This guarantees:

- `createMessage(...)` targets the MCP client that owns the current transport;
- capabilities are read from the correct client;
- a worker cannot leak from one ChatGPT/host session into another;
- transport/server shutdown can cancel or fail outstanding workers deterministically.

Workspace identity remains separate. Each task includes a `workspaceId`, resolved through the existing `WorkspaceRegistry` before any tool execution.

## 7. Public MCP surface

V1 exposes worker objects and communication primitives. DevSpace does not expose routing, planning, dependency, coordinator, or DAG APIs for host-native workers; the MCP host owns those decisions.

### `host_workers_capabilities`

Returns the current MCP session's sampling/tool/task capabilities and DevSpace concurrency limit.

It performs no model invocation.

### `host_worker_create`

Creates one logical host worker bound to a workspace and returns its stable worker ID without invoking the model.

Input shape:

```ts
interface HostWorkerCreateInput {
  workspaceId: string;
  key?: string;
  goal: string;
  context?: string;
  constraints?: string[];
  expectedOutput?: string;
  requireTools?: boolean;
}
```

Creation validates the workspace and required host capabilities. The worker starts in `idle` state with an isolated message history containing its task packet.

### `host_worker_send`

Sends a message to an existing worker and waits for that worker turn to complete.

```ts
interface HostWorkerSendInput {
  workerId: string;
  message: string;
}
```

The worker keeps its previous sampling/tool history, so this is a real follow-up in the same logical worker context rather than a new worker invocation.

### `host_workers_send_batch`

A thin concurrency primitive that performs multiple `host_worker_send` operations concurrently up to the per-session concurrency limit.

```ts
interface HostWorkersSendBatchInput {
  sends: Array<{
    workerId: string;
    message: string;
  }>;
}
```

This is convenience only. It does not classify, route, decompose, or order tasks beyond bounded parallel scheduling.

### `host_worker_get`

Reads the current snapshot for one worker ID.

```ts
type HostWorkerStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface HostWorkerSnapshot {
  id: string;
  key?: string;
  workspaceId: string;
  status: HostWorkerStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  finalResponse?: string;
  error?: string;
}
```

`completed` means the latest requested turn completed successfully. A completed worker may receive another `host_worker_send`, which transitions it back through queued/running and preserves its prior worker context.

### `host_worker_cancel`

Cancels a queued/running worker when possible and prevents further local tool-loop continuation. A cancelled worker does not accept additional sends.

### Optional task-backed background send

True call-now/fetch-later execution is an extension of `host_worker_send`, not a separate routing system. It is enabled only when task-augmented `sampling/createMessage` is advertised. V1 may expose this as `background: true` on send or a narrowly named background-send tool after the synchronous worker-object path is proven. DevSpace must not emulate background execution with an untracked detached Promise.

## 8. Worker task packet

A worker never receives the entire parent conversation automatically.

DevSpace constructs a compact task packet containing:

- worker goal;
- workspace identity/root description;
- supplied relevant context;
- constraints;
- expected output;
- explicit read-only tool policy;
- instruction to distinguish evidence from inference.

This keeps worker context bounded and makes fan-out cheaper and easier to inspect.

## 9. Read-only tool loop

When `sampling.tools` is available, a host worker may use a fixed internal read-only coding tool set:

- `read`
- `grep`
- `find` (glob-style file discovery)
- `ls`

The implementation should reuse Pi coding-agent primitives where possible (`createReadTool`, `createGrepTool`, `createFindTool`, `createLsTool`) and preserve DevSpace workspace containment checks. It should not implement a second raw filesystem stack.

V1 does not expose:

- write
- edit
- patch
- Bash
- arbitrary process execution

### Loop

1. Build the worker task packet and tool definitions.
2. Call session-bound `sampling/createMessage`.
3. If the host returns text only, finalize the worker.
4. If the host returns one or more `tool_use` blocks, validate every tool name and input.
5. Execute allowed read-only tools against the resolved workspace.
6. Append matching `tool_result` blocks.
7. Call sampling again with the updated worker message history.
8. Repeat until a terminal text response, cancellation, protocol failure, or turn limit.

The loop must preserve MCP tool-use/tool-result pairing exactly.

## 10. Concurrency and orchestration

V1 default maximum concurrency is four active host-worker turns per MCP session.

`HostWorkerManager` owns only execution mechanics:

- worker object creation and lookup;
- bounded send queueing;
- concurrency permits;
- worker lifecycle state;
- cancellation tokens;
- worker message/result retention;
- shutdown handling.

The host owns all intelligence above those primitives: decomposition, routing, deciding which worker to contact, deciding when to ask a follow-up, cross-feeding findings between workers, and final fan-in. DevSpace does not hide a planner or router inside the worker manager.

The communication topology is intentionally host-centered:

```text
           worker A
              ^
              |
worker B <-> Host <-> worker C
              |
              v
           worker D
```

Workers do not communicate directly in V1. If worker A's result should influence worker B, the host explicitly sends that evidence to worker B. This keeps coordination inspectable and prevents autonomous hidden worker conversations.

This is deliberately simpler than Orca. If tasks need dependency edges, blocking gates, worker-to-worker messaging, publish/subscribe, or multi-stage coordinator loops, the host should use Orca instead.

## 11. Background semantics

Background execution is protocol-driven, not simulated, and is secondary to the worker-object/send contract.

When the client advertises `tasks.requests.sampling.createMessage`, DevSpace may use the SDK task-augmented sampling path (`server.experimental.tasks.createMessageStream(...)` with task creation options) for a send that explicitly requests background execution.

The manager maps the existing DevSpace worker ID to host-side task lifecycle data and continues draining task status/result events until the requested worker turn reaches terminal state. The same logical worker ID remains reusable for later follow-ups.

A multi-turn tool-using worker may require more than one sampling request. DevSpace keeps one logical worker ID across those requests and remains `running` until the whole tool loop finishes.

When task-augmented sampling is absent:

- normal `host_worker_send` remains available and waits for the worker turn;
- `host_workers_send_batch` still provides concurrent fan-out while the caller waits;
- any explicit background-send request returns `background_not_supported`;
- DevSpace does not silently detach a normal sampling request and call it background work.

## 12. Error model

Errors must identify the boundary that failed.

Suggested categories:

- `sampling_not_supported`
- `sampling_tools_not_supported`
- `background_not_supported`
- `workspace_not_found`
- `worker_not_found`
- `worker_cancelled`
- `tool_not_allowed`
- `tool_input_invalid`
- `tool_execution_failed`
- `sampling_protocol_error`
- `sampling_timeout`
- `worker_turn_limit`
- `transport_closed`

The original host/protocol error should be retained in logs or structured diagnostic detail where safe.

No error path may automatically start a configured local agent.

## 13. Limits

Initial conservative limits:

- maximum concurrent host workers per MCP session: 4;
- maximum tasks per batch: 8;
- maximum sampling/tool-loop turns per worker: 12;
- maximum retained terminal workers per session: bounded FIFO, initially 100;
- worker results are text-first and size-limited before being returned to the parent host.

These should start as internal constants. Configuration is deferred until a real use case requires tuning.

## 14. Lifecycle and shutdown

When the MCP server/session closes:

- abort queued and running DevSpace host workers;
- stop local tool loops;
- stop requesting further sampling turns;
- mark non-terminal worker state as cancelled/failed with `transport_closed`;
- release in-memory state when the session is destroyed.

V1 does not persist host-worker state across MCP session/server restart because the worker's execution authority belongs to that live host session.

## 15. Code boundaries

Proposed modules:

- `src/host-worker-manager.ts` — queue, concurrency, lifecycle, background state.
- `src/host-worker-runtime.ts` — sampling request/tool-loop logic and task-augmented sampling adapter.
- `src/host-worker-tools.ts` — read-only tool definitions, validation, workspace-contained execution.
- `src/host-worker-types.ts` — task/capability/status/result contracts when shared types justify a separate file.
- `src/server.ts` — session-bound construction and MCP tool registration only.

The implementation should not modify local-agent provider drivers unless a shared utility is genuinely reusable without coupling the two execution models.

## 16. Testing strategy

### Unit tests

`host-worker-runtime`:

- text-only sampling completes;
- tool-use/result loop is paired correctly;
- unknown tools are rejected;
- turn limit stops runaway loops;
- sampling errors preserve boundary information;
- cancellation stops subsequent sampling calls.

`host-worker-tools`:

- read/grep/find/ls work inside workspace;
- traversal/outside-root access is rejected;
- mutation tools are unavailable;
- malformed inputs fail before execution.

`host-worker-manager`:

- concurrency never exceeds four;
- queued/running/completed/failed/cancelled transitions are valid;
- batch fan-out preserves task keys;
- shutdown aborts outstanding workers;
- completed-state retention is bounded.

### Server contract tests

- capability output reflects mocked MCP client capabilities;
- `host_worker_create` validates workspace and sampling requirements;
- `requireTools` gates on `sampling.tools`;
- `host_worker_send` preserves one worker ID and context across follow-up turns;
- `host_workers_send_batch` runs independent worker turns concurrently without routing logic;
- any explicit background send gates on task-augmented sampling;
- worker IDs are scoped to their MCP session;
- no host worker can read another workspace outside its explicit workspace boundary.

### Regression gate

Because this touches the MCP server/session lifecycle, treat it as L2:

- focused host-worker tests;
- `npm run typecheck`;
- full `npm test`;
- `npm run build`;
- `git diff --check`.

### Real live gates

At least two real MCP-host gates are required before claiming the feature works end to end:

1. **Capability gate** — from an actual ChatGPT-connected DevSpace session, verify the client capabilities actually advertised for sampling, tools, and task-augmented sampling.
2. **Behavior gate** — run a real multi-worker task against a small repository and verify:
   - two or more workers execute concurrently when supported;
   - read-only tool calls reach the intended workspace;
   - the parent host receives distinct worker results;
   - no Pi/Claude/etc provider session is created;
   - if task sampling is advertised, background start/get works after the initiating tool call returns.

If ChatGPT does not advertise one of the required capabilities, report that boundary exactly instead of redefining the gate as passed.

## 17. Rollout sequence

1. Add capability detection and tests.
2. Add session-scoped worker creation/get/cancel with stable worker IDs.
3. Add text-only `host_worker_send` and prove follow-up context continuity.
4. Add `host_workers_send_batch` with a maximum of four concurrent worker turns.
5. Add the read-only sampling tool loop.
6. Add task-augmented background-send semantics only if the real host advertises support.
7. Run focused + full regression gates.
8. Run real ChatGPT MCP capability and behavior gates.
9. Only after evidence from V1, consider write-capable host workers or additional orchestration primitives.

## 18. Success criteria

The feature is complete only when all of the following are true:

- DevSpace can fan out at least two host-native worker tasks through MCP sampling in a real supported host.
- Workers can inspect workspace code through read-only tools when sampling tools are supported.
- No DevSpace external provider session is created during the host-native path.
- Background execution is exposed only when the host actually supports task-augmented sampling.
- Worker lifecycle and failures are inspectable and session-scoped.
- Existing local-agent and normal DevSpace coding workflows remain unchanged.
- L2 regression and real live gates pass.
