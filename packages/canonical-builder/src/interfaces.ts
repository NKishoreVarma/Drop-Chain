import type { CanonicalERC20TransferIntent } from "@drop/intent-schema";

/**
 * Standard ERC-20 transfer ABI definition for deterministic encoding.
 */
export const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const ERC20_TRANSFER_SELECTOR = "0xa9059cbb" as const;

/**
 * Minimal low-level canonical transaction parameters.
 */
export interface CanonicalTransaction {
  readonly target: `0x${string}`;
  readonly value: 0n;
  readonly callData: `0x${string}`;
}

/**
 * ERC-7579 single-call execution parameters accepted by ModularSmartAccount.
 */
export interface ERC7579ExecutionData {
  readonly mode: `0x${string}`;
  readonly executionCalldata: `0x${string}`;
  readonly accountCalldata: `0x${string}`;
}

/**
 * Canonical expected effect derived purely from intent.
 */
export interface ExpectedERC20TransferEffect {
  readonly type: "ERC20_TRANSFER";
  readonly token: `0x${string}`;
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly amount: string;
}

/**
 * Phase 3 Interface: Expected Effect Manifest.
 */
export interface ExpectedEffectManifest {
  readonly version: "1";
  readonly intentHash: `0x${string}`;
  readonly allowedEffects: readonly ExpectedERC20TransferEffect[];
}

/**
 * Phase 3 Interface: Observable actual effect decoded from transaction simulation.
 */
export interface ActualEffect {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Phase 3 Interface: Actual Effect Manifest decoded from simulation state transitions.
 */
export interface ActualEffectManifest {
  readonly version: "1";
  readonly effects: readonly ActualEffect[];
}

/**
 * Phase 3 Interface: EVM simulation execution trace & log output.
 */
export interface SimulationResult {
  readonly success: boolean;
  readonly gasUsed: bigint;
  readonly logs: readonly unknown[];
  readonly stateDiffs?: unknown;
  readonly revertReason?: string;
}

/**
 * Phase 3 Interface: Structured diff between expected effects and actual simulated effects.
 */
export interface EffectDiff {
  readonly matches: boolean;
  readonly unexpectedEffects: readonly ActualEffect[];
  readonly missingEffects: readonly ExpectedERC20TransferEffect[];
  readonly reason?: string;
}

/**
 * Phase 3 Interface: Firewall decision verdict.
 */
export type FirewallVerdict = "ALLOW" | "HUMAN_APPROVAL" | "BLOCK";

export interface FirewallDecision {
  readonly verdict: FirewallVerdict;
  readonly reason: string;
  readonly intent: CanonicalERC20TransferIntent;
  readonly expectedManifest: ExpectedEffectManifest;
  readonly actualManifest?: ActualEffectManifest;
  readonly diff?: EffectDiff;
}
