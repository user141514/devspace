import { randomUUID } from "node:crypto";
import { runLocalAgentProvider } from "./local-agent-adapters.js";
import type {
  LocalAgentRunInput,
  LocalAgentRunResult,
} from "./local-agent-runtime.js";

export const MAX_PI_BATCH_WORKERS = 8;

export interface PiBatchTask {
  id: string;
  prompt: string;
}

export type PiBatchWorkerStatus = "running" | "completed" | "error";
export type PiBatchStatus = "running" | "completed";

export interface PiBatchWorkerSummary {
  id: string;
  status: PiBatchWorkerStatus;
}

export interface PiBatchStartResult {
  batchId: string;
  status: PiBatchStatus;
  workers: PiBatchWorkerSummary[];
}

export interface PiBatchWorkerResult extends PiBatchWorkerSummary {
  result?: string;
  error?: string;
}

export interface PiBatchResults {
  batchId: string;
  status: PiBatchStatus;
  results: PiBatchWorkerResult[];
}

type PiRunner = (input: LocalAgentRunInput) => Promise<LocalAgentRunResult>;

interface PiBatchWorkerRecord extends PiBatchWorkerResult {}

interface PiBatchRecord {
  id: string;
  workers: Map<string, PiBatchWorkerRecord>;
}

export class PiBatchManager {
  private readonly batches = new Map<string, PiBatchRecord>();

  constructor(
    private readonly runPi: PiRunner = (input) => runLocalAgentProvider("pi", input),
  ) {}

  start(workspace: string, tasks: PiBatchTask[]): PiBatchStartResult {
    validateTasks(tasks);
    const batch: PiBatchRecord = {
      id: `pib_${randomUUID().replaceAll("-", "").slice(0, 12)}`,
      workers: new Map(
        tasks.map((task) => [task.id, { id: task.id, status: "running" as const }]),
      ),
    };
    this.batches.set(batch.id, batch);

    for (const task of tasks) {
      void this.runWorker(batch, task, workspace);
    }

    return this.status(batch.id);
  }

  status(batchId: string): PiBatchStartResult {
    const batch = this.requireBatch(batchId);
    return {
      batchId: batch.id,
      status: batchStatus(batch),
      workers: Array.from(batch.workers.values(), (worker) => ({
        id: worker.id,
        status: worker.status,
      })),
    };
  }

  results(batchId: string): PiBatchResults {
    const batch = this.requireBatch(batchId);
    return {
      batchId: batch.id,
      status: batchStatus(batch),
      results: Array.from(batch.workers.values(), (worker) => ({
        id: worker.id,
        status: worker.status,
        ...(worker.result === undefined ? {} : { result: worker.result }),
        ...(worker.error === undefined ? {} : { error: worker.error }),
      })),
    };
  }

  private async runWorker(
    batch: PiBatchRecord,
    task: PiBatchTask,
    workspace: string,
  ): Promise<void> {
    const worker = batch.workers.get(task.id)!;
    try {
      const result = await this.runPi({
        prompt: task.prompt,
        workspace,
        writeMode: "read_only",
      });
      worker.status = "completed";
      worker.result = result.finalResponse;
    } catch (error) {
      worker.status = "error";
      worker.error = error instanceof Error ? error.message : String(error);
    }
  }

  private requireBatch(batchId: string): PiBatchRecord {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error(`Unknown Pi batch id: ${batchId}`);
    return batch;
  }
}

function validateTasks(tasks: PiBatchTask[]): void {
  if (tasks.length < 1) throw new Error("Pi batch requires at least 1 task.");
  if (tasks.length > MAX_PI_BATCH_WORKERS) {
    throw new Error(`Pi batch accepts at most ${MAX_PI_BATCH_WORKERS} tasks.`);
  }

  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error(`Duplicate worker id: ${task.id}`);
    ids.add(task.id);
  }
}

function batchStatus(batch: PiBatchRecord): PiBatchStatus {
  return Array.from(batch.workers.values()).some((worker) => worker.status === "running")
    ? "running"
    : "completed";
}
