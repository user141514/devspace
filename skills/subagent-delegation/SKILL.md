---
name: subagent-delegation
description: Use when the user requests coding-agent delegation or when independent read-only Pi evidence work has clear parallel ROI.
---

# Subagent Delegation

Use this skill when the user explicitly asks to delegate work to another coding
agent, use a named subagent, get a second opinion, compare approaches, or when
independent read-only Pi evidence work has clear parallel ROI.

Read-only Pi evidence batches may be dispatched autonomously when the host judges
that parallelism has clear ROI; disclose their use when reporting the result.
Heavier, write-capable, or other second-model delegation keeps its existing
authorization requirements.

## Core commands

Use only these commands for normal delegation:

```bash
devspace agents ls
devspace agents run <profile-or-provider-or-id> "<prompt>"
devspace agents show <id>
```

`ls` shows existing subagent sessions for the current workspace. DevSpace scopes
it automatically from the shell environment injected by the workspace tool.

`run <profile> "<prompt>"` starts a new configured profile and prints a
DevSpace agent id.

`run <provider> "<prompt>"` starts a raw built-in provider when no configured
profile is needed. Built-in providers are listed by `open_workspace`.

`run <id> "<prompt>"` sends a follow-up to an existing agent.

`show <id>` prints status and the latest response. If the agent is still
running, `show` waits briefly. If there is still no final response, call `show`
again later.

Do not run provider CLIs such as `codex`, `claude`, `opencode`, `pi`,
`cursor-agent`, or `copilot` directly unless you are explicitly debugging
DevSpace agent integration.

## Choosing a profile

Choose profiles from the compact subagent profile catalog returned by
`open_workspace`. Use the profile name with `devspace agents run`. If no
profile fits and delegation is still appropriate, use a built-in provider name
from `open_workspace`.

Profiles may declare a model and optional thinking level. To override the
configured/default provider model or thinking level for a run, pass `--model`
or `--thinking`:

```bash
devspace agents run <profile-or-provider> --model <model> "<prompt>"
devspace agents run <profile-or-provider> --thinking <level> "<prompt>"
```

Use `--thinking` only when the user asks for a specific reasoning depth or when
the task clearly needs a different effort than the configured profile default.
Thinking values are provider-specific passthrough values. Use names supported by
the selected local agent harness; DevSpace does not translate values between
providers.

Good delegation targets:

- `reviewer`: second opinion, bug risk, security risk, test gaps.
- `explorer`: read-only codebase investigation.
- `implementer`: focused implementation when the user asked for delegation.

Do not delegate ordinary coding work just because a profile exists. Use normal
DevSpace tools unless the user asked for delegation, another agent's opinion,
parallel work, or a named subagent.

Some Claude profiles may declare native Claude subagents in their profile
configuration. Use such a profile when the user explicitly asks for one Claude
session to fan out across multiple specialized workers. Claude local-agent
sessions run with full local permission; native `tools` declarations describe
worker capabilities rather than a DevSpace sandbox. The command remains the same:

```bash
devspace agents run <claude-multi-agent-profile> "<parent task and explicit subtask assignments>"
```

Do not invoke `claude --agents` directly. The profile owns native agent
definitions and capability declarations; DevSpace owns the outer worker
lifecycle. `open_workspace` exposes each profile's scope, source path, shadowing
relationship, effective permission, and complete native subagent definitions.
Afterward, use `devspace agents show <id>` and independently verify the parent
agent's synthesized result.

## Worker prompts

Agents start with only the prompt you send plus their configured profile
instructions. Make prompts self-contained.

Implementation prompt shape:

```text
Goal:
<clear goal>

Context:
<repo/module/user constraints>

Relevant files:
<paths and why they matter>

Acceptance criteria:
- <criterion>

Rules:
- Keep changes focused.
- Do not perform unrelated refactors.
- Report blockers clearly.
```

Read-only investigation prompt shape:

```text
Question:
<specific question>

Scope:
<files/directories/modules to inspect>

Rules:
- Do not modify files.
- Cite relevant file paths and symbols.
- Separate facts from guesses.
```

## After the worker responds

Always review the result before presenting it as verified.

For write-capable tasks, inspect changed files and run or explain relevant
tests. For read-only tasks, verify that important claims are supported by repo
evidence.

Be transparent in the final response:

```text
I used <profile>. It reported <summary>. I verified <checks>. Remaining risk:
<risk or none>.
```

Never hide that a subagent was used.
