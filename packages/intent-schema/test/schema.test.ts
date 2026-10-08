import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateIntent,
  safeValidateIntent,
  erc20TransferIntentSchema,
} from "../src/schema.ts";

const VALID_MANDATE_ID = "0x" + "a".repeat(64);
const VALID_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const VALID_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("Intent Schema — Validation & Security", () => {
  it("accepts a fully valid ERC20_TRANSFER intent", () => {
    const raw = {
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

    const validated = validateIntent(raw);
    assert.equal(validated.version, "1");
    assert.equal(validated.kind, "ERC20_TRANSFER");
    assert.equal(validated.amount, "400000000");
    assert.equal(validated.chainId, 84532);
  });

  it("rejects missing required fields (e.g. missing token)", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      // token missing
      recipient: VALID_RECIPIENT,
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("token")));
  });

  it("rejects missing recipient", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      // recipient missing
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("recipient")));
  });

  it("rejects malformed address", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: "0xnotanaddress",
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("account")));
  });

  it("rejects zero amount", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "0",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("amount")));
  });

  it("rejects negative amount", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "-400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("amount")));
  });

  it("rejects floating-point amount", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "400.5",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("amount")));
  });

  it("rejects scientific notation in amount", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "1e18",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
  });

  it("rejects unknown intent kind", () => {
    const raw = {
      version: "1",
      kind: "UNLIMITED_APPROVAL",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("kind")));
  });

  it("rejects unexpected extra fields (strict schema mode)", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
      extraMaliciousField: "approve_unlimited",
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
  });

  it("rejects invalid chainId format (negative or zero or non-integer)", () => {
    const rawNegative = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: -1,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: VALID_MANDATE_ID,
    };

    assert.equal(safeValidateIntent(rawNegative).success, false);

    const rawFloat = {
      ...rawNegative,
      chainId: 84532.5,
    };
    assert.equal(safeValidateIntent(rawFloat).success, false);
  });

  it("rejects invalid mandateId format (non-32-byte hex)", () => {
    const raw = {
      version: "1",
      kind: "ERC20_TRANSFER",
      chainId: 84532,
      account: VALID_ACCOUNT,
      token: VALID_TOKEN,
      recipient: VALID_RECIPIENT,
      amount: "400000000",
      purpose: "supplier_payment",
      mandateId: "0x1234", // too short
    };

    const res = safeValidateIntent(raw);
    assert.equal(res.success, false);
    assert.ok(res.error.issues.some((i) => i.path.includes("mandateId")));
  });
});
