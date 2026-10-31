import React from "react";
import { Shield, ShieldAlert, ShieldCheck, ArrowUpRight, Lock, Key, Zap, AlertTriangle, Activity } from "lucide-react";
import { useDrop } from "../context/DropContext.tsx";
import { DROP_CONFIG } from "../config/contracts.ts";

export const Dashboard: React.FC = () => {
  const { balanceUSDC, balanceETH, attackerUSDC, mandates, events, firewallEnabled } = useDrop();

  const activeMandates = mandates.filter((m) => m.status === "ACTIVE").length;
  const blockedEvents = events.filter((e) => e.decision === "BLOCKED").length;

  return (
    <div className="space-y-6">
      {/* Top Banner Alert if Firewall Disabled */}
      {!firewallEnabled && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-center justify-between text-red-300">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="h-6 w-6 text-red-400 shrink-0" />
            <div>
              <p className="font-semibold text-sm">SECURITY WARNING: DROP Firewall Protection is Disabled</p>
              <p className="text-xs text-red-400/80">
                AI agents have unrestricted authority. Transactions will bypass simulation checks and effect guards.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold bg-red-500/20 text-red-300 px-3 py-1 rounded border border-red-500/30">
            FAIL-OPEN RISK
          </span>
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="rounded-xl border border-border bg-surface/60 p-5 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Smart Account Balance</span>
            <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Shield className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              ${balanceUSDC.toLocaleString()} <span className="text-sm font-normal text-slate-400">USDC</span>
            </div>
            <div className="text-xs text-slate-400 mt-1 font-mono">
              + {balanceETH.toFixed(2)} ETH (Gas Reserve)
            </div>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="rounded-xl border border-border bg-surface/60 p-5 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Attacks Blocked</span>
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-emerald-400 tracking-tight">
              {blockedEvents} <span className="text-sm font-normal text-slate-400">Attempts</span>
            </div>
            <div className="text-xs text-emerald-400/80 mt-1">
              $0.00 Lost to Prompt Injection
            </div>
          </div>
        </div>

        {/* Metric 3 */}
        <div className="rounded-xl border border-border bg-surface/60 p-5 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Active Mandates</span>
            <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
              <Key className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-bold font-mono text-white tracking-tight">
              {activeMandates} <span className="text-sm font-normal text-slate-400">Keys</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">
              EIP-712 Authorizer Signatures
            </div>
          </div>
        </div>

        {/* Metric 4 */}
        <div className="rounded-xl border border-border bg-surface/60 p-5 backdrop-blur shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Attacker Balance</span>
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${attackerUSDC > 0 ? "bg-red-500/20 text-red-400" : "bg-slate-800 text-slate-500"}`}>
              <ShieldAlert className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className={`text-2xl font-bold font-mono tracking-tight ${attackerUSDC > 0 ? "text-red-400" : "text-slate-400"}`}>
              ${attackerUSDC.toLocaleString()} <span className="text-sm font-normal">USDC</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              {attackerUSDC > 0 ? "⚠️ DRAIN SUCCEEDED (Firewall Off)" : "Protected by DROP Firewall"}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Live Firewall Feed & Architecture Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Live Activity Feed */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-surface/40 p-6 backdrop-blur space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div className="flex items-center space-x-2">
              <Activity className="h-5 w-5 text-blue-400" />
              <h2 className="text-base font-semibold text-white">Live Firewall Activity Feed</h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">Real-time simulation traces</span>
          </div>

          <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
            {events.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                No transactions yet. Trigger actions in the DRAIN ME Arena!
              </div>
            ) : (
              events.map((ev) => (
                <div
                  key={ev.id}
                  className={`rounded-lg border p-4 transition-all text-xs space-y-2 ${
                    ev.decision === "APPROVED"
                      ? "border-emerald-500/20 bg-emerald-500/5"
                      : "border-red-500/30 bg-red-500/5 shadow-sm shadow-red-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          ev.decision === "APPROVED"
                            ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                            : "bg-red-500/20 text-red-400 border border-red-500/30"
                        }`}
                      >
                        {ev.decision}
                      </span>
                      <span className="font-semibold text-white">{ev.type.replace(/_/g, " ")}</span>
                      <span className="text-slate-500 font-mono">by {ev.agent}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 font-mono">{ev.timestamp}</span>
                  </div>

                  <p className="text-slate-300 font-mono text-[11px] leading-relaxed">
                    {ev.reason}
                  </p>

                  {ev.diffSummary && (
                    <div className="bg-slate-950/60 rounded px-2.5 py-1 text-[11px] font-mono text-slate-400 border border-border/50">
                      <span className="text-blue-400 font-semibold">Effect Diff:</span> {ev.diffSummary}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1">
                    <span>Target: {ev.recipient}</span>
                    <span>UserOp: {ev.userOpHash.slice(0, 10)}...</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right 1 Col: Security Architecture Status */}
        <div className="rounded-xl border border-border bg-surface/40 p-6 backdrop-blur space-y-4">
          <div className="border-b border-border/60 pb-3">
            <h2 className="text-base font-semibold text-white">Defense-in-Depth Status</h2>
            <p className="text-xs text-slate-400">Verifying components on Base Sepolia</p>
          </div>

          <div className="space-y-3 text-xs">
            {/* Layer 1 */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">1. EIP-712 Mandates</span>
                <span className="text-emerald-400 font-mono text-[11px]">ACTIVE</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Human owner cryptographically bounds spend limits and whitelists to agent session keys.
              </p>
            </div>

            {/* Layer 2 */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">2. Deterministic Builder</span>
                <span className="text-emerald-400 font-mono text-[11px]">ACTIVE</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Translates agent intent into canonical calldata and derives exact expected effects.
              </p>
            </div>

            {/* Layer 3 */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">3. Simulation Firewall</span>
                <span className={firewallEnabled ? "text-emerald-400 font-mono text-[11px]" : "text-red-400 font-mono text-[11px]"}>
                  {firewallEnabled ? "ENFORCING" : "BYPASSED"}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Dry-runs transactions, decodes logs, and diffs actual state against declared intent before submission.
              </p>
            </div>

            {/* Layer 4 */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">4. ERC-7579 Validator</span>
                <span className="text-emerald-400 font-mono text-[11px]">DropValidator.sol</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Validates UserOps strictly against active mandate hash, budgets, and tokens.
              </p>
            </div>

            {/* Layer 5 */}
            <div className="p-3 rounded-lg bg-slate-900/60 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">5. Onchain Effect Guard</span>
                <span className="text-emerald-400 font-mono text-[11px]">DropEffectGuard.sol</span>
              </div>
              <p className="text-[11px] text-slate-400">
                preCheck / postCheck execution hook guarantees atomic revert on unauthorized approvals or drains.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
