# Subagent profile schema

DevSpace agent profiles are local markdown configuration files with YAML
frontmatter. They describe roles such as reviewer, explorer, or implementer.
DevSpace owns provider invocation. User profiles are local configuration;
project profiles may be supplied by the checked-out repository.

Profiles are discovered from:

- `~/.devspace/agents/*.md` as `user:<name>`
- `.devspace/agents/*.md` as `project:<name>`

When both scopes define the same name, the project profile is the default for
the bare name. Both profiles remain visible and callable:

```bash
devspace agents run reviewer "..."          # project:reviewer
devspace agents run project:reviewer "..."  # explicit project profile
devspace agents run user:reviewer "..."     # explicit user profile
```

`open_workspace` exposes the qualified name, scope, path, default status,
shadowing relationship, provider configuration, and native subagent definitions.
Packaged files under `examples/agents/` are starter templates only.

## Minimal shape

```md
---
schema: devspace-agent/v1
name: reviewer
description: Read-only reviewer for bugs, security risks, and missing tests.
provider: codex
model: gpt-5.4
thinking: high
disabled: false
---

You are a read-only reviewer. Do not edit files.
Focus on correctness, security, test gaps, and maintainability.
Cite files and return concise findings.
```

## Frontmatter fields

### `schema`

Optional schema identifier:

```yaml
schema: devspace-agent/v1
```

### `name`

Stable profile identifier shown to the model and accepted as a bare name or a
scope-qualified name:

```bash
devspace agents run <name> "<prompt>"
devspace agents run project:<name> "<prompt>"
devspace agents run user:<name> "<prompt>"
```

Use lowercase kebab-case names. If omitted, DevSpace uses the filename without
`.md`. A bare name resolves to the project profile first, then the user profile.

### `description`

Required short purpose. This is exposed by `open_workspace` so the supervising
model can choose the right profile.

### `provider`

Required built-in provider id:

```yaml
provider: codex
provider: claude
provider: opencode
provider: pi
provider: cursor
provider: copilot
```

Unsupported or custom providers are rejected. DevSpace maps providers to their
native integration:

- `codex`: Codex SDK
- `claude`: Claude Code SDK
- `opencode`: OpenCode SDK
- `pi`: Pi RPC mode
- `cursor`: ACP
- `copilot`: ACP

### `model`

Optional provider model id or alias.

```yaml
model: gpt-5.4
model: sonnet
```

### `thinking`

Optional provider reasoning effort, thinking level, or model variant. If omitted,
DevSpace lets the provider default apply. Values are provider-specific
passthrough strings; DevSpace does not translate names between harnesses.

```yaml
thinking: low
thinking: high
thinking: xhigh
```

DevSpace passes this through to providers that expose a matching control:

- `claude`: SDK effort with adaptive thinking.
- `codex`: SDK model reasoning effort.
- `pi`: `--thinking`.
- `opencode`: model variant.
- `cursor` and `copilot`: ACP thought-level config when supported.

### `claude`

Optional provider-specific configuration for a profile whose `provider` is
`claude`. The first supported option is programmatic Claude-native subagents:

```yaml
provider: claude
claude:
  agents:
    runtime:
      description: Reviews runtime lifecycle and process handling.
      prompt: Audit runtime behavior only. Do not modify files.
      tools: [Read, Grep, Glob]
      model: inherit
    tests:
      description: Reviews tests and privacy assertions.
      prompt: Audit test coverage only. Do not modify files.
```

When this block is present, DevSpace auto-allows the Claude `Agent` tool so the
parent can invoke its configured native subagents. Claude local-agent sessions
run with `permissionMode: bypassPermissions` and therefore have full local
permission. This is intentional: DevSpace prioritizes reliable execution over a
second permission layer inside the provider adapter.

`allowedTools` in the Claude SDK is an auto-approval list, not an availability
whitelist. Each native `agents` entry requires `description` and `prompt`.
`tools` defines that native worker's available capabilities and defaults to the
read-oriented set `Read, Grep, Glob, WebSearch, WebFetch`. This permits local
inspection and Internet research while still omitting local mutation tools and
`Bash`. It is not a DevSpace sandbox or a claim that the outer Claude session is
read-only. Use `tools: []` for a subagent with no tools. `model` is an optional Claude model alias or id. DevSpace accepts at
most 16 programmatic agents per profile and rejects unknown fields, duplicate
tools, invalid names, and empty required strings.

For transparency, `open_workspace` exposes every native subagent's name,
description, prompt, tools, and model together with the outer profile's effective
`full_access` permission.

This is different from a DevSpace subagent session. `devspace agents run`
starts one tracked DevSpace worker; when that worker uses a Claude profile with
`claude.agents`, the Claude Agent SDK may create additional native subagents
inside that provider session. DevSpace continues to expose only the outer worker
session through `agents ls` and `agents show`.

See `examples/agents/claude-multi-agent-reviewer.md` for a complete
review-oriented fan-out profile.

### `disabled`

Optional boolean. Disabled profiles are not exposed.

```yaml
disabled: true
```

## Markdown body

The body is the profile prompt prefix DevSpace prepends when launching that
profile. It is not included in `open_workspace` by default.

Recommended body content:

- When to use this profile.
- Whether the worker should act read-only or may make changes.
- Output format.
- Review or testing expectations.

## Model-facing workflow

The Subagent skill teaches only:

```bash
devspace agents ls
devspace agents run <profile-or-id> "<prompt>"
devspace agents show <id>
```

`open_workspace` exposes compact profile metadata:

```json
{
  "name": "reviewer",
  "description": "Read-only reviewer for bugs, security risks, and missing tests.",
  "provider": "codex",
  "model": "gpt-5.4",
  "thinking": "high"
}
```

`devspace agents ls` lists existing subagent sessions for the current workspace;
it does not list profile definitions.

The full profile body stays out of the model context until DevSpace launches the
profile.

## Current non-goals

- Custom or arbitrary CLI-backed agents.
- Inferring changed files, tests, or diffs from worker output.
- Exposing raw provider transcripts by default.
- Teaching the model provider-specific CLIs.
- First-class MCP agent tools. Future tools should wrap the same provider
  adapter registry used by `devspace agents`.
