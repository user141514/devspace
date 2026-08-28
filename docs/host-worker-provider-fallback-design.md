# Host Worker Provider Fallback Design

Date: 2026-08-27
Status: Approved

## Intent

Make the existing `host_worker_*` MCP surface execute real independent workers even when the connected MCP client does not support `sampling/createMessage`.

The primary execution backend is the local Codex CLI/app-server using the user's local Codex login. Pi and Claude are fallback providers, but Codex may fall through only when the failure is positively classified as quota/usage exhaustion. Generic Codex failures must remain visible and must not be hidden by fallback.

## Specification

### Public API

Keep the existing MCP surface unchanged:

- `host_workers_capabilities`
- `host_worker_create`
- `host_worker_send`
- `host_workers_send_batch`
- `host_worker_get`
- `host_worker_cancel`

No provider name is required from the MCP host for ordinary Host Worker use.

### Execution modes

A Host Worker turn selects one backend:

1. MCP-native sampling when the current client advertises `sampling`.
2. Local provider routing when MCP sampling is unavailable.

The local-provider route is:

```text
Codex
  ├─ success -> complete
  ├─ quota exhausted -> Pi
  └─ every other failure -> fail

Pi
  ├─ success -> complete
  ├─ quota exhausted/unavailable -> Claude
  └─ every other failure -> fail

Claude
  ├─ success -> complete
  └─ failure -> fail
```

The critical invariant is that **Codex generic failure never triggers fallback**.

### Provider identity

Host Worker identity and provider session identity are separate.

A stable `hw_*` worker may change providers after an allowed fallback. Provider-backed history is not silently resumed across different providers. A fallback starts a fresh provider session with a compact continuation prompt containing the worker task packet, current user message, and prior Host Worker-visible assistant history.

### Concurrency

`host_workers_send_batch` remains the bounded fan-out primitive. Provider-backed workers are independent local-agent sessions and may execute concurrently, subject to the existing Host Worker concurrency limit.

### Quota classification

Introduce a machine-readable provider error code:

```ts
PROVIDER_QUOTA_EXHAUSTED
```

Codex classification must be conservative and evidence-driven. Only recognized quota/usage-limit messages or structured app-server evidence may produce this code. Authentication, network, protocol, process, model, sandbox, configuration, and unknown execution errors are not quota exhaustion.

Pi/Claude may use the same code when their adapters expose equivalent explicit evidence. Absence of a quota classifier does not justify broad fallback.

### Local-agent reuse

Do not embed Codex/Pi/Claude process logic inside `HostWorkerManager` or `HostWorkerRuntime`.

Reuse the existing boundary:

```text
HostWorker provider runtime
  -> LocalAgentClient
  -> local-agent daemon
  -> LocalAgentManager
  -> LocalAgentRuntimePool
  -> provider driver
```

This preserves current workspace authorization, provider configuration, runtime pooling, lifecycle, and provider adapters.

### Provider availability

Codex is primary only when configured/enabled and locally available. The target machine must have a supported `codex app-server` CLI and valid local login.

The implementation must not treat `codex` missing or unauthenticated as quota exhaustion. Those are setup failures and must be reported explicitly.

### Capabilities

`host_workers_capabilities` must describe actual executable behavior rather than only MCP client sampling flags. Add enough information to distinguish native sampling availability from provider-backed worker availability while preserving the current fields for compatibility.

### Verification contract

Success requires all of the following evidence:

1. Unit red/green coverage for quota classification and routing.
2. Existing host-worker/local-agent regressions pass.
3. Typecheck and build pass.
4. Codex CLI is installed and `app-server` is supported.
5. The local service is rebuilt/reinstalled/restarted from the current checkout.
6. A fresh MCP plugin session can create at least two Host Workers and complete a real batch using independent Codex-backed sessions when MCP sampling is unavailable.
7. A deliberately simulated generic Codex error does not fallback.
8. A deliberately simulated quota error does fallback according to policy.

## Non-goals

- Do not reimplement Orca routing or DAG semantics.
- Do not silently fall back on arbitrary provider failures.
- Do not make Pi or Claude primary while Codex is healthy.
- Do not claim MCP-native sampling when the worker actually used a local provider.
- Do not alter unrelated local-agent provider semantics.
