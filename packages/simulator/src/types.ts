import type { RawLog } from "@drop/decoder";

export interface SimulationRequest {
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly data: `0x${string}`;
  readonly value?: bigint;
  readonly gasLimit?: bigint;
}

export interface SimulationContext {
  readonly blockNumber?: bigint;
  readonly timestamp?: number;
}

export interface SimulationResult {
  readonly success: boolean;
  readonly gasUsed: bigint;
  readonly logs: readonly RawLog[];
  readonly revertReason?: string;
  readonly isComplete: boolean;
}

export interface ISimulator {
  simulate(
    request: SimulationRequest,
    context?: SimulationContext
  ): Promise<SimulationResult>;
}
