import React, { useState } from "react";
import { Cpu, ShieldCheck, ArrowRight, CheckCircle2, XCircle, Search, FileCode2, Play } from "lucide-react";
import { useDrop } from "../context/DropContext.tsx";
import { DROP_CONFIG } from "../config/contracts.ts";

export const CommandCenter: React.FC = () => {
  const { firewallEnabled } = useDrop();
  const [activeStep, setActiveStep] = useState<number>(3);

  const steps = [
    { num: 1, title: "Intent Schema", subtitle: "Structured Intent", desc: "AI proposes structured action" },
    { num: 2, title: "Canonical Builder", subtitle: "Deterministic Tx", desc: "Generates byte-for-byte calldata & expected effect" },
    { num: 3, title: "Simulation Engine", subtitle: "Dry-Run EVM", desc: "Executes state fork without broadcasting" },
    { num: 4, title: "Effect Decoder", subtitle: "Actual Manifest", desc: "Extracts actual balance and allowance deltas" },
    { num: 5, title: "Effect Comparator", subtitle: "Diff Verification", desc: "Calculates mathematical set difference" },
    { num: 6, title: "Onchain Guard", subtitle: "ERC-7579 Hook", desc: "Atomically reverts if state postCheck violates" },
  ];

  return (
    <div className="space-y-6">
      {/* Title */}
      <div className="border-b border-border/60 pb-5">
        <h1 className="text-xl font-bold text-white flex items-center space-x-2">
          <Cpu className="h-5 w-5 text-blue-400" />
          <span>DROP Security Pipeline & Firewall Command Center</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Zero-trust transaction firewall verifying every state change before and during EVM execution.
        </p>
      </div>

      {/* Stepper Flow */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
        {steps.map((s) => {
          const isSelected = activeStep === s.num;
          return (
            <button
              key={s.num}
              onClick={() => setActiveStep(s.num)}
              className={`p-3 rounded-xl border text-left transition-all ${
                isSelected
                  ? "bg-blue-600/20 border-blue-500/50 shadow-md shadow-blue-500/10 text-white"
                  : "bg-surface/40 border-border/60 hover:bg-slate-800/40 text-slate-400"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${isSelected ? "bg-blue-500 text-white" : "bg-slate-800 text-slate-400"}`}>
                  Step {s.num}
                </span>
                <CheckCircle2 className={`h-3.5 w-3.5 ${isSelected ? "text-blue-400" : "text-slate-600"}`} />
              </div>
              <div className="text-xs font-semibold mt-2 text-slate-200">{s.title}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{s.subtitle}</div>
            </button>
          );
        })}
      </div>

      {/* Detail Inspector Card */}
      <div className="rounded-xl border border-border bg-surface/50 p-6 backdrop-blur space-y-5">
        <div className="flex items-center justify-between border-b border-border/60 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Pipeline Stage {activeStep}: {steps[activeStep - 1].title} — {steps[activeStep - 1].subtitle}
            </h2>
            <p className="text-xs text-slate-400">{steps[activeStep - 1].desc}</p>
          </div>
          <span className="text-xs font-mono px-3 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded">
            FAIL-CLOSED INVARIANT: ENFORCED
          </span>
        </div>

        {/* Code / Visual View */}
        {activeStep === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-300">
              The untrusted AI agent expresses its desired action in strict typed JSON. The agent NEVER creates raw calldata directly:
            </p>
            <pre className="p-4 rounded-lg bg-slate-950 font-mono text-xs text-blue-300 overflow-x-auto border border-border/50">
{`{
  "version": "1",
  "action": "ERC20_TRANSFER",
  "mandateHash": "0x89f2a714b2d3e410f98394bc8104e76a54cd79b1834928bcf9a0e632b8423ef1",
  "sender": "${DROP_CONFIG.contracts.smartAccount}",
  "token": "${DROP_CONFIG.contracts.mockUSDC}",
  "recipient": "${DROP_CONFIG.demoSuppliers[0].address}",
  "amount": "400000000",
  "maxSlippageBps": 0
}`}
            </pre>
          </div>
        )}

        {activeStep === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-300">
              Deterministic pure builder converts the intent to canonical ERC-4337 execution calldata and derives declared expected effect manifest:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-3 bg-slate-950 rounded-lg border border-border font-mono text-xs">
                <span className="text-slate-400 text-[10px] block mb-1">CANONICAL EXECUTION CALLDATA</span>
                <span className="text-emerald-400 break-all text-[11px]">
                  0xe9ae5c530000...a9059cbb00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c80000000000000000000000000000000000000000000000000000000017d78400
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-border font-mono text-xs">
                <span className="text-slate-400 text-[10px] block mb-1">EXPECTED EFFECT MANIFEST</span>
                <span className="text-blue-300 text-[11px]">
                  balanceDeltas: [ -400 USDC (Account), +400 USDC (Supplier A) ]<br/>
                  allowanceChanges: [ ] (Zero approvals permitted!)
                </span>
              </div>
            </div>
          </div>
        )}

        {activeStep === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-300">
              Transaction is dry-run locally against an isolated EVM state fork via <code className="text-blue-400">eth_call</code> / <code className="text-blue-400">debug_traceCall</code>:
            </p>
            <div className="p-4 bg-slate-950 rounded-lg border border-border font-mono text-xs text-slate-300 space-y-2">
              <div className="flex items-center space-x-2 text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>EVM Fork Dry-Run Complete — Gas Used: 84,219</span>
              </div>
              <div className="text-[11px] text-slate-400">
                Logs emitted: Transfer(from: Account, to: Supplier A, amount: 400.0 USDC)
              </div>
            </div>
          </div>
        )}

        {activeStep === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-300">
              Decodes all state transitions, token balance changes, and emitted events into a structured Actual Effect Manifest:
            </p>
            <pre className="p-4 rounded-lg bg-slate-950 font-mono text-xs text-slate-300 overflow-x-auto border border-border/50">
{`{
  "transfers": [
    { "token": "USDC", "from": "Account", "to": "Supplier A", "amount": 400.0 }
  ],
  "approvals": [],
  "unexpectedStateModifications": []
}`}
            </pre>
          </div>
        )}

        {activeStep === 5 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-300">
              Comparator performs mathematical diff: <code className="text-emerald-400">Diff = ActualEffectManifest \ ExpectedEffectManifest</code>:
            </p>
            <div className="p-4 rounded-lg bg-slate-950 border border-emerald-500/30 font-mono text-xs text-emerald-300 space-y-1">
              <div className="font-bold">DIFF RESULT: 0 DISCREPANCIES</div>
              <div className="text-slate-400 text-[11px]">
                Decision: <span className="text-emerald-400 font-bold">APPROVED</span>. Calldata is mathematically proven safe for onchain submission.
              </div>
            </div>
          </div>
        )}

        {activeStep === 6 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-300">
              Final defense line: <code className="text-white">DropEffectGuard.sol</code> ERC-7579 hook guarantees atomic revert if anything unexpected happens during actual onchain execution:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                <span className="font-semibold text-blue-400 block mb-1">preCheck()</span>
                <p className="text-slate-400 text-[11px]">
                  Snapshots token balances, ETH reserves, and watched spender allowances before target invocation.
                </p>
              </div>
              <div className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                <span className="font-semibold text-blue-400 block mb-1">postCheck()</span>
                <p className="text-slate-400 text-[11px]">
                  Asserts post-balances and guarantees zero unauthorized allowance increase. Reverts atomically on discrepancy.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
