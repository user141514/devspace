import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

export const HOST_WORKER_MAX_CONCURRENCY = 4;

export interface HostWorkerCapabilities extends Record<string, unknown> {
  sampling: boolean;
  tools: boolean;
  taskSampling: boolean;
  background: boolean;
  maxConcurrency: number;
}

export function resolveHostWorkerCapabilities(
  capabilities: ClientCapabilities | undefined,
): HostWorkerCapabilities {
  const sampling = capabilities?.sampling !== undefined;
  const tools = capabilities?.sampling?.tools !== undefined;
  const taskSampling = capabilities?.tasks?.requests?.sampling?.createMessage !== undefined;

  return {
    sampling,
    tools,
    taskSampling,
    background: taskSampling,
    maxConcurrency: HOST_WORKER_MAX_CONCURRENCY,
  };
}
