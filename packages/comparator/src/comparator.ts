import type {
  ExpectedEffectManifest,
  ActualEffectManifest,
  SemanticEffect,
  ERC20TransferEffect,
  ERC20ApprovalEffect,
  NativeEthTransferEffect,
} from "@drop/effect-schema";
import {
  EFFECT_TYPE_ERC20_TRANSFER,
  EFFECT_TYPE_ERC20_APPROVAL,
  EFFECT_TYPE_NATIVE_ETH_TRANSFER,
} from "@drop/effect-schema";

export interface EffectDiff {
  readonly matches: boolean;
  readonly unexpectedEffects: readonly SemanticEffect[];
  readonly missingEffects: readonly SemanticEffect[];
  readonly isComplete: boolean;
  readonly reasonCode: string;
  readonly description: string;
}

/**
 * Checks semantic equality between two effects.
 * Normalizes address casing and requires exact string amount matching.
 */
export function areEffectsEqual(a: SemanticEffect, b: SemanticEffect): boolean {
  if (a.type !== b.type) {
    return false;
  }

  if (a.type === EFFECT_TYPE_ERC20_TRANSFER && b.type === EFFECT_TYPE_ERC20_TRANSFER) {
    return (
      a.token.toLowerCase() === b.token.toLowerCase() &&
      a.from.toLowerCase() === b.from.toLowerCase() &&
      a.to.toLowerCase() === b.to.toLowerCase() &&
      a.amount === b.amount
    );
  }

  if (a.type === EFFECT_TYPE_ERC20_APPROVAL && b.type === EFFECT_TYPE_ERC20_APPROVAL) {
    return (
      a.token.toLowerCase() === b.token.toLowerCase() &&
      a.owner.toLowerCase() === b.owner.toLowerCase() &&
      a.spender.toLowerCase() === b.spender.toLowerCase() &&
      a.amount === b.amount &&
      a.isUnlimited === b.isUnlimited
    );
  }

  if (
    a.type === EFFECT_TYPE_NATIVE_ETH_TRANSFER &&
    b.type === EFFECT_TYPE_NATIVE_ETH_TRANSFER
  ) {
    return (
      a.from.toLowerCase() === b.from.toLowerCase() &&
      a.to.toLowerCase() === b.to.toLowerCase() &&
      a.amount === b.amount
    );
  }

  return false;
}

/**
 * Multiset comparison between ExpectedEffectManifest and ActualEffectManifest.
 * 
 * Invariants:
 * 1. Order-independent: The order of emitted events in the EVM does not alter matching.
 * 2. Multiplicity-preserving: Each expected effect must be matched 1:1 by an actual effect.
 * 3. Fail-closed: If actualManifest is marked incomplete, diff strictly fails.
 * 4. Zero tolerance for unapproved approvals: Stealth approvals are immediately isolated.
 */
export function compareEffectManifests(
  expectedManifest: ExpectedEffectManifest,
  actualManifest: ActualEffectManifest
): EffectDiff {
  // Fail-closed invariant: Incomplete simulation trace cannot result in a match
  if (!actualManifest.isComplete) {
    return {
      matches: false,
      unexpectedEffects: actualManifest.effects,
      missingEffects: expectedManifest.allowedEffects,
      isComplete: false,
      reasonCode: "INSUFFICIENT_EVIDENCE",
      description: "Simulation output is incomplete or execution reverted",
    };
  }

  // Work with a mutable copy of actual effects for 1:1 multiset matching
  const unmatchedActual: SemanticEffect[] = [...actualManifest.effects];
  const missingEffects: SemanticEffect[] = [];

  for (const expected of expectedManifest.allowedEffects) {
    const matchIndex = unmatchedActual.findIndex((actual) =>
      areEffectsEqual(expected, actual)
    );

    if (matchIndex !== -1) {
      // Consumed from multiset
      unmatchedActual.splice(matchIndex, 1);
    } else {
      missingEffects.push(expected);
    }
  }

  const unexpectedEffects = unmatchedActual;

  // Specific high-priority reason code for stealth approvals
  const hasStealthApproval = unexpectedEffects.some(
    (e) => e.type === EFFECT_TYPE_ERC20_APPROVAL
  );

  if (hasStealthApproval) {
    return {
      matches: false,
      unexpectedEffects,
      missingEffects,
      isComplete: true,
      reasonCode: "UNEXPECTED_APPROVAL",
      description: "Unauthorized ERC-20 approval detected in simulation",
    };
  }

  if (unexpectedEffects.length > 0) {
    return {
      matches: false,
      unexpectedEffects,
      missingEffects,
      isComplete: true,
      reasonCode: "UNEXPECTED_EFFECTS",
      description: `Observed ${unexpectedEffects.length} unauthorized side effect(s) in simulation`,
    };
  }

  if (missingEffects.length > 0) {
    return {
      matches: false,
      unexpectedEffects,
      missingEffects,
      isComplete: true,
      reasonCode: "MISSING_EXPECTED_EFFECTS",
      description: `Simulation failed to execute ${missingEffects.length} expected effect(s)`,
    };
  }

  return {
    matches: true,
    unexpectedEffects: [],
    missingEffects: [],
    isComplete: true,
    reasonCode: "EFFECT_MATCH",
    description: "Actual simulation effects match expected intent manifest exactly",
  };
}
