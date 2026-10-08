import { encodeFunctionData, concat, pad } from "viem";
import { canonicalizeIntent } from "@drop/intent-schema";
import type {
  CanonicalERC20TransferIntent,
  CanonicalIntentResult,
} from "@drop/intent-schema";
import {
  ERC20_TRANSFER_ABI,
  ERC20_TRANSFER_SELECTOR,
} from "./interfaces.ts";
import type {
  CanonicalTransaction,
  ERC7579ExecutionData,
  ExpectedERC20TransferEffect,
  ExpectedEffectManifest,
} from "./interfaces.ts";
import { buildExpectedEffect, buildExpectedEffectManifest } from "./effect.ts";

export const EXECUTE_ABI = [
  {
    name: "execute",
    type: "function",
    inputs: [
      { name: "mode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export interface CanonicalBuilderResult {
  readonly canonicalIntent: CanonicalERC20TransferIntent;
  readonly intentHash: `0x${string}`;
  readonly transaction: CanonicalTransaction;
  readonly executionData: ERC7579ExecutionData;
  readonly expectedEffect: ExpectedERC20TransferEffect;
  readonly expectedManifest: ExpectedEffectManifest;
}

/**
 * Pure, deterministic compiler translating an untrusted intent into:
 * 1. Normalized Canonical Intent & Hash.
 * 2. Canonical Low-Level Transaction parameters (target, value = 0, callData).
 * 3. ERC-7579 execution payload matching ModularSmartAccount.execute layout.
 * 4. Deterministic Expected Effect & Manifest.
 *
 * Security Invariants:
 * - Selector is strictly 0xa9059cbb (transfer).
 * - Native value is strictly 0n.
 * - Target is strictly intent.token.
 * - Recipient is strictly intent.recipient.
 * - Amount is strictly intent.amount.
 * - Any malformed or unauthorized input is rejected before compilation.
 */
export function buildCanonicalTransaction(rawIntent: unknown): CanonicalBuilderResult {
  // 1. Strict validation, normalization, and hashing
  const { canonical, intentHash }: CanonicalIntentResult = canonicalizeIntent(rawIntent);

  // 2. Encode ERC-20 transfer(recipient, amount) using standard viem encoder
  const callData = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [canonical.recipient, BigInt(canonical.amount)],
  });

  // Verify selector invariant
  if (!callData.startsWith(ERC20_TRANSFER_SELECTOR)) {
    throw new Error(
      `Invariant violation: Encoded selector does not match ERC20_TRANSFER_SELECTOR (${ERC20_TRANSFER_SELECTOR})`
    );
  }

  // 3. Low-level canonical transaction parameters
  const transaction: CanonicalTransaction = Object.freeze({
    target: canonical.token,
    value: 0n,
    callData,
  });

  // 4. ERC-7579 execution structure for ModularSmartAccount
  // mode: 32 bytes 0x00 (single call, revert on failure)
  const mode = pad("0x00", { size: 32 });

  // executionCalldata: target (20 bytes) + value (32 bytes zero) + callData (68 bytes) = 120 bytes
  const executionCalldata = concat([
    canonical.token,
    pad("0x00", { size: 32 }),
    callData,
  ]);

  // Outer smart account calldata for execute(mode, executionCalldata)
  const accountCalldata = encodeFunctionData({
    abi: EXECUTE_ABI,
    functionName: "execute",
    args: [mode, executionCalldata],
  });

  const executionData: ERC7579ExecutionData = Object.freeze({
    mode,
    executionCalldata,
    accountCalldata,
  });

  // 5. Canonical Expected Effect & Manifest
  const expectedEffect = buildExpectedEffect(canonical);
  const expectedManifest = buildExpectedEffectManifest(canonical, intentHash);

  return {
    canonicalIntent: canonical,
    intentHash,
    transaction,
    executionData,
    expectedEffect,
    expectedManifest,
  };
}
