import { randomUUID } from "node:crypto";
import type { SamplingMessage } from "@modelcontextprotocol/sdk/types.js";
import type {
  HostWorkerRunTurnInput,
  HostWorkerRunTurnResult,
} from "./host-worker-runtime.js";
import type {
  HostWorkerCapabilities,
  HostWorkerCreateInput,
  HostWorkerSnapshot,
  HostWorkerStatus,
} from "./host-worker-types.js";

interface HostWorkerTurnRuntime {
  runTurn(input: HostWorkerRunTurnInput): Promise<HostWorkerRunTurnResult>;
}

interface HostWorkerRecord {
  input: HostWorkerCreateInput;
  snapshot: HostWorkerSnapshot;
  history: SamplingMessage[];
  abortController: AbortController;
}

export class HostWorkerManager {
  private readonly workers = new Map<string, HostWorkerRecord>();
  private closed = false;
  private readonly resolveCapabilities: () => HostWorkerCapabilities;

  constructor(
    capabilities: HostWorkerCapabilities | (() => HostWorkerCapabilities),
    private readonly runtime?: HostWorkerTurnRuntime,
  ) {
    this.resolveCapabilities = typeof capabilities === "function" ? capabilities : () => capabilities;
  }

  create(input: HostWorkerCreateInput): HostWorkerSnapshot {
    this.assertOpen();
    const capabilities = this.resolveCapabilities();
    if (!capabilities.sampling) throw new Error("sampling_not_supported");
    if (input.requireTools && !capabilities.tools) {
      throw new Error("sampling_tools_not_supported");
    }

    const id = `hw_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const snapshot: HostWorkerSnapshot = {
      id,
      ...(input.key ? { key: input.key } : {}),
      workspaceId: input.workspaceId,
      status: "idle",
      createdAt: new Date().toISOString(),
    };
    this.workers.set(id, {
      input: {
        ...input,
        constraints: input.constraints ? [...input.constraints] : undefined,
      },
      snapshot,
      history: [],
      abortController: new AbortController(),
    });
    return cloneSnapshot(snapshot);
  }

  async send(id: string, message: string): Promise<HostWorkerSnapshot> {
    this.assertOpen();
    const worker = this.requireWorker(id);
    if (worker.snapshot.status === "cancelled") throw new Error("worker_cancelled");
    if (worker.snapshot.status === "failed") throw new Error("worker_failed");
    if (worker.snapshot.status === "queued" || worker.snapshot.status === "running") {
      throw new Error("worker_busy");
    }
    if (!this.runtime) throw new Error("sampling_runtime_unavailable");

    worker.abortController = new AbortController();
    worker.snapshot.status = "queued";
    worker.snapshot.startedAt = new Date().toISOString();
    delete worker.snapshot.completedAt;
    delete worker.snapshot.error;
    delete worker.snapshot.finalResponse;
    worker.snapshot.status = "running";

    try {
      const result = await this.runtime.runTurn({
        taskPacket: buildTaskPacket(worker.input),
        history: worker.history,
        message,
        signal: worker.abortController.signal,
      });
      worker.history = result.history;
      worker.snapshot.finalResponse = result.finalResponse;
      worker.snapshot.status = "completed";
      worker.snapshot.completedAt = new Date().toISOString();
      return cloneSnapshot(worker.snapshot);
    } catch (error) {
      if (worker.abortController.signal.aborted) {
        worker.snapshot.status = "cancelled";
        worker.snapshot.error ??= "worker_cancelled";
      } else {
        worker.snapshot.status = "failed";
        worker.snapshot.error = error instanceof Error ? error.message : String(error);
      }
      worker.snapshot.completedAt ??= new Date().toISOString();
      throw error;
    }
  }

  get(id: string): HostWorkerSnapshot {
    return cloneSnapshot(this.requireWorker(id).snapshot);
  }

  cancel(id: string): HostWorkerSnapshot {
    const worker = this.requireWorker(id);
    if (!isTerminal(worker.snapshot.status)) {
      worker.abortController.abort();
      worker.snapshot.status = "cancelled";
      worker.snapshot.completedAt = new Date().toISOString();
    }
    return cloneSnapshot(worker.snapshot);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const worker of this.workers.values()) {
      if (isTerminal(worker.snapshot.status)) continue;
      worker.abortController.abort();
      worker.snapshot.status = "cancelled";
      worker.snapshot.completedAt = new Date().toISOString();
      worker.snapshot.error = "transport_closed";
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("transport_closed");
  }

  private requireWorker(id: string): HostWorkerRecord {
    const worker = this.workers.get(id);
    if (!worker) throw new Error(`worker_not_found: ${id}`);
    return worker;
  }
}

function isTerminal(status: HostWorkerStatus): boolean {
  return status === "failed" || status === "cancelled";
}

function cloneSnapshot(snapshot: HostWorkerSnapshot): HostWorkerSnapshot {
  return { ...snapshot };
}

function buildTaskPacket(input: HostWorkerCreateInput): string {
  const lines = [
    `Goal: ${input.goal}`,
    `Workspace: ${input.workspaceRoot}`,
    ...(input.context ? [`Context: ${input.context}`] : []),
    ...(input.constraints?.length
      ? ["Constraints:", ...input.constraints.map((constraint) => `- ${constraint}`)]
      : []),
    ...(input.expectedOutput ? [`Expected output: ${input.expectedOutput}`] : []),
    "Policy: inspect only. Distinguish repository evidence from inference.",
  ];
  return lines.join("\n");
}
