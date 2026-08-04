# Agent Profile Transparency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Claude local agents at their existing maximum permission while making project-over-user profile precedence explicit and exposing native subagent configuration to the host.

**Architecture:** The profile loader preserves both user and project profiles, annotates each with scope and a qualified name, and marks which profile is the default for a bare name. Target resolution accepts bare names and `project:`/`user:` qualified names. Workspace summaries expose profile source, precedence, effective Claude permission, and full native subagent definitions.

**Tech Stack:** TypeScript, Node.js, YAML, Zod, Anthropic Claude Agent SDK.

## Global Constraints

- Project profiles win for bare-name resolution.
- User profiles remain explicitly callable with `user:<name>`.
- Claude retains `permissionMode: "bypassPermissions"` and `allowDangerouslySkipPermissions: true`.
- Native subagent prompts, descriptions, tools, and models are model-visible.
- Existing persisted bare profile names remain resolvable.

---

### Task 1: Preserve profile scope and precedence

**Files:**
- Modify: `src/local-agent-profiles.ts`
- Test: `src/local-agent-profiles.test.ts`

- [ ] Add failing tests for a user and project profile with the same name.
- [ ] Verify both profiles are returned, the project profile is the default, and both have qualified names.
- [ ] Implement scope, qualified-name, default, shadows, and shadowed-by metadata.
- [ ] Run the profile tests.

### Task 2: Resolve qualified profiles consistently

**Files:**
- Modify: `src/local-agent-targets.ts`
- Modify: `src/cli.ts`
- Test: `src/local-agent-targets.test.ts`

- [ ] Add failing tests for bare-name project precedence and explicit `user:`/`project:` resolution.
- [ ] Store the resolved qualified name for new runs and resolve it again in workers.
- [ ] Keep legacy bare names compatible.
- [ ] Run target and CLI-adjacent tests.

### Task 3: Expose full native subagent configuration

**Files:**
- Modify: `src/local-agent-profiles.ts`
- Modify: `src/server.ts`
- Test: `src/local-agent-profiles.test.ts`

- [ ] Add failing summary assertions for source, precedence, full native subagent definitions, and Claude effective permission.
- [ ] Extend the MCP output schema and summary mapping.
- [ ] Run typecheck and relevant tests.

### Task 4: Document the actual model

**Files:**
- Modify: `docs/agent-profile-schema.md`
- Modify: `skills/subagent-delegation/SKILL.md`
- Modify: `examples/agents/claude-multi-agent-reviewer.md`

- [ ] Replace read-only security claims with read-oriented capability language.
- [ ] Document project-first precedence and qualified profile names.
- [ ] Document maximum Claude permission and transparent native subagent output.
- [ ] Run diff checks and final verification.
