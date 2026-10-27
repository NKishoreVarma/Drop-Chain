import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareEffectManifests,
  evaluateFirewallDecision,
} from "../src/index.ts";
import type {
  ExpectedEffectManifest,
  ActualEffectManifest,
  ERC20TransferEffect,
  ERC20ApprovalEffect,
} from "@drop/effect-schema";
import { MAX_UINT256_STRING } from "@drop/effect-schema";

const TOKEN = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const SUPPLIER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ATTACKER = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const INTENT_HASH = ("0x" + "a".repeat(64)) as `0x${string}`;

const EXPECTED_TRANSFER: ERC20TransferEffect = {
  type: "ERC20_TRANSFER",
  token: TOKEN,
  from: SENDER,
  to: SUPPLIER,
  amount: "400000000",
};

const STEALTH_APPROVAL: ERC20ApprovalEffect = {
  type: "ERC20_APPROVAL",
  token: TOKEN,
  owner: SENDER,
  spender: ATTACKER,
  amount: MAX_UINT256_STRING,
  isUnlimited: true,
};

describe("Effect Comparator & Decision Engine", () => {
  it("ALLOW: exact match between expected and actual manifests", () => {
    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER],
    };

    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [EXPECTED_TRANSFER],
      isComplete: true,
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    assert.equal(diff.matches, true);
    assert.equal(diff.reasonCode, "EFFECT_MATCH");
    assert.equal(diff.unexpectedEffects.length, 0);
    assert.equal(diff.missingEffects.length, 0);

    const decision = evaluateFirewallDecision(diff);
    assert.equal(decision.verdict, "ALLOW");
    assert.equal(decision.reasonCode, "EFFECT_MATCH");
  });

  it("ALLOW: order-independence in multiset matching", () => {
    const secondTransfer: ERC20TransferEffect = {
      type: "ERC20_TRANSFER",
      token: TOKEN,
      from: SENDER,
      to: SUPPLIER,
      amount: "100000000",
    };

    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER, secondTransfer],
    };

    // Actual effects emitted in reverse order by EVM
    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [secondTransfer, EXPECTED_TRANSFER],
      isComplete: true,
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    assert.equal(diff.matches, true);
    assert.equal(diff.reasonCode, "EFFECT_MATCH");

    const decision = evaluateFirewallDecision(diff);
    assert.equal(decision.verdict, "ALLOW");
  });

  it("BLOCK: Case B stealth approval causes UNEXPECTED_APPROVAL and BLOCK", () => {
    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER],
    };

    // Actual simulation produced the expected transfer PLUS a stealth approval
    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [EXPECTED_TRANSFER, STEALTH_APPROVAL],
      isComplete: true,
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    assert.equal(diff.matches, false);
    assert.equal(diff.reasonCode, "UNEXPECTED_APPROVAL");
    assert.equal(diff.unexpectedEffects.length, 1);
    assert.equal(diff.unexpectedEffects[0].type, "ERC20_APPROVAL");

    const decision = evaluateFirewallDecision(diff);
    assert.equal(decision.verdict, "BLOCK");
    assert.equal(decision.reasonCode, "UNEXPECTED_APPROVAL");
  });

  it("BLOCK: extra unauthorized transfer causes UNEXPECTED_EFFECTS and BLOCK", () => {
    const unauthorizedTransfer: ERC20TransferEffect = {
      type: "ERC20_TRANSFER",
      token: TOKEN,
      from: SENDER,
      to: ATTACKER,
      amount: "1000000000",
    };

    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER],
    };

    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [EXPECTED_TRANSFER, unauthorizedTransfer],
      isComplete: true,
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    assert.equal(diff.matches, false);
    assert.equal(diff.reasonCode, "UNEXPECTED_EFFECTS");
    assert.equal(diff.unexpectedEffects.length, 1);

    const decision = evaluateFirewallDecision(diff);
    assert.equal(decision.verdict, "BLOCK");
  });

  it("BLOCK: missing expected transfer causes MISSING_EXPECTED_EFFECTS and BLOCK", () => {
    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER],
    };

    // Actual simulation emitted no effects
    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [],
      isComplete: true,
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    assert.equal(diff.matches, false);
    assert.equal(diff.reasonCode, "MISSING_EXPECTED_EFFECTS");
    assert.equal(diff.missingEffects.length, 1);

    const decision = evaluateFirewallDecision(diff);
    assert.equal(decision.verdict, "BLOCK");
  });

  it("BLOCK: fail-closed when simulation output is incomplete", () => {
    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER],
    };

    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [EXPECTED_TRANSFER],
      isComplete: false, // Incomplete trace
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    assert.equal(diff.matches, false);
    assert.equal(diff.reasonCode, "INSUFFICIENT_EVIDENCE");

    const decision = evaluateFirewallDecision(diff);
    assert.equal(decision.verdict, "BLOCK");
    assert.equal(decision.reasonCode, "INSUFFICIENT_EVIDENCE");
  });

  it("escalates to HUMAN_APPROVAL only when explicitly permitted by policy, but NEVER for approvals", () => {
    const unauthorizedTransfer: ERC20TransferEffect = {
      type: "ERC20_TRANSFER",
      token: TOKEN,
      from: SENDER,
      to: ATTACKER,
      amount: "5000000",
    };

    const expectedManifest: ExpectedEffectManifest = {
      version: "1",
      intentHash: INTENT_HASH,
      allowedEffects: [EXPECTED_TRANSFER],
    };

    const actualManifest: ActualEffectManifest = {
      version: "1",
      effects: [EXPECTED_TRANSFER, unauthorizedTransfer],
      isComplete: true,
    };

    const diff = compareEffectManifests(expectedManifest, actualManifest);
    const decision = evaluateFirewallDecision(diff, {
      allowHumanApprovalEscalation: true,
    });
    assert.equal(decision.verdict, "HUMAN_APPROVAL");

    // Contrast with stealth approval: must BLOCK even if escalation is enabled
    const approvalDiff = compareEffectManifests(expectedManifest, {
      version: "1",
      effects: [EXPECTED_TRANSFER, STEALTH_APPROVAL],
      isComplete: true,
    });
    const approvalDecision = evaluateFirewallDecision(approvalDiff, {
      allowHumanApprovalEscalation: true,
    });
    assert.equal(approvalDecision.verdict, "BLOCK");
  });
});
