import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex, pad } from "viem";
import {
  buildAuditReceipt,
  computeReceiptId,
  verifyReceiptIntegrity,
  buildProofBundle,
  AuditReceiptSchema,
} from "../src/index.ts";

describe("Audit Trail — Proof Bundle & Invariants", () => {
  const dummyMandateHash = pad("0x01", { size: 32 });
  const dummyIntentHash = pad("0x02", { size: 32 });
  const dummyCanonicalTxHash = pad("0x03", { size: 32 });
  const dummySimulationHash = pad("0x04", { size: 32 });
  const dummyEffectDiffHash = pad("0x05", { size: 32 });
  const dummyUserOpHash = pad("0x06", { size: 32 });
  const dummyAccount = "0x1111111111111111111111111111111111111111" as const;
  const dummySessionKey = "0x2222222222222222222222222222222222222222" as const;

  test("computes deterministic receiptId for identical parameters", () => {
    const id1 = computeReceiptId({
      mandateHash: dummyMandateHash,
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
    });

    const id2 = computeReceiptId({
      mandateHash: dummyMandateHash,
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
    });

    assert.equal(id1, id2);
    assert.match(id1, /^0x[0-9a-fA-F]{64}$/);
  });

  test("produces different receiptId if any component hash changes", () => {
    const baseId = computeReceiptId({
      mandateHash: dummyMandateHash,
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
    });

    const alteredId = computeReceiptId({
      mandateHash: pad("0x99", { size: 32 }),
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
    });

    assert.notEqual(baseId, alteredId);
  });

  test("builds valid AuditReceipt matching schema", () => {
    const receipt = buildAuditReceipt({
      mandateHash: dummyMandateHash,
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
      account: dummyAccount,
      sessionKey: dummySessionKey,
      decision: "APPROVED",
      reason: "Simulation verified; all effects conform to mandate",
    });

    assert.equal(receipt.decision, "APPROVED");
    assert.equal(receipt.account, dummyAccount);
    assert.ok(verifyReceiptIntegrity(receipt));
  });

  test("detects tampered receipt via verifyReceiptIntegrity", () => {
    const receipt = buildAuditReceipt({
      mandateHash: dummyMandateHash,
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
      account: dummyAccount,
      sessionKey: dummySessionKey,
      decision: "BLOCKED",
      reason: "Unexpected approval detected during dry-run",
    });

    assert.ok(verifyReceiptIntegrity(receipt));

    // Tamper with mandateHash
    const tampered = {
      ...receipt,
      mandateHash: pad("0xfe", { size: 32 }),
    };

    assert.equal(verifyReceiptIntegrity(tampered), false);
  });

  test("builds and validates complete AuditProofBundle", () => {
    const receipt = buildAuditReceipt({
      mandateHash: dummyMandateHash,
      intentHash: dummyIntentHash,
      canonicalTxHash: dummyCanonicalTxHash,
      simulationHash: dummySimulationHash,
      effectDiffHash: dummyEffectDiffHash,
      userOpHash: dummyUserOpHash,
      account: dummyAccount,
      sessionKey: dummySessionKey,
      decision: "APPROVED",
      reason: "Simulation verified",
    });

    const bundle = buildProofBundle({
      receipt,
      chainId: 84532,
      agentPrompt: "Pay Supplier A invoice of 400 USDC",
    });

    assert.equal(bundle.metadata.chainId, 84532);
    assert.equal(bundle.metadata.agentPrompt, "Pay Supplier A invoice of 400 USDC");
    assert.equal(bundle.receipt.receiptId, receipt.receiptId);
  });

  test("rejects malformed address or hex hash in schema validation", () => {
    assert.throws(() => {
      AuditReceiptSchema.parse({
        receiptId: "not-a-hex",
        mandateHash: dummyMandateHash,
        intentHash: dummyIntentHash,
        canonicalTxHash: dummyCanonicalTxHash,
        simulationHash: dummySimulationHash,
        effectDiffHash: dummyEffectDiffHash,
        userOpHash: dummyUserOpHash,
        account: dummyAccount,
        sessionKey: dummySessionKey,
        timestamp: 12345,
        decision: "APPROVED",
        reason: "ok",
      });
    });
  });
});
