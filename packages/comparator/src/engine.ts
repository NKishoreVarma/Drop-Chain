import type { EffectDiff } from "./comparator.ts";

export type FirewallVerdict = "ALLOW" | "HUMAN_APPROVAL" | "BLOCK";

export interface DecisionEnginePolicy {
  /**
   * If true, non-critical deviations (e.g., slight slippage or minor extra balance changes)
   * can escalate to HUMAN_APPROVAL instead of immediate BLOCK.
   * By default, policy is strict (fail-closed).
   */
  readonly allowHumanApprovalEscalation?: boolean;
}

export interface FirewallDecision {
  readonly verdict: FirewallVerdict;
  readonly reasonCode: string;
  readonly description: string;
  readonly diff: EffectDiff;
  readonly timestamp: number;
}

/**
 * Evaluates the multiset effect diff and issues a deterministic firewall decision:
 * ALLOW, HUMAN_APPROVAL, or BLOCK.
 */
export function evaluateFirewallDecision(
  diff: EffectDiff,
  policy: DecisionEnginePolicy = {}
): FirewallDecision {
  const timestamp = Date.now();

  if (diff.matches) {
    return {
      verdict: "ALLOW",
      reasonCode: "EFFECT_MATCH",
      description: "Transaction simulation verified: actual effects match expected intent.",
      diff,
      timestamp,
    };
  }

  // Stealth approvals are ALWAYS strictly blocked - no human override
  if (diff.reasonCode === "UNEXPECTED_APPROVAL") {
    return {
      verdict: "BLOCK",
      reasonCode: "UNEXPECTED_APPROVAL",
      description:
        "CRITICAL SECURITY ALERT: Unauthorized token approval detected during simulation.",
      diff,
      timestamp,
    };
  }

  // Simulation failure or incomplete trace
  if (diff.reasonCode === "INSUFFICIENT_EVIDENCE") {
    return {
      verdict: "BLOCK",
      reasonCode: "INSUFFICIENT_EVIDENCE",
      description:
        "Simulation verification failed: execution reverted or logs were incomplete.",
      diff,
      timestamp,
    };
  }

  // Missing intended effects
  if (diff.reasonCode === "MISSING_EXPECTED_EFFECTS") {
    return {
      verdict: "BLOCK",
      reasonCode: "MISSING_EXPECTED_EFFECTS",
      description:
        "Simulation failed to observe the required expected effects of the intent.",
      diff,
      timestamp,
    };
  }

  // Unexpected extra side effects
  if (policy.allowHumanApprovalEscalation) {
    return {
      verdict: "HUMAN_APPROVAL",
      reasonCode: "ESCALATION_REQUIRED",
      description:
        "Simulation revealed side effects requiring explicit human review and approval.",
      diff,
      timestamp,
    };
  }

  return {
    verdict: "BLOCK",
    reasonCode: "UNEXPECTED_EFFECTS",
    description: `Blocked: simulation revealed ${diff.unexpectedEffects.length} unauthorized side effect(s).`,
    diff,
    timestamp,
  };
}
