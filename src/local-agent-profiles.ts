import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ServerConfig } from "./config.js";
import type {
  ClaudeNativeAgentDefinition,
  ClaudeNativeSubagents,
} from "./local-agent-runtime.js";

export type LocalAgentProvider = "codex" | "claude" | "opencode" | "pi" | "cursor" | "copilot";

export const LOCAL_AGENT_PROVIDERS: readonly LocalAgentProvider[] = [
  "codex",
  "claude",
  "opencode",
  "pi",
  "cursor",
  "copilot",
];

export type LocalAgentProfileScope = "user" | "project";

export interface LocalAgentProfile {
  name: string;
  qualifiedName: string;
  scope: LocalAgentProfileScope;
  isDefault: boolean;
  shadows: string[];
  shadowedBy?: string;
  description: string;
  provider: LocalAgentProvider;
  model?: string;
  thinking?: string;
  claudeNativeSubagents?: ClaudeNativeSubagents;
  filePath: string;
  body: string;
  disabled: boolean;
}

export interface LocalAgentNativeSubagentSummary {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
}

export interface LocalAgentProfileSummary {
  name: string;
  qualifiedName: string;
  scope: LocalAgentProfileScope;
  profilePath: string;
  isDefault: boolean;
  shadows: string[];
  shadowedBy?: string;
  description: string;
  provider: LocalAgentProvider;
  model?: string;
  thinking?: string;
  effectivePermission?: "full_access";
  nativeSubagents?: LocalAgentNativeSubagentSummary[];
}

interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_DELIMITER = "---";
const PROVIDERS = new Set<LocalAgentProvider>(LOCAL_AGENT_PROVIDERS);
const CLAUDE_AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_CLAUDE_SUBAGENT_TOOLS = ["Read", "Grep", "Glob"];
const MAX_CLAUDE_NATIVE_SUBAGENTS = 16;

export async function loadLocalAgentProfiles(
  config: ServerConfig,
  workspaceRoot: string,
): Promise<LocalAgentProfile[]> {
  if (!config.subagents) return [];

  const profileSources: Array<{ directory: string; scope: LocalAgentProfileScope }> = [
    { directory: config.devspaceAgentsDir, scope: "user" },
    { directory: join(workspaceRoot, ".devspace", "agents"), scope: "project" },
  ];
  const profilesByQualifiedName = new Map<string, LocalAgentProfile>();

  for (const source of profileSources) {
    for (const profile of await loadProfilesFromDirectory(source.directory, source.scope)) {
      profilesByQualifiedName.set(profile.qualifiedName, profile);
    }
  }

  const profiles = Array.from(profilesByQualifiedName.values()).filter(
    (profile) => !profile.disabled,
  );
  const profilesByName = new Map<string, LocalAgentProfile[]>();
  for (const profile of profiles) {
    const matchingProfiles = profilesByName.get(profile.name) ?? [];
    matchingProfiles.push(profile);
    profilesByName.set(profile.name, matchingProfiles);
  }

  for (const matchingProfiles of profilesByName.values()) {
    const projectProfile = matchingProfiles.find((profile) => profile.scope === "project");
    const userProfile = matchingProfiles.find((profile) => profile.scope === "user");
    const defaultProfile = projectProfile ?? userProfile;

    for (const profile of matchingProfiles) {
      profile.isDefault = profile === defaultProfile;
      profile.shadows = profile === projectProfile && userProfile ? [userProfile.qualifiedName] : [];
      profile.shadowedBy = profile === userProfile && projectProfile
        ? projectProfile.qualifiedName
        : undefined;
    }
  }

  return profiles.sort((a, b) => {
    const nameComparison = a.name.localeCompare(b.name);
    if (nameComparison !== 0) return nameComparison;
    if (a.scope === b.scope) return a.qualifiedName.localeCompare(b.qualifiedName);
    return a.scope === "project" ? -1 : 1;
  });
}

export function summarizeLocalAgentProfile(
  profile: LocalAgentProfile,
): LocalAgentProfileSummary {
  const nativeSubagents = profile.claudeNativeSubagents
    ? Object.entries(profile.claudeNativeSubagents.agents).map(([name, definition]) => ({
        name,
        description: definition.description,
        prompt: definition.prompt,
        tools: [...definition.tools],
        model: definition.model,
      }))
    : undefined;

  return {
    name: profile.name,
    qualifiedName: profile.qualifiedName,
    scope: profile.scope,
    profilePath: profile.filePath,
    isDefault: profile.isDefault,
    shadows: [...profile.shadows],
    shadowedBy: profile.shadowedBy,
    description: profile.description,
    provider: profile.provider,
    model: profile.model,
    thinking: profile.thinking,
    effectivePermission: profile.provider === "claude" ? "full_access" : undefined,
    nativeSubagents,
  };
}

async function loadProfilesFromDirectory(
  directory: string,
  scope: LocalAgentProfileScope,
): Promise<LocalAgentProfile[]> {
  const resolvedDirectory = resolve(directory);
  if (!existsSync(resolvedDirectory)) return [];

  const entries = await readdir(resolvedDirectory, { withFileTypes: true });
  const profiles: LocalAgentProfile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;

    const filePath = join(resolvedDirectory, entry.name);
    try {
      profiles.push(await loadProfileFile(filePath, scope));
    } catch (error) {
      console.warn(`Skipping invalid subagent profile ${filePath}: ${errorMessage(error)}`);
    }
  }

  return profiles;
}

async function loadProfileFile(
  filePath: string,
  scope: LocalAgentProfileScope,
): Promise<LocalAgentProfile> {
  const content = await readFile(filePath, "utf8");
  const parsed = parseFrontmatter(content, filePath);
  return profileFromFrontmatter(parsed.frontmatter, parsed.body, filePath, scope);
}

function parseFrontmatter(content: string, filePath: string): ParsedFrontmatter {
  const normalized = content.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error(`Subagent profile is missing frontmatter: ${filePath}`);
  }

  const endIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER,
  );
  if (endIndex === -1) {
    throw new Error(`Subagent profile frontmatter is not closed: ${filePath}`);
  }

  return {
    frontmatter: parseProfileYaml(lines.slice(1, endIndex).join("\n"), filePath),
    body: lines.slice(endIndex + 1).join("\n").trim(),
  };
}

function parseProfileYaml(source: string, filePath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source) ?? {};
  } catch (error) {
    throw new Error(`Unable to parse subagent profile frontmatter: ${filePath}: ${errorMessage(error)}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Subagent profile frontmatter must be a mapping: ${filePath}`);
  }

  return parsed as Record<string, unknown>;
}

function profileFromFrontmatter(
  frontmatter: Record<string, unknown>,
  body: string,
  filePath: string,
  scope: LocalAgentProfileScope,
): LocalAgentProfile {
  const name = readString(frontmatter, "name") ?? basename(filePath, ".md");
  const description = readString(frontmatter, "description");
  const provider = readProvider(frontmatter, filePath);
  if (!description) {
    throw new Error(`Subagent profile is missing description: ${filePath}`);
  }

  return {
    name,
    qualifiedName: `${scope}:${name}`,
    scope,
    isDefault: false,
    shadows: [],
    description,
    provider,
    model: readString(frontmatter, "model"),
    thinking: readString(frontmatter, "thinking"),
    claudeNativeSubagents: readClaudeNativeSubagents(frontmatter, provider, filePath),
    filePath,
    body,
    disabled: frontmatter.disabled === true,
  };
}

function readClaudeNativeSubagents(
  frontmatter: Record<string, unknown>,
  provider: LocalAgentProvider,
  filePath: string,
): ClaudeNativeSubagents | undefined {
  const claude = readRecord(frontmatter.claude, "claude", filePath, true);
  if (!claude) return undefined;
  if (provider !== "claude") {
    throw new Error(`Subagent profile claude options require provider: claude: ${filePath}`);
  }
  assertOnlyFields(claude, new Set(["agents"]), "claude", filePath);

  const agentsRecord = readRecord(claude.agents, "claude.agents", filePath, false)!;
  const entries = Object.entries(agentsRecord);
  if (entries.length === 0) {
    throw new Error(`Subagent profile claude.agents must define at least one agent: ${filePath}`);
  }
  if (entries.length > MAX_CLAUDE_NATIVE_SUBAGENTS) {
    throw new Error(
      `Subagent profile claude.agents may define at most ${MAX_CLAUDE_NATIVE_SUBAGENTS} agents: ${filePath}`,
    );
  }

  const agents: Record<string, ClaudeNativeAgentDefinition> = {};
  for (const [name, value] of entries) {
    if (!CLAUDE_AGENT_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid Claude native subagent name '${name}': ${filePath}`);
    }
    const definition = readRecord(value, `claude.agents.${name}`, filePath, false)!;
    assertOnlyFields(
      definition,
      new Set(["description", "prompt", "tools", "model"]),
      `claude.agents.${name}`,
      filePath,
    );
    const description = readRequiredString(
      definition,
      "description",
      `claude.agents.${name}`,
      filePath,
    );
    const prompt = readRequiredString(definition, "prompt", `claude.agents.${name}`, filePath);
    const model = readString(definition, "model");
    agents[name] = {
      description,
      prompt,
      tools: readStringArray(
        definition.tools,
        `claude.agents.${name}.tools`,
        filePath,
        DEFAULT_CLAUDE_SUBAGENT_TOOLS,
        true,
      ),
      ...(model ? { model } : {}),
    };
  }

  return { agents };
}

function readProvider(frontmatter: Record<string, unknown>, filePath: string): LocalAgentProvider {
  const provider = readString(frontmatter, "provider");
  if (!provider) {
    throw new Error(`Subagent profile is missing provider: ${filePath}`);
  }
  if (!PROVIDERS.has(provider as LocalAgentProvider)) {
    throw new Error(
      `Subagent profile provider must be codex, claude, opencode, pi, cursor, or copilot: ${filePath}`,
    );
  }
  return provider as LocalAgentProvider;
}

export function isLocalAgentProvider(value: string): value is LocalAgentProvider {
  return PROVIDERS.has(value as LocalAgentProvider);
}

function readRecord(
  value: unknown,
  field: string,
  filePath: string,
  optional: boolean,
): Record<string, unknown> | undefined {
  if (value === undefined && optional) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Subagent profile ${field} must be a mapping: ${filePath}`);
  }
  return value as Record<string, unknown>;
}

function assertOnlyFields(
  record: Record<string, unknown>,
  allowed: Set<string>,
  field: string,
  filePath: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new Error(`Subagent profile ${field} contains unsupported field '${key}': ${filePath}`);
    }
  }
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  field: string,
  filePath: string,
): string {
  const value = readString(record, key);
  if (!value) {
    throw new Error(`Subagent profile ${field}.${key} must be a non-empty string: ${filePath}`);
  }
  return value;
}

function readStringArray(
  value: unknown,
  field: string,
  filePath: string,
  fallback: readonly string[],
  allowEmpty: boolean,
): string[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    const qualifier = allowEmpty ? "a string array" : "a non-empty string array";
    throw new Error(`Subagent profile ${field} must be ${qualifier}: ${filePath}`);
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`Subagent profile ${field} must contain only non-empty strings: ${filePath}`);
    }
    const trimmed = item.trim();
    if (result.includes(trimmed)) {
      throw new Error(`Subagent profile ${field} must not contain duplicates: ${filePath}`);
    }
    result.push(trimmed);
  }
  return result;
}

function readString(frontmatter: Record<string, unknown>, key: string): string | undefined {
  const value = frontmatter[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
