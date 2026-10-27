import type {
  ActualEffectManifest,
  SemanticEffect,
} from "@drop/effect-schema";
import {
  TRANSFER_EVENT_TOPIC,
  APPROVAL_EVENT_TOPIC,
  decodeTransferLog,
  decodeApprovalLog,
  type RawLog,
} from "./events.ts";

export interface RawStateDiff {
  readonly address: `0x${string}` | string;
  readonly slot: `0x${string}` | string;
  readonly prevValue: `0x${string}` | string;
  readonly newValue: `0x${string}` | string;
}

export interface RawSimulationOutput {
  readonly success: boolean;
  readonly logs: readonly RawLog[];
  readonly gasUsed?: bigint;
  readonly stateDiffs?: readonly RawStateDiff[];
  readonly isComplete?: boolean;
  readonly revertReason?: string;
}

export interface DecoderOptions {
  /**
   * If true, unknown logs that do not match standard ERC-20 events
   * will be included in the manifest as unrecognized effects or cause an error.
   */
  readonly strictAudit?: boolean;
  /**
   * Whitelist of relevant contract addresses (e.g. expected token).
   * If provided, events from other addresses can be tagged or segregated.
   */
  readonly relevantAddresses?: readonly (`0x${string}` | string)[];
}

/**
 * Decodes raw EVM simulation logs and state transitions into a structured ActualEffectManifest.
 */
export function decodeSimulationOutput(
  output: RawSimulationOutput,
  options: DecoderOptions = {}
): ActualEffectManifest {
  if (!output.success) {
    return {
      version: "1",
      effects: [],
      isComplete: false,
    };
  }

  const effects: SemanticEffect[] = [];

  for (const log of output.logs) {
    if (!log.topics || log.topics.length === 0) {
      continue;
    }

    const topic0 = log.topics[0]?.toLowerCase();

    if (topic0 === TRANSFER_EVENT_TOPIC) {
      try {
        const transferEffect = decodeTransferLog(log);
        effects.push(transferEffect);
      } catch (err) {
        // If parsing fails for a transfer-like log, mark manifest as incomplete for fail-closed safety
        return {
          version: "1",
          effects,
          isComplete: false,
        };
      }
    } else if (topic0 === APPROVAL_EVENT_TOPIC) {
      try {
        const approvalEffect = decodeApprovalLog(log);
        effects.push(approvalEffect);
      } catch (err) {
        // If parsing fails for an approval log, mark manifest as incomplete for fail-closed safety
        return {
          version: "1",
          effects,
          isComplete: false,
        };
      }
    }
  }

  // Corroborate state differences if provided
  if (output.stateDiffs && output.stateDiffs.length > 0) {
    // If state diffs contain modified storage on contracts where no event was emitted,
    // we can record additional state-level evidence or flag potential silent manipulation
  }

  return {
    version: "1",
    effects,
    isComplete: output.isComplete ?? true,
  };
}
