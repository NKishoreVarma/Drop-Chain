import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeIntent } from "@drop/intent-schema";
import {
  buildExpectedEffect,
  buildExpectedEffectManifest,
  buildCanonicalTransaction,
} from "../src/index.ts";

const VALID_MANDATE_ID = "0x" + "a".repeat(64);
const VALID_ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const VALID_TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const VALID_RECIPIENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

describe("Expected Effect Derivation — Invariants", () => {
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

  it("derives expected effect purely and deterministically from intent", () => {
    const { canonical, intentHash } = canonicalizeIntent(baseIntent);
    const effect = buildExpectedEffect(canonical);

    assert.equal(effect.type, "ERC20_TRANSFER");
    assert.equal(effect.from, VALID_ACCOUNT);
    assert.equal(effect.to, VALID_RECIPIENT);
    assert.equal(effect.token, VALID_TOKEN);
    assert.equal(effect.amount, "400000000");

    const manifest = buildExpectedEffectManifest(canonical, intentHash);
    assert.equal(manifest.version, "1");
    assert.equal(manifest.intentHash, intentHash);
    assert.equal(manifest.allowedEffects.length, 1);
    assert.deepEqual(manifest.allowedEffects[0], effect);
  });

  it("buildCanonicalTransaction includes expected effect and manifest matching standalone derivation", () => {
    const result = buildCanonicalTransaction(baseIntent);
    assert.equal(result.expectedEffect.amount, "400000000");
    assert.equal(result.expectedEffect.to, VALID_RECIPIENT);
    assert.equal(result.expectedManifest.intentHash, result.intentHash);
    assert.equal(result.expectedManifest.allowedEffects.length, 1);
  });

  it("produces different expected effect when amount or recipient changes", () => {
    const resA = buildCanonicalTransaction(baseIntent);
    const resB = buildCanonicalTransaction({ ...baseIntent, amount: "600000000" });

    assert.notEqual(resA.expectedEffect.amount, resB.expectedEffect.amount);
    assert.notEqual(resA.expectedManifest.intentHash, resB.expectedManifest.intentHash);
  });
});
