import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import {
  buildCanonicalTransaction,
  ERC20_TRANSFER_SELECTOR,
  ERC20_TRANSFER_ABI,
} from "../src/index.ts";

const VALID_MANDATE_ID = "0x" + "a".repeat(64);
const VALID_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const VALID_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("Canonical Transaction Builder — Determinism & Invariants", () => {
  const baseIntent = {
    version: "1",
    kind: "ERC20_TRANSFER",
    chainId: 84532,
    account: VALID_ACCOUNT,
    token: VALID_TOKEN,
    recipient: VALID_RECIPIENT,
    amount: "400000000",
    purpose: "supplier_payment",
    mandateId: VALID_MANDATE_ID,
  };

  it("produces correct ERC20 target matching intent.token", () => {
    const result = buildCanonicalTransaction(baseIntent);
    assert.equal(result.transaction.target, VALID_TOKEN);
  });

  it("strictly enforces zero native ETH value (value == 0n)", () => {
    const result = buildCanonicalTransaction(baseIntent);
    assert.equal(result.transaction.value, 0n);
  });

  it("produces correct selector (0xa9059cbb) for ERC20 transfer", () => {
    const result = buildCanonicalTransaction(baseIntent);
    assert.ok(result.transaction.callData.startsWith(ERC20_TRANSFER_SELECTOR));
  });

  it("decodes to exact intended recipient and amount", () => {
    const result = buildCanonicalTransaction(baseIntent);
    const decoded = decodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      data: result.transaction.callData,
    });

    assert.equal(decoded.functionName, "transfer");
    assert.ok(decoded.args);
    const [recipient, amount] = decoded.args as [string, bigint];
    assert.equal(recipient.toLowerCase(), VALID_RECIPIENT.toLowerCase());
    assert.equal(amount, 400000000n);
  });

  it("is 100% deterministic (repeated calls produce byte-for-byte identical output)", () => {
    const res1 = buildCanonicalTransaction(baseIntent);
    const res2 = buildCanonicalTransaction(baseIntent);

    assert.equal(res1.transaction.callData, res2.transaction.callData);
    assert.equal(res1.executionData.accountCalldata, res2.executionData.accountCalldata);
    assert.equal(res1.executionData.executionCalldata, res2.executionData.executionCalldata);
    assert.equal(res1.intentHash, res2.intentHash);
  });

  it("rejects malformed intent before generating any transaction", () => {
    const malformed = {
      ...baseIntent,
      amount: "-100", // invalid negative amount
    };

    assert.throws(() => {
      buildCanonicalTransaction(malformed);
    });
  });

  it("security invariant: builder strictly preserves parameters without silent alteration", () => {
    const modifiedRecipientIntent = {
      ...baseIntent,
      recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    };

    const resOriginal = buildCanonicalTransaction(baseIntent);
    const resModified = buildCanonicalTransaction(modifiedRecipientIntent);

    assert.notEqual(resOriginal.transaction.callData, resModified.transaction.callData);
    assert.notEqual(resOriginal.intentHash, resModified.intentHash);
  });
});
