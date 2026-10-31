import { z } from "zod";

export const AuditDecisionSchema = z.enum(["APPROVED", "BLOCKED"]);
export type AuditDecision = z.infer<typeof AuditDecisionSchema>;

export const Hex32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Must be a 32-byte hex string (0x + 64 hex characters)");

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 20-byte hex address");

export const AuditReceiptSchema = z.object({
  receiptId: Hex32Schema,
  mandateHash: Hex32Schema,
  intentHash: Hex32Schema,
  canonicalTxHash: Hex32Schema,
  simulationHash: Hex32Schema,
  effectDiffHash: Hex32Schema,
  userOpHash: Hex32Schema,
  account: AddressSchema,
  sessionKey: AddressSchema,
  timestamp: z.number().int().nonnegative(),
  decision: AuditDecisionSchema,
  reason: z.string(),
});
export type AuditReceipt = z.infer<typeof AuditReceiptSchema>;

export const AuditProofBundleSchema = z.object({
  receipt: AuditReceiptSchema,
  metadata: z.object({
    agentPrompt: z.string().optional(),
    blockNumber: z.number().int().optional(),
    chainId: z.number().int().positive(),
    clientVersion: z.string().default("drop-v1"),
  }),
});
export type AuditProofBundle = z.infer<typeof AuditProofBundleSchema>;
