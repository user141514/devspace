---
name: devorder
description: Use when modifying repository code or files for a bounded task where working behavior, existing design, or adjacent technical debt must not be changed without explicit need.
---

# DevOrder

Read broadly. Modify narrowly.

Broad investigation is allowed when it improves correctness. A finding does not authorize a change.

## Change authorization

Before modifying anything, classify the candidate change:

- **REQUIRED** — necessary for the user's requested outcome, or necessary to fix observable current failure: a red test, build/runtime failure, violated contract/invariant, or incorrect requested behavior. Modify it.
- **CONCRETE RISK** — a specific known near-term execution path will fail with the current implementation. Modify only what is needed for that concrete risk.
- **DEBT** — duplication, awkward naming, code smell, nicer architecture, extra generality, cleanup, or hypothetical future improvement. You may report it; do not modify it.

General cleanup conventions such as "leave code cleaner than you found it" do not expand a bounded user's mutation scope. Apply them only inside changes already authorized above.

## Mutation rules

1. Preserve the existing architecture unless changing it is itself required.
2. Prefer the smallest coherent diff that satisfies the authorized outcome.
3. Do not opportunistically refactor, rename, reorganize, generalize, optimize, or clean adjacent working code.
4. Do not turn verification findings into new implementation work automatically.
5. Necessary root-cause fixes are allowed even when they cross files; unrelated cleanup is not.
6. If tests are red, fix the authorized root cause until they are green.
7. Once the requested outcome is achieved, tests are green, and no concrete known near-term failure remains, stop.

"Cleaner", "more consistent", "more reusable", and "more elegant" are not change authorization by themselves.

## Done

The requested outcome works with the minimum coherent disturbance to the existing system.

Technical debt can be reported separately without being paid down now.
