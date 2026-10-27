import type {
  ERC20TransferEffect,
  ERC20ApprovalEffect,
} from "@drop/effect-schema";
import {
  EFFECT_TYPE_ERC20_TRANSFER,
  EFFECT_TYPE_ERC20_APPROVAL,
  MAX_UINT256_STRING,
  normalizeAddress,
  normalizeAmount,
} from "@drop/effect-schema";

export const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export const APPROVAL_EVENT_TOPIC =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925" as const;

export interface RawLog {
  readonly address: `0x${string}` | string;
  readonly topics: readonly (`0x${string}` | string)[];
  readonly data: `0x${string}` | string;
  readonly logIndex?: number;
  readonly transactionHash?: `0x${string}` | string;
}

/**
 * Parses a 20-byte Ethereum address from a 32-byte ABI-encoded topic word.
 */
export function parseAddressFromTopic(topic: string): `0x${string}` {
  if (!topic.startsWith("0x") || topic.length !== 66) {
    throw new Error(`Invalid topic format for address decoding: ${topic}`);
  }
  // The address is stored in the last 20 bytes (40 hex chars) of the 32-byte word
  const addressHex = "0x" + topic.slice(26);
  return normalizeAddress(addressHex);
}

/**
 * Parses a uint256 value from unindexed event data.
 */
export function parseUint256FromData(data: string): string {
  const cleanData = data.startsWith("0x") ? data.slice(2) : data;
  if (cleanData.length === 0) {
    return "0";
  }
  if (cleanData.length < 64) {
    throw new Error(`Data is too short to decode uint256: ${data}`);
  }
  // Read first 32-byte word
  const word = cleanData.slice(0, 64);
  const value = BigInt("0x" + word);
  return normalizeAmount(value);
}

/**
 * Decodes an ERC-20 Transfer event log into an ERC20TransferEffect.
 */
export function decodeTransferLog(log: RawLog): ERC20TransferEffect {
  if (log.topics.length < 3) {
    throw new Error(
      `ERC-20 Transfer log requires at least 3 topics, received: ${log.topics.length}`
    );
  }

  const token = normalizeAddress(log.address);
  const from = parseAddressFromTopic(log.topics[1]);
  const to = parseAddressFromTopic(log.topics[2]);
  const amount = parseUint256FromData(log.data);

  return {
    type: EFFECT_TYPE_ERC20_TRANSFER,
    token,
    from,
    to,
    amount,
    evidence: {
      source: "EVENT_LOG",
      contractAddress: token,
      logIndex: log.logIndex,
      txHash: log.transactionHash
        ? (log.transactionHash.toLowerCase() as `0x${string}`)
        : undefined,
    },
  };
}

/**
 * Decodes an ERC-20 Approval event log into an ERC20ApprovalEffect.
 */
export function decodeApprovalLog(log: RawLog): ERC20ApprovalEffect {
  if (log.topics.length < 3) {
    throw new Error(
      `ERC-20 Approval log requires at least 3 topics, received: ${log.topics.length}`
    );
  }

  const token = normalizeAddress(log.address);
  const owner = parseAddressFromTopic(log.topics[1]);
  const spender = parseAddressFromTopic(log.topics[2]);
  const amount = parseUint256FromData(log.data);
  const isUnlimited = amount === MAX_UINT256_STRING;

  return {
    type: EFFECT_TYPE_ERC20_APPROVAL,
    token,
    owner,
    spender,
    amount,
    isUnlimited,
    evidence: {
      source: "EVENT_LOG",
      contractAddress: token,
      logIndex: log.logIndex,
      txHash: log.transactionHash
        ? (log.transactionHash.toLowerCase() as `0x${string}`)
        : undefined,
    },
  };
}
