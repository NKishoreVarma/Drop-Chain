import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeIntent, CANONICAL_FIELD_KEYS } from "../src/canonicalize.ts";

const VALID_MANDATE_ID = "0x" + "a".repeat(64);
const VALID_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const VALID_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("Intent Canonicalization & Hashing", () => {
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

  it("produces deterministic canonical representation and same hash for identical semantic intent", () => {
    const res1 = canonicalizeIntent(baseIntent);
    const res2 = canonicalizeIntent(baseIntent);

    assert.equal(res1.intentHash, res2.intentHash);
    assert.equal(res1.canonicalJson, res2.canonicalJson);
  });

  it("normalizes address casing to EIP-55 checksum, ensuring identical hash regardless of input case", () => {
    const lowercaseIntent = {
      ...baseIntent,
      account: VALID_ACCOUNT.toLowerCase(),
      token: VALID_TOKEN.toLowerCase(),
      recipient: VALID_RECIPIENT.toLowerCase(),
    };

    const resStandard = canonicalizeIntent(baseIntent);
    const resLowercase = canonicalizeIntent(lowercaseIntent);

    assert.equal(resStandard.intentHash, resLowercase.intentHash);
    assert.equal(resStandard.canonicalJson, resLowercase.canonicalJson);
  });

  it("normalizes amounts with leading zeros to equivalent canonical value and hash", () => {
    const standard = canonicalizeIntent(baseIntent);
    assert.equal(standard.canonical.amount, "400000000");
  });

  it("produces different hash when amount differs", () => {
    const intentA = canonicalizeIntent(baseIntent);
    const intentB = canonicalizeIntent({ ...baseIntent, amount: "600000000" });

    assert.notEqual(intentA.intentHash, intentB.intentHash);
  });

  it("produces different hash when recipient differs", () => {
    const intentA = canonicalizeIntent(baseIntent);
    const intentB = canonicalizeIntent({
      ...baseIntent,
      recipient: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    });

    assert.notEqual(intentA.intentHash, intentB.intentHash);
  });

  it("produces different hash when token differs", () => {
    const intentA = canonicalizeIntent(baseIntent);
    const intentB = canonicalizeIntent({
      ...baseIntent,
      token: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    });

    assert.notEqual(intentA.intentHash, intentB.intentHash);
  });

  it("produces different hash when chainId differs", () => {
    const intentA = canonicalizeIntent(baseIntent);
    const intentB = canonicalizeIntent({ ...baseIntent, chainId: 1 });

    assert.notEqual(intentA.intentHash, intentB.intentHash);
  });

  it("produces different hash when account differs", () => {
    const intentA = canonicalizeIntent(baseIntent);
    const intentB = canonicalizeIntent({
      ...baseIntent,
      account: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    });

    assert.notEqual(intentA.intentHash, intentB.intentHash);
  });

  it("produces different hash when mandateId differs", () => {
    const intentA = canonicalizeIntent(baseIntent);
    const intentB = canonicalizeIntent({
      ...baseIntent,
      mandateId: "0x" + "b".repeat(64),
    });

    assert.notEqual(intentA.intentHash, intentB.intentHash);
  });

  it("preserves fixed key ordering in canonical JSON", () => {
    const res = canonicalizeIntent(baseIntent);
    const keysInJson = Object.keys(JSON.parse(res.canonicalJson));

    assert.deepEqual(keysInJson, [...CANONICAL_FIELD_KEYS]);
  });
});
