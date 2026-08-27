import { randomUUID } from "node:crypto";
import type {
  HostWorkerCapabilities,
  HostWorkerCreateInput,
  HostWorkerSnapshot,
  HostWorkerStatus,
} from "./host-worker-types.js";

interface HostWorkerRecord {
  input: HostWorkerCreateInput;
  snapshot: HostWorkerSnapshot;
  abortController: AbortController;
}

export class HostWorkerManager {
  private readonly workers = new Map<string, HostWorkerRecord>();
  private closed = false;
  private readonly resolveCapabilities: () => HostWorkerCapabilities;

  constructor(capabilities: HostWorkerCapabilities | (() => HostWorkerCapabilities)) {
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
      abortController: new AbortController(),
    });
    return cloneSnapshot(snapshot);
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
