import { MAX_UINT256_STRING } from "./types.ts";

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const INTEGER_STRING_REGEX = /^\d+$/;

/**
 * Validates whether a string is a 20-byte hexadecimal Ethereum address.
 */
export function isValidEthereumAddress(addr: string): addr is `0x${string}` {
  return typeof addr === "string" && ADDRESS_REGEX.test(addr);
}

/**
 * Normalizes an Ethereum address by ensuring lower-cased / hex-prefixed format,
 * or applying basic address validation.
 */
export function normalizeAddress(addr: string): `0x${string}` {
  if (!isValidEthereumAddress(addr)) {
    throw new Error(`Invalid Ethereum address: ${addr}`);
  }
  return addr.toLowerCase() as `0x${string}`;
}

/**
 * Normalizes an integer amount to a clean, non-negative decimal string.
 * Strictly rejects:
 * - Floating point numbers (e.g. 1.5, "1.5")
 * - Scientific notation (e.g. 1e18, "1e18")
 * - Negative numbers
 * - Leading zeros (unless strictly "0")
 */
export function normalizeAmount(amount: bigint | string | number): string {
  if (typeof amount === "bigint") {
    if (amount < 0n) {
      throw new Error(`Negative amount not allowed: ${amount}`);
    }
    return amount.toString();
  }

  if (typeof amount === "number") {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`Amount must be a non-negative safe integer: ${amount}`);
    }
    return amount.toString();
  }

  if (typeof amount === "string") {
    const trimmed = amount.trim();
    if (!INTEGER_STRING_REGEX.test(trimmed)) {
      throw new Error(
        `Amount string must be a non-negative integer decimal string: ${amount}`
      );
    }
    // Normalize any accidental "00" or leading zero strings to single canonical value
    return BigInt(trimmed).toString();
  }

  throw new Error(`Unsupported amount type: ${typeof amount}`);
}

/**
 * Determines whether an allowance amount represents unlimited approval.
 */
export function isUnlimitedAllowance(amount: string): boolean {
  try {
    const norm = normalizeAmount(amount);
    return norm === MAX_UINT256_STRING;
  } catch {
    return false;
  }
}
