# Pi Batch V1 Design

**Goal:** Let the host fan out small read-only investigations to Pi in real parallel, then fan the final responses back in for the host to judge and integrate.

## Decisions

1. **Batch-first API.** V1 exposes only `pi_batch_start`, `pi_batch_status`, and `pi_batch_results`. There is no separate single-run Pi tool; one task is a one-item batch.
2. **Pi-first, host-controlled orchestration.** The host decides when Pi is worth using, may fan out independent evidence tasks without an extra user confirmation, and remains the only reducer and final authority.
3. **Hard read-only boundary.** `pi_batch_start` has no permission parameter. Every worker runs through the existing Pi adapter with `writeMode: "read_only"`; the Pi adapter must translate that to a read-only Pi tool allowlist. Pi may read broadly across the workspace to improve audit accuracy, but cannot mutate repository state.
4. **True parallel start.** A batch contains 1-8 independent tasks and starts them concurrently. V1 rejects batches larger than 8 rather than implementing a scheduler or queue.
5. **Thin request contract.** Start input is `workspaceId` plus `tasks: { id, prompt }[]`. Status reports only batch/worker lifecycle. Results return each worker's final response and terminal status. DevSpace does not synthesize or vote over worker answers.
6. **Reuse existing Pi runtime.** Do not create a second Pi execution stack. Workers call the current `PiRpcLocalAgentAdapter`/`runLocalAgentProvider` path; batch state is only the minimal grouping/lifecycle needed by the three tools.
7. **Modification discipline lives in `devorder`.** DevSpace seeds the `devorder` skill for modification-capable hosts/agents. Its rule is broad investigation, narrow mutation: current failures and concrete required risks authorize changes; green working code and technical debt do not. Pi batch itself remains read-only, so this policy is not a substitute for the hard tool boundary.
8. **Delegation guidance matches the new policy.** The existing subagent-delegation guidance should distinguish autonomous read-only Pi evidence fan-out from heavier or write-capable second-model delegation. Claude and other providers are outside this feature.

## API shape

```text
pi_batch_start({
  workspaceId,
  tasks: [
    { id: "docs", prompt: "..." },
    { id: "config", prompt: "..." }
  ]
})
→ { batchId, workers: [{ id, status }] }

pi_batch_status({ batchId })
→ { batchId, status, workers: [{ id, status }] }

pi_batch_results({ batchId })
→ { batchId, status, results: [{ id, status, result?, error? }] }
```

Worker ids must be unique within a batch. `pi_batch_start` returns after workers have been launched, not after they finish.

## Non-goals

V1 does **not** add A2A messaging, worker spawning, dependency DAGs, snapshot-consistency guarantees, distributed locks, consensus, automatic result schemas, write-capable Pi batches, merge protocols, cross-worker steering, or Claude fallback. Batch state need not survive a DevSpace server restart.

## Verification

Implementation is complete when tests prove: all workers are launched before any result is awaited; a 9-task batch is rejected; Pi read-only runs receive only the intended read tools; one worker failure does not erase sibling results; status/results reflect mixed worker states; and a real two-worker Pi smoke test can inspect the same workspace concurrently without modifying it.
