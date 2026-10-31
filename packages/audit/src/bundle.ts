import { encodePacked, keccak256, type Hex, type Address } from "viem";
import {
  AuditReceiptSchema,
  AuditProofBundleSchema,
  type AuditReceipt,
  type AuditProofBundle,
  type AuditDecision,
} from "./types.ts";

/**
 * Computes deterministic receiptId matching onchain DropAuditRegistry.computeReceiptId:
 * keccak256(abi.encodePacked(mandateHash, intentHash, canonicalTxHash, simulationHash, effectDiffHash, userOpHash))
 */
export function computeReceiptId(params: {
  mandateHash: Hex;
  intentHash: Hex;
  canonicalTxHash: Hex;
  simulationHash: Hex;
  effectDiffHash: Hex;
  userOpHash: Hex;
}): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
      [
        params.mandateHash,
        params.intentHash,
        params.canonicalTxHash,
        params.simulationHash,
        params.effectDiffHash,
        params.userOpHash,
      ]
    )
  );
}

/**
 * Builds and validates an AuditReceipt.
 */
export function buildAuditReceipt(params: {
  mandateHash: Hex;
  intentHash: Hex;
  canonicalTxHash: Hex;
  simulationHash: Hex;
  effectDiffHash: Hex;
  userOpHash: Hex;
  account: Address;
  sessionKey: Address;
  timestamp?: number;
  decision: AuditDecision;
  reason: string;
}): AuditReceipt {
  const receiptId = computeReceiptId({
    mandateHash: params.mandateHash,
    intentHash: params.intentHash,
    canonicalTxHash: params.canonicalTxHash,
    simulationHash: params.simulationHash,
    effectDiffHash: params.effectDiffHash,
    userOpHash: params.userOpHash,
  });

  const receipt: AuditReceipt = {
    receiptId,
    mandateHash: params.mandateHash,
    intentHash: params.intentHash,
    canonicalTxHash: params.canonicalTxHash,
    simulationHash: params.simulationHash,
    effectDiffHash: params.effectDiffHash,
    userOpHash: params.userOpHash,
    account: params.account,
    sessionKey: params.sessionKey,
    timestamp: params.timestamp ?? Math.floor(Date.now() / 1000),
    decision: params.decision,
    reason: params.reason,
  };

  return AuditReceiptSchema.parse(receipt);
}

/**
 * Verifies that receiptId matches the hash of its constituent parameters.
 */
export function verifyReceiptIntegrity(receipt: AuditReceipt): boolean {
  const expectedId = computeReceiptId({
    mandateHash: receipt.mandateHash as Hex,
    intentHash: receipt.intentHash as Hex,
    canonicalTxHash: receipt.canonicalTxHash as Hex,
    simulationHash: receipt.simulationHash as Hex,
    effectDiffHash: receipt.effectDiffHash as Hex,
    userOpHash: receipt.userOpHash as Hex,
  });

  return receipt.receiptId.toLowerCase() === expectedId.toLowerCase();
}

/**
 * Packages an AuditReceipt into an AuditProofBundle.
 */
export function buildProofBundle(params: {
  receipt: AuditReceipt;
  chainId: number;
  blockNumber?: number;
  agentPrompt?: string;
}): AuditProofBundle {
  const bundle: AuditProofBundle = {
    receipt: params.receipt,
    metadata: {
      chainId: params.chainId,
      blockNumber: params.blockNumber,
      agentPrompt: params.agentPrompt,
      clientVersion: "drop-v1",
    },
  };

  return AuditProofBundleSchema.parse(bundle);
}
