import type { CanonicalERC20TransferIntent } from "@drop/intent-schema";
import type {
  ExpectedERC20TransferEffect,
  ExpectedEffectManifest,
} from "./interfaces.ts";

/**
 * Derives the canonical expected effect deterministically from the canonical intent.
 * Invariant: There is NO LLM or external state involved.
 * The expected effect is a pure function of the canonical intent.
 */
export function buildExpectedEffect(
  intent: CanonicalERC20TransferIntent
): ExpectedERC20TransferEffect {
  return Object.freeze({
    type: "ERC20_TRANSFER" as const,
    token: intent.token,
    from: intent.account,
    to: intent.recipient,
    amount: intent.amount,
  });
}

/**
 * Derives the immutable Expected Effect Manifest for an intent and its cryptographic hash.
 */
export function buildExpectedEffectManifest(
  intent: CanonicalERC20TransferIntent,
  intentHash: `0x${string}`
): ExpectedEffectManifest {
  const effect = buildExpectedEffect(intent);
  return Object.freeze({
    version: "1" as const,
    intentHash,
    allowedEffects: Object.freeze([effect]),
  });
}
