/**
 * Maximum uint256 constant string representing unlimited token allowance.
 */
export const MAX_UINT256_STRING =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935" as const;

export const EFFECT_TYPE_ERC20_TRANSFER = "ERC20_TRANSFER" as const;
export const EFFECT_TYPE_ERC20_APPROVAL = "ERC20_APPROVAL" as const;
export const EFFECT_TYPE_NATIVE_ETH_TRANSFER = "NATIVE_ETH_TRANSFER" as const;

export type EffectType =
  | typeof EFFECT_TYPE_ERC20_TRANSFER
  | typeof EFFECT_TYPE_ERC20_APPROVAL
  | typeof EFFECT_TYPE_NATIVE_ETH_TRANSFER;

/**
 * Origin and evidence provenance for a decoded actual effect.
 */
export type EvidenceSource = "EVENT_LOG" | "CALL_TRACE" | "STATE_DIFF";

export interface EffectEvidence {
  readonly source: EvidenceSource;
  readonly contractAddress: `0x${string}`;
  readonly logIndex?: number;
  readonly txHash?: `0x${string}`;
}

/**
 * ERC-20 transfer effect representation.
 * All amounts are non-negative integer decimal strings (no floats, no scientific notation).
 */
export interface ERC20TransferEffect {
  readonly type: typeof EFFECT_TYPE_ERC20_TRANSFER;
  readonly token: `0x${string}`;
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly amount: string;
  readonly evidence?: EffectEvidence;
}

/**
 * ERC-20 approval effect representation.
 * Explicitly distinguishes unlimited approvals from bounded allowances.
 */
export interface ERC20ApprovalEffect {
  readonly type: typeof EFFECT_TYPE_ERC20_APPROVAL;
  readonly token: `0x${string}`;
  readonly owner: `0x${string}`;
  readonly spender: `0x${string}`;
  readonly amount: string;
  readonly isUnlimited: boolean;
  readonly evidence?: EffectEvidence;
}

/**
 * Native ETH transfer effect representation.
 */
export interface NativeEthTransferEffect {
  readonly type: typeof EFFECT_TYPE_NATIVE_ETH_TRANSFER;
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly amount: string;
  readonly evidence?: EffectEvidence;
}

/**
 * Union of all supported semantic effect types.
 */
export type SemanticEffect =
  | ERC20TransferEffect
  | ERC20ApprovalEffect
  | NativeEthTransferEffect;

/**
 * Versioned manifest of allowed/expected effects derived deterministically from intent.
 */
export interface ExpectedEffectManifest {
  readonly version: "1";
  readonly intentHash: `0x${string}`;
  readonly allowedEffects: readonly SemanticEffect[];
}

/**
 * Versioned manifest of actual effects observed and decoded from simulation.
 */
export interface ActualEffectManifest {
  readonly version: "1";
  readonly effects: readonly SemanticEffect[];
  readonly isComplete: boolean;
}
