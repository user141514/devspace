import type { HostWorkerProviderRunTurnInput } from "./host-worker-provider-runtime.js";
import type { HostWorkerRunTurnResult } from "./host-worker-runtime.js";
import type { HostWorkerCapabilities } from "./host-worker-types.js";

interface HostWorkerTurnRuntime {
  runTurn(input: HostWorkerProviderRunTurnInput): Promise<HostWorkerRunTurnResult>;
}

export class HostWorkerExecutionRouter implements HostWorkerTurnRuntime {
  constructor(
    private readonly resolveCapabilities: () => HostWorkerCapabilities,
    private readonly nativeRuntime: HostWorkerTurnRuntime,
    private readonly providerRuntime: HostWorkerTurnRuntime,
  ) {}

  async runTurn(input: HostWorkerProviderRunTurnInput): Promise<HostWorkerRunTurnResult> {
    const capabilities = this.resolveCapabilities();
    if (capabilities.sampling) return this.nativeRuntime.runTurn(input);
    if (capabilities.providerBacked) return this.providerRuntime.runTurn(input);
    throw new Error("host_worker_execution_unavailable");
  }
}
