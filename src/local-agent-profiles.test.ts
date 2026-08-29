import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";
import { loadLocalAgentProfiles, summarizeLocalAgentProfile } from "./local-agent-profiles.js";
import { writeTestDevspaceConfig } from "./test-support/config.test.js";

const root = await mkdtemp(join(tmpdir(), "devspace-agent-profiles-test-"));

try {
  const configDir = join(root, ".devspace-home");
  const workspaceRoot = join(root, "project");
  await mkdir(join(configDir, "agents"), { recursive: true });
  await mkdir(join(workspaceRoot, ".devspace", "agents"), { recursive: true });

  await writeFile(
    join(configDir, "agents", "reviewer.md"),
    [
      "---",
      "name: reviewer",
      "description: Global reviewer.",
      "provider: codex",
      "model: gpt-5.4",
      "---",
      "",
      "Global body.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(workspaceRoot, ".devspace", "agents", "reviewer.md"),
    [
      "---",
      "name: reviewer",
      'description: "Project reviewer #1."',
      "provider: claude",
      "model: sonnet",
      "effort: high",
      "claude:",
      "  agents:",
      "    runtime:",
      "      description: Audit runtime behavior.",
      "      prompt: Inspect runtime code and report evidence.",
      "      tools: [Read, Grep, Glob]",
      "      model: inherit",
      "    tests:",
      "      description: Audit tests and regressions.",
      "      prompt: Inspect tests and report missing coverage.",
      "    isolated:",
      "      description: Answer without tools.",
      "      prompt: Return a concise independent assessment.",
      "      tools: []",
      "---",
      "",
      "Project body.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(workspaceRoot, ".devspace", "agents", "disabled.md"),
    [
      "---",
      "name: disabled",
      "description: Disabled agent.",
      "provider: codex",
      "disabled: true",
      "---",
      "",
      "Disabled body.",
      "",
    ].join("\n"),
  );

  const invalidProfiles: Array<[string, string[]]> = [
    [
      "invalid-claude-native.md",
      [
        "name: invalid-claude-native",
        "description: Invalid Claude native profile.",
        "provider: codex",
        "claude:",
        "  agents:",
        "    reviewer:",
        "      description: Review code.",
        "      prompt: Review the codebase.",
      ],
    ],
    [
      "invalid-native-name.md",
      [
        "name: invalid-native-name",
        "description: Invalid native name.",
        "provider: claude",
        "claude:",
        "  agents:",
        '    "bad name":',
        "      description: Review code.",
        "      prompt: Review the codebase.",
      ],
    ],
    [
      "duplicate-native-tools.md",
      [
        "name: duplicate-native-tools",
        "description: Duplicate native tools.",
        "provider: claude",
        "claude:",
        "  agents:",
        "    reviewer:",
        "      description: Review code.",
        "      prompt: Review the codebase.",
        "      tools: [Read, Read]",
      ],
    ],
    [
      "unknown-native-field.md",
      [
        "name: unknown-native-field",
        "description: Unknown native field.",
        "provider: claude",
        "claude:",
        "  agents:",
        "    reviewer:",
        "      description: Review code.",
        "      prompt: Review the codebase.",
        "      maxTurns: 2",
      ],
    ],
    [
      "empty-native-agents.md",
      [
        "name: empty-native-agents",
        "description: Empty native agents.",
        "provider: claude",
        "claude:",
        "  agents: {}",
      ],
    ],
  ];
  for (const [fileName, frontmatter] of invalidProfiles) {
    await writeFile(
      join(workspaceRoot, ".devspace", "agents", fileName),
      ["---", ...frontmatter, "---", ""].join("\n"),
    );
  }

  const enabledConfig = loadConfig(writeTestDevspaceConfig(configDir, {
    workspaces: { allowedRoots: [workspaceRoot] },
    subagents: { enabled: true, providers: [] },
  }));
  const profiles = await loadLocalAgentProfiles(enabledConfig, workspaceRoot);

  assert.equal(profiles.length, 2);
  const projectProfile = profiles.find((profile) => profile.qualifiedName === "project:reviewer");
  const userProfile = profiles.find((profile) => profile.qualifiedName === "user:reviewer");
  assert.equal(projectProfile?.name, "reviewer");
  assert.equal(projectProfile?.scope, "project");
  assert.equal(projectProfile?.isDefault, true);
  assert.deepEqual(projectProfile?.shadows, ["user:reviewer"]);
  assert.equal(projectProfile?.shadowedBy, undefined);
  assert.equal(projectProfile?.description, "Project reviewer #1.");
  assert.equal(projectProfile?.provider, "claude");
  assert.equal(projectProfile?.model, "sonnet");
  assert.equal(projectProfile?.effort, "high");
  assert.deepEqual(projectProfile?.claudeNativeSubagents, {
    agents: {
      runtime: {
        description: "Audit runtime behavior.",
        prompt: "Inspect runtime code and report evidence.",
        tools: ["Read", "Grep", "Glob"],
        model: "inherit",
      },
      tests: {
        description: "Audit tests and regressions.",
        prompt: "Inspect tests and report missing coverage.",
        tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
      },
      isolated: {
        description: "Answer without tools.",
        prompt: "Return a concise independent assessment.",
        tools: [],
      },
    },
  });
  assert.equal(projectProfile?.body, "Project body.");
  assert.equal(userProfile?.scope, "user");
  assert.equal(userProfile?.isDefault, false);
  assert.deepEqual(userProfile?.shadows, []);
  assert.equal(userProfile?.shadowedBy, "project:reviewer");
  assert.equal(userProfile?.description, "Global reviewer.");
  assert.equal(userProfile?.provider, "codex");
  assert.deepEqual(summarizeLocalAgentProfile(projectProfile!), {
    name: "reviewer",
    qualifiedName: "project:reviewer",
    scope: "project",
    profilePath: join(workspaceRoot, ".devspace", "agents", "reviewer.md"),
    isDefault: true,
    shadows: ["user:reviewer"],
    shadowedBy: undefined,
    description: "Project reviewer #1.",
    provider: "claude",
    model: "sonnet",
    effort: "high",
    nativeSubagents: [
      {
        name: "runtime",
        description: "Audit runtime behavior.",
        prompt: "Inspect runtime code and report evidence.",
        tools: ["Read", "Grep", "Glob"],
        model: "inherit",
      },
      {
        name: "tests",
        description: "Audit tests and regressions.",
        prompt: "Inspect tests and report missing coverage.",
        tools: ["Read", "Grep", "Glob", "WebSearch", "WebFetch"],
        model: undefined,
      },
      {
        name: "isolated",
        description: "Answer without tools.",
        prompt: "Return a concise independent assessment.",
        tools: [],
        model: undefined,
      },
    ],
  });

  await writeFile(
    join(workspaceRoot, ".devspace", "agents", "custom.md"),
    [
      "---",
      "name: custom",
      "description: Unsupported custom agent.",
      "provider: custom",
      "---",
      "",
      "Custom body.",
      "",
    ].join("\n"),
  );
  const profilesWithInvalid = await loadLocalAgentProfiles(enabledConfig, workspaceRoot);
  assert.deepEqual(
    profilesWithInvalid.map((profile) => profile.qualifiedName),
    ["project:reviewer", "user:reviewer"],
  );

  const disabledConfig = loadConfig(writeTestDevspaceConfig(configDir, {
    workspaces: { allowedRoots: [workspaceRoot] },
    subagents: { enabled: false, providers: [] },
  }));
  assert.deepEqual(await loadLocalAgentProfiles(disabledConfig, workspaceRoot), []);
} finally {
  await rm(root, { recursive: true, force: true });
}
