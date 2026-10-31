import React, { createContext, useContext, useState, useEffect } from "react";
import { DROP_CONFIG } from "../config/contracts.ts";

export interface MandateItem {
  mandateHash: string;
  authorizer: string;
  sessionKey: string;
  token: string;
  tokenSymbol: string;
  recipient: string;
  recipientName: string;
  maxAmount: number;
  dailyBudget: number;
  spentToday: number;
  validUntil: string;
  nonce: number;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
}

export interface SecurityEvent {
  id: string;
  timestamp: string;
  type: "TRANSFER" | "INJECTION_ATTEMPT" | "STEALTH_APPROVAL_ATTEMPT" | "MANDATE_VIOLATION";
  agent: string;
  amount: number;
  recipient: string;
  decision: "APPROVED" | "BLOCKED";
  reason: string;
  diffSummary?: string;
  userOpHash: string;
  receiptId?: string;
}

export interface AuditItem {
  receiptId: string;
  mandateHash: string;
  intentHash: string;
  canonicalTxHash: string;
  simulationHash: string;
  effectDiffHash: string;
  userOpHash: string;
  account: string;
  sessionKey: string;
  decision: "APPROVED" | "BLOCKED";
  reason: string;
  timestamp: string;
}

interface DropContextType {
  balanceUSDC: number;
  balanceETH: number;
  attackerUSDC: number;
  mandates: MandateItem[];
  events: SecurityEvent[];
  audits: AuditItem[];
  firewallEnabled: boolean;
  setFirewallEnabled: (val: boolean) => void;
  createMandate: (mandate: Omit<MandateItem, "mandateHash" | "spentToday" | "status">) => void;
  revokeMandate: (mandateHash: string) => void;
  addSecurityEvent: (event: Omit<SecurityEvent, "id" | "timestamp">) => void;
  resetDemoState: () => void;
  simulateDrainMe: (params: {
    track: "A" | "B";
    prompt?: string;
    amount?: number;
    recipient?: string;
  }) => Promise<{
    decision: "APPROVED" | "BLOCKED";
    reason: string;
    drained: boolean;
    diffDetails: any;
  }>;
}

const DropContext = createContext<DropContextType | undefined>(undefined);

export const DropProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [balanceUSDC, setBalanceUSDC] = useState<number>(10000);
  const [balanceETH, setBalanceETH] = useState<number>(1.5);
  const [attackerUSDC, setAttackerUSDC] = useState<number>(0);
  const [firewallEnabled, setFirewallEnabled] = useState<boolean>(true);

  const [mandates, setMandates] = useState<MandateItem[]>([
    {
      mandateHash: "0x89f2a714b2d3e410f98394bc8104e76a54cd79b1834928bcf9a0e632b8423ef1",
      authorizer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      sessionKey: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      token: DROP_CONFIG.contracts.mockUSDC,
      tokenSymbol: "USDC",
      recipient: DROP_CONFIG.demoSuppliers[0].address,
      recipientName: "Supplier A",
      maxAmount: 400,
      dailyBudget: 2000,
      spentToday: 400,
      validUntil: "2026-12-31",
      nonce: 1,
      status: "ACTIVE",
    },
  ]);

  const [events, setEvents] = useState<SecurityEvent[]>([
    {
      id: "ev-1",
      timestamp: "Just now",
      type: "TRANSFER",
      agent: "SupplyChainAgent-01",
      amount: 400,
      recipient: "Supplier A (0x7099...)",
      decision: "APPROVED",
      reason: "Simulated effects exactly match mandate limits and expected transfer manifest",
      diffSummary: "+400 USDC to Supplier A, -400 USDC from Account, 0 Approvals",
      userOpHash: "0x4f7d1a29384728ef1a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f",
      receiptId: "0x1111111122222222333333334444444455555555666666667777777788888888",
    },
  ]);

  const [audits, setAudits] = useState<AuditItem[]>([
    {
      receiptId: "0x1111111122222222333333334444444455555555666666667777777788888888",
      mandateHash: "0x89f2a714b2d3e410f98394bc8104e76a54cd79b1834928bcf9a0e632b8423ef1",
      intentHash: "0xa1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      canonicalTxHash: "0x9876543210fedcba0987654321fedcba09876543210fedcba09876543210fedc",
      simulationHash: "0xb4a5c6d7e8f90123456789abcdef0123456789abcdef0123456789abcdef0123",
      effectDiffHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
      userOpHash: "0x4f7d1a29384728ef1a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f",
      account: DROP_CONFIG.contracts.smartAccount,
      sessionKey: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      decision: "APPROVED",
      reason: "All state effects conform strictly to human mandate boundaries",
      timestamp: "2026-10-31 10:15:00",
    },
  ]);

  const createMandate = (mandate: Omit<MandateItem, "mandateHash" | "spentToday" | "status">) => {
    const mandateHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const newMandate: MandateItem = {
      ...mandate,
      mandateHash,
      spentToday: 0,
      status: "ACTIVE",
    };
    setMandates((prev) => [newMandate, ...prev]);
  };

  const revokeMandate = (mandateHash: string) => {
    setMandates((prev) =>
      prev.map((m) => (m.mandateHash === mandateHash ? { ...m, status: "REVOKED" } : m))
    );
  };

  const addSecurityEvent = (event: Omit<SecurityEvent, "id" | "timestamp">) => {
    const newEvent: SecurityEvent = {
      ...event,
      id: `ev-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
    };
    setEvents((prev) => [newEvent, ...prev]);
  };

  const resetDemoState = () => {
    setBalanceUSDC(10000);
    setAttackerUSDC(0);
  };

  const simulateDrainMe = async (params: {
    track: "A" | "B";
    prompt?: string;
    amount?: number;
    recipient?: string;
  }): Promise<{
    decision: "APPROVED" | "BLOCKED";
    reason: string;
    drained: boolean;
    diffDetails: any;
  }> => {
    await new Promise((resolve) => setTimeout(resolve, 800)); // Realism latency

    if (params.track === "A") {
      // Prompt Injection Track
      const requestedAmt = params.amount ?? 5000;
      const isOverBudget = requestedAmt > 400;
      const isUnapprovedRecipient = params.recipient && params.recipient.toLowerCase() !== DROP_CONFIG.demoSuppliers[0].address.toLowerCase();

      if (firewallEnabled) {
        let reason = "";
        if (isOverBudget) {
          reason = `Blocked by DROP Firewall: Amount (${requestedAmt} USDC) violates human mandate spending limit (400 USDC max)`;
        } else if (isUnapprovedRecipient) {
          reason = `Blocked by DROP Firewall: Recipient (${params.recipient}) is not on approved mandate whitelist`;
        } else {
          reason = "Simulation verified; approved within limits";
        }

        const decision: "APPROVED" | "BLOCKED" = (isOverBudget || isUnapprovedRecipient) ? "BLOCKED" : "APPROVED";

        addSecurityEvent({
          type: "INJECTION_ATTEMPT",
          agent: "AdversarialAgent",
          amount: requestedAmt,
          recipient: params.recipient || "Attacker Wallet",
          decision,
          reason,
          diffSummary: isOverBudget ? `Rejected: Exceeds 400 USDC limit` : `Approved transfer`,
          userOpHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        });

        return {
          decision,
          reason,
          drained: false,
          diffDetails: {
            expected: `Transfer ${Math.min(requestedAmt, 400)} USDC`,
            actual: isOverBudget ? `Attempted ${requestedAmt} USDC drain` : "Normal execution",
            status: decision,
          },
        };
      } else {
        // Firewall Disabled
        setBalanceUSDC((prev) => Math.max(0, prev - requestedAmt));
        setAttackerUSDC((prev) => prev + requestedAmt);

        addSecurityEvent({
          type: "INJECTION_ATTEMPT",
          agent: "AdversarialAgent",
          amount: requestedAmt,
          recipient: "Attacker Wallet",
          decision: "APPROVED",
          reason: "FIREWALL DISABLED: Unrestricted execution allowed wallet drain!",
          userOpHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        });

        return {
          decision: "APPROVED",
          reason: "FIREWALL DISABLED: Prompt injection succeeded in emptying account!",
          drained: true,
          diffDetails: {
            warning: "NO FIREWALL ENFORCEMENT",
            stolen: `${requestedAmt} USDC transferred to attacker`,
          },
        };
      }
    } else {
      // Track B: Adversarial Token / Stealth Approval
      if (firewallEnabled) {
        const reason = "BLOCKED: Simulation & DropEffectGuard detected stealth unlimited approval (uint256.max) granted to attacker 0x90F7... during transfer()";

        addSecurityEvent({
          type: "STEALTH_APPROVAL_ATTEMPT",
          agent: "ContractInteractionAgent",
          amount: 400,
          recipient: "AdversarialMockUSDC",
          decision: "BLOCKED",
          reason,
          diffSummary: "Unexpected state effect: allowance[account][attacker] = MAX_UINT256. Pre-execution simulation rejected.",
          userOpHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        });

        return {
          decision: "BLOCKED",
          reason,
          drained: false,
          diffDetails: {
            detectedApproval: "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            expectedApproval: "0x0",
            verdict: "Simulated execution diff mismatch — atomic revert triggered",
          },
        };
      } else {
        // Firewall Disabled: Token sneaks approval and drains ALL USDC
        const drainAmount = balanceUSDC;
        setBalanceUSDC(0);
        setAttackerUSDC((prev) => prev + drainAmount);

        addSecurityEvent({
          type: "STEALTH_APPROVAL_ATTEMPT",
          agent: "ContractInteractionAgent",
          amount: 400,
          recipient: "AdversarialMockUSDC",
          decision: "APPROVED",
          reason: "FIREWALL DISABLED: Stealth approval executed and attacker drained all funds!",
          userOpHash: "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(""),
        });

        return {
          decision: "APPROVED",
          reason: "FIREWALL DISABLED: Stealth approval granted. Attacker transferred entire wallet balance (10,000 USDC) via transferFrom!",
          drained: true,
          diffDetails: {
            stealthApproval: "MAX_UINT256 granted to 0x90F7...",
            walletBalanceAfter: "0 USDC",
          },
        };
      }
    }
  };

  return (
    <DropContext.Provider
      value={{
        balanceUSDC,
        balanceETH,
        attackerUSDC,
        mandates,
        events,
        audits,
        firewallEnabled,
        setFirewallEnabled,
        createMandate,
        revokeMandate,
        addSecurityEvent,
        resetDemoState,
        simulateDrainMe,
      }}
    >
      {children}
    </DropContext.Provider>
  );
};

export const useDrop = () => {
  const context = useContext(DropContext);
  if (!context) {
    throw new Error("useDrop must be used within a DropProvider");
  }
  return context;
};
