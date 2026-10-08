import { getAddress, keccak256, stringToBytes } from "viem";
import {
  validateIntent,
  INTENT_VERSION_V1,
  INTENT_KIND_ERC20_TRANSFER,
} from "./schema.ts";
import type { ERC20TransferIntent } from "./schema.ts";

/**
 * Normalized canonical representation of an ERC20_TRANSFER intent.
 * Guarantees checksummed addresses, normalized decimal strings, and explicit field types.
 */
export interface CanonicalERC20TransferIntent {
  readonly account: `0x${string}`;
  readonly amount: string;
  readonly chainId: number;
  readonly kind: typeof INTENT_KIND_ERC20_TRANSFER;
  readonly mandateId: `0x${string}`;
  readonly purpose: string;
  readonly recipient: `0x${string}`;
  readonly token: `0x${string}`;
  readonly version: typeof INTENT_VERSION_V1;
}

export interface CanonicalIntentResult {
  readonly canonical: CanonicalERC20TransferIntent;
  readonly canonicalJson: string;
  readonly intentHash: `0x${string}`;
}

/**
 * Fixed deterministic field order for canonical serialization.
 * Explicitly independent of JavaScript engine object insertion order.
 */
export const CANONICAL_FIELD_KEYS = [
  "account",
  "amount",
  "chainId",
  "kind",
  "mandateId",
  "purpose",
  "recipient",
  "token",
  "version",
] as const;

/**
 * Normalizes and canonicalizes a raw or validated ERC-20 transfer intent.
 * 1. Validates schema strictly.
 * 2. Normalizes addresses with EIP-55 checksumming (`getAddress`).
 * 3. Normalizes numeric amounts (no leading zeros).
 * 4. Normalizes mandateId to lowercase hex string.
 * 5. Serializes with deterministic key ordering.
 * 6. Calculates stable Keccak256 hash.
 */
export function canonicalizeIntent(raw: unknown): CanonicalIntentResult {
  const validated: ERC20TransferIntent = validateIntent(raw);

  // Normalize fields deterministically
  const account = getAddress(validated.account);
  const token = getAddress(validated.token);
  const recipient = getAddress(validated.recipient);
  const amount = BigInt(validated.amount).toString(10);
  const mandateId = validated.mandateId.toLowerCase() as `0x${string}`;
  const purpose = validated.purpose.trim();

  const canonical: CanonicalERC20TransferIntent = Object.freeze({
    account,
    amount,
    chainId: validated.chainId,
    kind: INTENT_KIND_ERC20_TRANSFER,
    mandateId,
    purpose,
    recipient,
    token,
    version: INTENT_VERSION_V1,
  });

  // Deterministic serialization with strictly ordered keys
  const serializedEntries = CANONICAL_FIELD_KEYS.map((key) => {
    const value = canonical[key];
    return `${JSON.stringify(key)}:${JSON.stringify(value)}`;
  });
  const canonicalJson = `{${serializedEntries.join(",")}}`;

  // Compute stable cryptographic hash
  const intentHash = keccak256(stringToBytes(canonicalJson));

  return {
    canonical,
    canonicalJson,
    intentHash,
  };
}
