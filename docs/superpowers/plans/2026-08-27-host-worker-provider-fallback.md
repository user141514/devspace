# Host Worker Provider Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `host_worker_*` execute real independent Codex-backed workers when MCP sampling is unavailable, with Pi/Claude fallback only under explicit provider policy.

**Architecture:** Preserve the existing session-scoped `HostWorkerManager` and native `HostWorkerRuntime`. Add a provider-backed runtime that delegates to the existing `LocalAgentClient`/daemon boundary and a small execution router that chooses native sampling when available, otherwise Codex-first local execution. Extend provider errors with a conservative machine-readable quota code so routing never hides generic Codex failures.

**Tech Stack:** TypeScript, Node.js, existing `LocalAgentClient` daemon protocol, Codex app-server driver, Pi/Claude drivers, MCP SDK, `node:test` + `assert`.

**Spec:** `docs/host-worker-provider-fallback-design.md`

## Global Constraints

- Keep the public `host_worker_*` tool names and basic lifecycle semantics stable.
- Codex is the primary local provider.
- A generic Codex failure MUST NOT trigger fallback.
- Codex may fall through only on `PROVIDER_QUOTA_EXHAUSTED`.
- Missing/unconfigured/unauthenticated Codex is reported as a setup failure, not quota exhaustion.
- Pi may fall through to Claude only on explicit quota exhaustion or provider unavailability; generic Pi execution/protocol failures remain visible.
- Reuse `LocalAgentClient -> daemon -> LocalAgentManager -> provider driver`; do not launch provider processes directly from Host Worker code.
- Maximum Host Worker concurrency remains four active turns and eight sends per batch.
- Existing MCP-native sampling remains preferred when the client actually advertises sampling.
- Existing local-agent and Orca behavior must remain unchanged.
- Every production behavior change follows red-green TDD.

---

### Task 1: Machine-readable quota failure contract

**Files:**
- Modify: `src/local-agent-errors.ts`
- Modify: `src/local-agent-codex.ts`
- Modify: `src/local-agent-codex.test.ts`
- Modify: `src/local-agent-errors.test.ts` if present; otherwise extend the nearest provider-error test seam.

**Interfaces:**
- Produces: `AgentProviderQuotaExhaustedError` with code `PROVIDER_QUOTA_EXHAUSTED`.
- Produces: `isProviderQuotaExhaustedMessage(message: string): boolean` or an equivalent narrow Codex classifier exported for direct testing.

- [ ] **Step 1: Write a failing Codex classifier test** asserting recognized quota/usage-limit text maps to `PROVIDER_QUOTA_EXHAUSTED`, while auth/network/protocol/generic failure text does not.
- [ ] **Step 2: Run** `npx tsx src/local-agent-codex.test.ts` and confirm the new assertion fails because quota classification does not exist.
- [ ] **Step 3: Add `AgentProviderQuotaExhaustedError`** to the provider error union, payload serialization/deserialization, predicates, and display paths.
- [ ] **Step 4: Update Codex failed-turn handling** so only positively classified quota evidence throws the quota error; otherwise preserve `PROVIDER_EXECUTION_ERROR`.
- [ ] **Step 5: Run** `npx tsx src/local-agent-codex.test.ts` plus relevant error/protocol tests and confirm green.

### Task 2: Provider-backed Host Worker runtime

**Files:**
- Create: `src/host-worker-provider-runtime.ts`
- Create: `src/host-worker-provider-runtime.test.ts`
- Modify: `src/host-worker-types.ts`

**Interfaces:**
- Consumes: `LocalAgentClient.start()`, `LocalAgentClient.get()`, Host Worker task packet/history/message.
- Produces: `HostWorkerProviderRuntime.runTurn(input)` matching `HostWorkerTurnRuntime` semantics.
- Produces internal attempt evidence `{ provider, agentId, outcome }` for deterministic routing/debugging without changing provider process ownership.

- [ ] **Step 1: Write a failing runtime test** with a fake LocalAgent client: Codex start returns a running record, polling returns idle with response; assert result provider is Codex and no Pi/Claude request occurs.
- [ ] **Step 2: Run** `npx tsx src/host-worker-provider-runtime.test.ts` and verify RED.
- [ ] **Step 3: Implement minimal Codex execution** via client start/poll, workspace scope, cancellation checks, and bounded polling timeout.
- [ ] **Step 4: Add failing test**: Codex generic execution error must terminate with no Pi/Claude attempt.
- [ ] **Step 5: Implement strict generic-error propagation** and verify green.
- [ ] **Step 6: Add failing test**: Codex quota error triggers Pi; Pi success completes the same Host Worker turn.
- [ ] **Step 7: Implement Codex quota-only fallback** and verify green.
- [ ] **Step 8: Add failing tests**: Pi quota/unavailable triggers Claude; Pi generic failure does not; Claude failure terminates.
- [ ] **Step 9: Implement the exact fallback table** and verify green.

### Task 3: Native-vs-provider execution router

**Files:**
- Create: `src/host-worker-execution-router.ts`
- Create: `src/host-worker-execution-router.test.ts`
- Modify: `src/host-worker-manager.ts`
- Modify: `src/host-worker-manager.test.ts`

**Interfaces:**
- Consumes: current `HostWorkerCapabilities`, native `HostWorkerRuntime`, provider `HostWorkerProviderRuntime`.
- Produces: one `runTurn()` runtime used by `HostWorkerManager`.

- [ ] **Step 1: Write a failing router test**: `sampling=true` selects native runtime and never calls provider runtime.
- [ ] **Step 2: Write a failing router test**: `sampling=false` selects provider runtime.
- [ ] **Step 3: Run** `npx tsx src/host-worker-execution-router.test.ts` and verify RED.
- [ ] **Step 4: Implement the minimal router** with capability lookup per turn.
- [ ] **Step 5: Modify Host Worker creation gating** so `sampling=false` is allowed only when provider-backed execution is available; `requireTools` remains native-tool-specific until a provider-backed tool contract is explicitly added.
- [ ] **Step 6: Update manager tests** for provider-backed creation/send behavior and verify green.

### Task 4: Server wiring and capability truthfulness

**Files:**
- Modify: `src/server.ts`
- Modify: `src/server.test.ts`
- Modify: `src/host-worker-types.ts`
- Modify: `src/host-worker-types.test.ts`

**Interfaces:**
- Consumes: `createLocalAgentClient(config)` or an injected equivalent appropriate to `createMcpServer`.
- Produces truthful capability output distinguishing native sampling from local-provider worker execution.

- [ ] **Step 1: Write a failing server test** showing a client with `sampling=false` can create/send a Host Worker when provider runtime availability is injected true.
- [ ] **Step 2: Write a failing capability test** for explicit provider-backed availability/mode while preserving existing sampling fields.
- [ ] **Step 3: Run** focused server/type tests and verify RED.
- [ ] **Step 4: Wire the provider client/runtime/router** into `createMcpServer()` without making LocalAgentManager process-global.
- [ ] **Step 5: Update `host_workers_capabilities`** to report actual executable mode/availability.
- [ ] **Step 6: Run** `npx tsx src/server.test.ts`, host-worker tests, local-agent daemon/client tests and verify green.

### Task 5: Codex CLI installation and account gate

**Files:**
- No repository source change required unless setup documentation is proven necessary.

**Interfaces:**
- Produces a supported local `codex` executable with `app-server` and a valid local ChatGPT login.

- [ ] **Step 1: Install** the official `@openai/codex` CLI into the user's existing npm prefix.
- [ ] **Step 2: Run** `codex --version` and `codex app-server --help`; both must exit successfully.
- [ ] **Step 3: Inspect auth state without printing credentials.** Reuse existing local Codex login if valid; otherwise invoke the CLI login flow and complete the local authorization gate.
- [ ] **Step 4: Run a minimal Codex CLI/app-server-backed DevSpace local-agent task** in the current workspace and observe a terminal response.

### Task 6: Regression, build, deployment, and live MCP gate

**Files:**
- Modify: `package.json` only if new test files are not already included by the test script.
- Modify: `docs/host-worker-provider-fallback-design.md` only to record verified behavior, not to redefine success.

**Interfaces:**
- Produces a deployed local DevSpace service built from this checkout and a fresh MCP session exercising the real path.

- [ ] **Step 1: Run focused tests** for host worker, Codex, local-agent client/daemon, and provider routing.
- [ ] **Step 2: Run** `npm run typecheck`.
- [ ] **Step 3: Run** full `npm test`.
- [ ] **Step 4: Run** `npm run build` and `git diff --check`.
- [ ] **Step 5: Install the built checkout into the existing local npm prefix and restart `devspace.service`.
- [ ] **Step 6: Confirm the service process resolves to the updated global package and health/logs are normal.
- [ ] **Step 7: Open/use a fresh MCP plugin session if the tool schema changed; otherwise create a fresh MCP session against the restarted service.
- [ ] **Step 8: Live gate:** with ChatGPT sampling unavailable, create at least two Host Workers, send distinct inspection tasks through `host_workers_send_batch`, verify both complete and their underlying provider sessions are distinct Codex sessions.
- [ ] **Step 9: Verify fallback policy with deterministic tests:** generic Codex error never falls back; quota error does. Do not burn real quota merely to trigger the fallback gate.
- [ ] **Step 10: Re-run full verification, inspect `git status`, commit coherent implementation changes, and report exact verified capability boundaries.
