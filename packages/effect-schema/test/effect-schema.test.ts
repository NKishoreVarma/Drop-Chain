import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  erc20TransferEffectSchema,
  erc20ApprovalEffectSchema,
  expectedEffectManifestSchema,
  actualEffectManifestSchema,
  normalizeAmount,
  normalizeAddress,
  isUnlimitedAllowance,
  MAX_UINT256_STRING,
} from "../src/index.ts";

const VALID_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const VALID_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const VALID_ATTACKER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const VALID_INTENT_HASH = ("0x" + "b".repeat(64)) as `0x${string}`;

describe("Effect Schema — Validation & Security Invariants", () => {
  it("accepts a valid ERC20_TRANSFER effect", () => {
    const raw = {
      type: "ERC20_TRANSFER",
      token: VALID_TOKEN,
      from: VALID_ACCOUNT,
      to: VALID_RECIPIENT,
      amount: "400000000",
      evidence: {
        source: "EVENT_LOG",
        contractAddress: VALID_TOKEN,
        logIndex: 0,
      },
    };

    const parsed = erc20TransferEffectSchema.parse(raw);
    assert.equal(parsed.type, "ERC20_TRANSFER");
    assert.equal(parsed.amount, "400000000");
  });

  it("accepts a valid bounded ERC20_APPROVAL effect", () => {
    const raw = {
      type: "ERC20_APPROVAL",
      token: VALID_TOKEN,
      owner: VALID_ACCOUNT,
      spender: VALID_RECIPIENT,
      amount: "500000000",
      isUnlimited: false,
    };

    const parsed = erc20ApprovalEffectSchema.parse(raw);
    assert.equal(parsed.type, "ERC20_APPROVAL");
    assert.equal(parsed.isUnlimited, false);
  });

  it("accepts a valid unlimited ERC20_APPROVAL effect with MAX_UINT256", () => {
    const raw = {
      type: "ERC20_APPROVAL",
      token: VALID_TOKEN,
      owner: VALID_ACCOUNT,
      spender: VALID_ATTACKER,
      amount: MAX_UINT256_STRING,
      isUnlimited: true,
      evidence: {
        source: "EVENT_LOG",
        contractAddress: VALID_TOKEN,
        logIndex: 1,
      },
    };

    const parsed = erc20ApprovalEffectSchema.parse(raw);
    assert.equal(parsed.amount, MAX_UINT256_STRING);
    assert.equal(parsed.isUnlimited, true);
  });

  it("rejects approval when isUnlimited is true but amount is bounded", () => {
    const raw = {
      type: "ERC20_APPROVAL",
      token: VALID_TOKEN,
      owner: VALID_ACCOUNT,
      spender: VALID_ATTACKER,
      amount: "1000000",
      isUnlimited: true, // Invalid mismatch
    };

    const res = erc20ApprovalEffectSchema.safeParse(raw);
    assert.equal(res.success, false);
  });

  it("rejects approval when isUnlimited is false but amount is MAX_UINT256", () => {
    const raw = {
      type: "ERC20_APPROVAL",
      token: VALID_TOKEN,
      owner: VALID_ACCOUNT,
      spender: VALID_ATTACKER,
      amount: MAX_UINT256_STRING,
      isUnlimited: false, // Invalid mismatch
    };

    const res = erc20ApprovalEffectSchema.safeParse(raw);
    assert.equal(res.success, false);
  });

  it("strictly rejects floating point amounts", () => {
    const raw = {
      type: "ERC20_TRANSFER",
      token: VALID_TOKEN,
      from: VALID_ACCOUNT,
      to: VALID_RECIPIENT,
      amount: "400.5",
    };

    const res = erc20TransferEffectSchema.safeParse(raw);
    assert.equal(res.success, false);
    assert.throws(() => normalizeAmount("400.5"));
  });

  it("strictly rejects scientific notation amounts", () => {
    const raw = {
      type: "ERC20_TRANSFER",
      token: VALID_TOKEN,
      from: VALID_ACCOUNT,
      to: VALID_RECIPIENT,
      amount: "1e18",
    };

    const res = erc20TransferEffectSchema.safeParse(raw);
    assert.equal(res.success, false);
    assert.throws(() => normalizeAmount("1e18"));
  });

  it("strictly rejects negative amounts", () => {
    assert.throws(() => normalizeAmount("-100"));
    assert.throws(() => normalizeAmount(-100));
    assert.throws(() => normalizeAmount(-100n));
  });

  it("strictly rejects malformed Ethereum addresses", () => {
    const raw = {
      type: "ERC20_TRANSFER",
      token: "0xnotanaddress",
      from: VALID_ACCOUNT,
      to: VALID_RECIPIENT,
      amount: "400000000",
    };

    const res = erc20TransferEffectSchema.safeParse(raw);
    assert.equal(res.success, false);
    assert.throws(() => normalizeAddress("0xnotanaddress"));
  });

  it("normalizes addresses and amounts correctly", () => {
    assert.equal(normalizeAmount(400n), "400");
    assert.equal(normalizeAmount(500), "500");
    assert.equal(normalizeAmount("0600"), "600");
    assert.equal(normalizeAmount("0"), "0");
    assert.equal(isUnlimitedAllowance(MAX_UINT256_STRING), true);
    assert.equal(isUnlimitedAllowance("1000000"), false);
  });

  it("validates full ExpectedEffectManifest and ActualEffectManifest", () => {
    const expectedManifest = {
      version: "1",
      intentHash: VALID_INTENT_HASH,
      allowedEffects: [
        {
          type: "ERC20_TRANSFER",
          token: VALID_TOKEN,
          from: VALID_ACCOUNT,
          to: VALID_RECIPIENT,
          amount: "400000000",
        },
      ],
    };

    const parsedExpected = expectedEffectManifestSchema.parse(expectedManifest);
    assert.equal(parsedExpected.version, "1");
    assert.equal(parsedExpected.allowedEffects.length, 1);

    const actualManifest = {
      version: "1",
      effects: [
        {
          type: "ERC20_TRANSFER",
          token: VALID_TOKEN,
          from: VALID_ACCOUNT,
          to: VALID_RECIPIENT,
          amount: "400000000",
          evidence: {
            source: "EVENT_LOG",
            contractAddress: VALID_TOKEN,
            logIndex: 0,
          },
        },
      ],
      isComplete: true,
    };

    const parsedActual = actualEffectManifestSchema.parse(actualManifest);
    assert.equal(parsedActual.version, "1");
    assert.equal(parsedActual.isComplete, true);
  });
});
