import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";

export const HOST_WORKER_MAX_CONCURRENCY = 4;

export interface HostWorkerCapabilities extends Record<string, unknown> {
  sampling: boolean;
  tools: boolean;
  taskSampling: boolean;
  background: boolean;
  maxConcurrency: number;
}

export type HostWorkerStatus =
  | "idle"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface HostWorkerCreateInput {
  workspaceId: string;
  workspaceRoot: string;
  key?: string;
  goal: string;
  context?: string;
  constraints?: string[];
  expectedOutput?: string;
  requireTools?: boolean;
}

export interface HostWorkerSnapshot extends Record<string, unknown> {
  id: string;
  key?: string;
  workspaceId: string;
  status: HostWorkerStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  finalResponse?: string;
  error?: string;
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
