import { z } from "zod";
import { isAddress, getAddress } from "viem";

export const INTENT_VERSION_V1 = "1" as const;
export const INTENT_KIND_ERC20_TRANSFER = "ERC20_TRANSFER" as const;

export type IntentVersion = typeof INTENT_VERSION_V1;
export type IntentKind = typeof INTENT_KIND_ERC20_TRANSFER;

/**
 * Strict schema for ERC20_TRANSFER intent.
 * Enforces positive integer string for amount (no floats, no negative amounts, no scientific notation).
 * Validates checksum/hex Ethereum addresses and 32-byte hex mandate ID.
 * Strict mode rejects any unexpected or extraneous fields.
 */
export const erc20TransferIntentSchema = z
  .object({
    version: z.literal(INTENT_VERSION_V1, {
      errorMap: () => ({ message: `Version must be '${INTENT_VERSION_V1}'` }),
    }),
    kind: z.literal(INTENT_KIND_ERC20_TRANSFER, {
      errorMap: () => ({ message: `Kind must be '${INTENT_KIND_ERC20_TRANSFER}'` }),
    }),
    chainId: z.number().int().positive({ message: "Chain ID must be a positive integer" }),
    account: z.string().refine((val) => isAddress(val), {
      message: "Account must be a valid Ethereum address",
    }),
    token: z.string().refine((val) => isAddress(val), {
      message: "Token must be a valid Ethereum address",
    }),
    recipient: z.string().refine((val) => isAddress(val), {
      message: "Recipient must be a valid Ethereum address",
    }),
    amount: z
      .string()
      .regex(/^[1-9]\d*$/, {
        message: "Amount must be a positive non-zero integer decimal string without floats or signs",
      }),
    purpose: z
      .string()
      .min(1, { message: "Purpose must not be empty" })
      .max(256, { message: "Purpose must not exceed 256 characters" }),
    mandateId: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/, {
        message: "Mandate ID must be a valid 32-byte hex string (0x...)",
      }),
  })
  .strict({
    message: "Unexpected extra fields are strictly rejected in intent schema",
  });

export type ERC20TransferIntent = z.infer<typeof erc20TransferIntentSchema>;

/**
 * Validates untrusted raw intent input.
 * Throws ZodError if validation fails.
 */
export function validateIntent(raw: unknown): ERC20TransferIntent {
  return erc20TransferIntentSchema.parse(raw);
}

/**
 * Safely validates untrusted raw intent input.
 */
export function safeValidateIntent(raw: unknown):
  | { success: true; data: ERC20TransferIntent }
  | { success: false; error: z.ZodError } {
  const result = erc20TransferIntentSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
