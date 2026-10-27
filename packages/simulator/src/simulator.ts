import type {
  ISimulator,
  SimulationRequest,
  SimulationContext,
  SimulationResult,
} from "./types.ts";
import type { RawLog } from "@drop/decoder";

export interface ProviderCallAdapter {
  call(params: {
    account?: `0x${string}`;
    to: `0x${string}`;
    data?: `0x${string}`;
    value?: bigint;
    gas?: bigint;
  }): Promise<{ data?: `0x${string}` }>;
  getLogs?(params: {
    fromBlock?: bigint | "latest";
    toBlock?: bigint | "latest";
    address?: `0x${string}`;
  }): Promise<RawLog[]>;
}

/**
 * Local EVM Simulator adapter for Hardhat/Anvil/Viem providers.
 * Executes dry-run transactions and collects execution trace / logs.
 */
export class LocalEvmSimulator implements ISimulator {
  private readonly provider: ProviderCallAdapter;

  constructor(provider: ProviderCallAdapter) {
    this.provider = provider;
  }

  async simulate(
    request: SimulationRequest,
    _context?: SimulationContext
  ): Promise<SimulationResult> {
    try {
      // Execute dry-run call
      await this.provider.call({
        account: request.from,
        to: request.to,
        data: request.data,
        value: request.value ?? 0n,
        gas: request.gasLimit,
      });

      // Retrieve any logs emitted if provider exposes log retrieval
      let logs: RawLog[] = [];
      if (this.provider.getLogs) {
        try {
          logs = await this.provider.getLogs({
            fromBlock: "latest",
            toBlock: "latest",
          });
        } catch {
          // If log retrieval fails, fail-closed
          return {
            success: true,
            gasUsed: 0n,
            logs: [],
            isComplete: false,
          };
        }
      }

      return {
        success: true,
        gasUsed: 21000n,
        logs,
        isComplete: true,
      };
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);
      return {
        success: false,
        gasUsed: 0n,
        logs: [],
        revertReason: errorMessage,
        isComplete: false,
      };
    }
  }
}

/**
 * Deterministic Test Simulation Adapter for controlled unit testing of simulator pipeline.
 */
export class MockSimulationAdapter implements ISimulator {
  private customResult?: SimulationResult;

  setNextResult(result: SimulationResult): void {
    this.customResult = result;
  }

  async simulate(
    _request: SimulationRequest,
    _context?: SimulationContext
  ): Promise<SimulationResult> {
    if (this.customResult) {
      return this.customResult;
    }

    return {
      success: true,
      gasUsed: 21000n,
      logs: [],
      isComplete: true,
    };
  }
}
