import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SamplingMessage } from "@modelcontextprotocol/sdk/types.js";

export interface HostWorkerRunTurnInput {
  taskPacket: string;
  history: SamplingMessage[];
  message: string;
  signal: AbortSignal;
}

export interface HostWorkerRunTurnResult {
  finalResponse: string;
  history: SamplingMessage[];
}

export class HostWorkerRuntime {
  constructor(private readonly server: McpServer) {}

  async runTurn(input: HostWorkerRunTurnInput): Promise<HostWorkerRunTurnResult> {
    if (input.signal.aborted) throw new Error("worker_cancelled");

    const userText = input.history.length === 0
      ? `${input.taskPacket}\n\nMessage:\n${input.message}`
      : input.message;
    const messages: SamplingMessage[] = [
      ...input.history,
      {
        role: "user",
        content: { type: "text", text: userText },
      },
    ];

    const response = await this.server.server.createMessage(
      {
        messages,
        maxTokens: 2_048,
      },
      { signal: input.signal },
    );

    if (response.role !== "assistant" || Array.isArray(response.content) || response.content.type !== "text") {
      throw new Error("sampling_protocol_error: expected assistant text response");
    }

    const finalResponse = response.content.text.trim();
    if (!finalResponse) {
      throw new Error("sampling_protocol_error: empty assistant response");
    }

    return {
      finalResponse,
      history: [
        ...messages,
        {
          role: "assistant",
          content: response.content,
        },
      ],
    };
  }
}
