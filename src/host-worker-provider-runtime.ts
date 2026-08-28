import type { SamplingMessage } from "@modelcontextprotocol/sdk/types.js";
import type { LocalAgentClient } from "./local-agent-client.js";
import type { LocalAgentRecord, LocalAgentWorkspaceScope } from "./local-agent-store.js";
import type { HostWorkerRunTurnInput, HostWorkerRunTurnResult } from "./host-worker-runtime.js";
import type { LocalAgentProvider } from "./local-agent-profiles.js";

export interface HostWorkerProviderRunTurnInput extends HostWorkerRunTurnInput {
  workerId: string;
  workspaceId: string;
  workspaceRoot: string;
}

export interface HostWorkerProviderRuntimeOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type LocalAgentClientLike = Pick<LocalAgentClient, "start" | "continue" | "get">;

interface ProviderSession {
  provider: LocalAgentProvider;
  agentId: string;
}

const PRIMARY_PROVIDER: LocalAgentProvider = "codex";
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 120_000;

export class HostWorkerProviderRuntime {
  private readonly sessions = new Map<string, ProviderSession>();
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly client: LocalAgentClientLike,
    options: HostWorkerProviderRuntimeOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async runTurn(input: HostWorkerProviderRunTurnInput): Promise<HostWorkerRunTurnResult> {
    assertNotCancelled(input.signal);

    const userText = input.history.length === 0
      ? `${input.taskPacket}\n\nMessage:\n${input.message}`
      : input.message;
    const messages: SamplingMessage[] = [
      ...input.history,
      { role: "user", content: { type: "text", text: userText } },
    ];
    const scope: LocalAgentWorkspaceScope = {
      workspaceId: input.workspaceId,
      workspaceRoot: input.workspaceRoot,
    };

    const existing = this.sessions.get(input.workerId);
    let provider = existing?.provider ?? PRIMARY_PROVIDER;
    let resumable = existing;

    while (true) {
      assertNotCancelled(input.signal);
      const started = resumable && resumable.provider === provider
        ? await this.client.continue(resumable.agentId, input.message, { writeMode: "read_only" }, scope)
        : await this.client.start({
            target: provider,
            prompt: providerStartPrompt(messages),
            workspaceRoot: input.workspaceRoot,
            workspaceId: input.workspaceId,
            writeMode: "read_only",
          });

      if (started.isErr()) {
        const fallback = nextFallbackProvider(provider, started.error.code);
        if (!fallback) throw providerFailure(provider, started.error.code, started.error.message);
        provider = fallback;
        resumable = undefined;
        continue;
      }

      const terminal = await this.waitForTerminal(started.value, scope, input.signal);
      if (terminal.status === "idle" && terminal.latestResponse?.trim()) {
        this.sessions.set(input.workerId, { provider, agentId: terminal.id });
        const finalResponse = terminal.latestResponse.trim();
        return {
          finalResponse,
          history: [
            ...messages,
            { role: "assistant", content: { type: "text", text: finalResponse } },
          ],
        };
      }

      const code = terminal.errorCode ?? "PROVIDER_EXECUTION_ERROR";
      const fallback = nextFallbackProvider(provider, code);
      if (!fallback) throw providerFailure(provider, code, terminal.error ?? `${provider} worker failed.`);
      provider = fallback;
      resumable = undefined;
    }
  }

  private async waitForTerminal(
    initial: LocalAgentRecord,
    scope: LocalAgentWorkspaceScope,
    signal: AbortSignal,
  ): Promise<LocalAgentRecord> {
    let record = initial;
    const deadline = Date.now() + this.timeoutMs;
    while (record.status === "starting" || record.status === "running") {
      assertNotCancelled(signal);
      if (Date.now() >= deadline) throw new Error(`provider_worker_timeout: ${record.provider}`);
      if (this.pollIntervalMs > 0) await delay(this.pollIntervalMs);
      const refreshed = await this.client.get(record.id, scope);
      if (refreshed.isErr()) {
        throw providerFailure(record.provider, refreshed.error.code, refreshed.error.message);
      }
      record = refreshed.value;
    }
    return record;
  }
}

function nextFallbackProvider(
  provider: LocalAgentProvider,
  errorCode: string,
): LocalAgentProvider | undefined {
  if (provider === "codex") {
    return errorCode === "PROVIDER_QUOTA_EXHAUSTED" ? "pi" : undefined;
  }
  if (provider === "pi") {
    return errorCode === "PROVIDER_QUOTA_EXHAUSTED" || errorCode === "PROVIDER_UNAVAILABLE"
      ? "claude"
      : undefined;
  }
  return undefined;
}

function providerStartPrompt(messages: SamplingMessage[]): string {
  return messages.map((message) => {
    const text = samplingText(message);
    return `${message.role === "assistant" ? "Assistant" : "User"}: ${text}`;
  }).join("\n\n");
}

function samplingText(message: SamplingMessage): string {
  const blocks = Array.isArray(message.content) ? message.content : [message.content];
  return blocks
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function providerFailure(provider: string, code: string, message: string): Error {
  return new Error(`${provider}:${code}: ${message}`);
}

function assertNotCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("worker_cancelled");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
