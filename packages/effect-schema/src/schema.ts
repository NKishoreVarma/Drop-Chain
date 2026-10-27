import { z } from "zod";
import {
  EFFECT_TYPE_ERC20_TRANSFER,
  EFFECT_TYPE_ERC20_APPROVAL,
  EFFECT_TYPE_NATIVE_ETH_TRANSFER,
  MAX_UINT256_STRING,
} from "./types.ts";
import { isValidEthereumAddress } from "./normalize.ts";

const addressSchema = z.string().refine((val) => isValidEthereumAddress(val), {
  message: "Must be a valid 20-byte hexadecimal Ethereum address",
});

const decimalAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/, {
  message: "Amount must be a non-negative integer decimal string without floats or signs",
});

const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, {
  message: "Must be a 32-byte hex string",
});

export const evidenceSchema = z.object({
  source: z.enum(["EVENT_LOG", "CALL_TRACE", "STATE_DIFF"]),
  contractAddress: addressSchema,
  logIndex: z.number().int().nonnegative().optional(),
  txHash: hex32Schema.optional(),
});

export const erc20TransferEffectSchema = z.object({
  type: z.literal(EFFECT_TYPE_ERC20_TRANSFER),
  token: addressSchema,
  from: addressSchema,
  to: addressSchema,
  amount: decimalAmountSchema,
  evidence: evidenceSchema.optional(),
});

export const erc20ApprovalEffectSchema = z
  .object({
    type: z.literal(EFFECT_TYPE_ERC20_APPROVAL),
    token: addressSchema,
    owner: addressSchema,
    spender: addressSchema,
    amount: decimalAmountSchema,
    isUnlimited: z.boolean(),
    evidence: evidenceSchema.optional(),
  })
  .refine(
    (data) => {
      // isUnlimited must align with whether amount == MAX_UINT256_STRING
      const isMax = data.amount === MAX_UINT256_STRING;
      return data.isUnlimited === isMax;
    },
    {
      message: "isUnlimited flag must strictly match whether amount equals MAX_UINT256",
    }
  );

export const nativeEthTransferEffectSchema = z.object({
  type: z.literal(EFFECT_TYPE_NATIVE_ETH_TRANSFER),
  from: addressSchema,
  to: addressSchema,
  amount: decimalAmountSchema,
  evidence: evidenceSchema.optional(),
});

export const semanticEffectSchema = z.union([
  erc20TransferEffectSchema,
  erc20ApprovalEffectSchema,
  nativeEthTransferEffectSchema,
]);

export const expectedEffectManifestSchema = z.object({
  version: z.literal("1"),
  intentHash: hex32Schema,
  allowedEffects: z.array(semanticEffectSchema),
});

export const actualEffectManifestSchema = z.object({
  version: z.literal("1"),
  effects: z.array(semanticEffectSchema),
  isComplete: z.boolean(),
});
