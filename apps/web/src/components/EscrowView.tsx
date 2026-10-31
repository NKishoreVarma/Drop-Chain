import React, { useState } from "react";
import { ArrowRightLeft, ShieldCheck, CheckCircle2, AlertTriangle, Plus, Coins, Skull } from "lucide-react";
import { useDrop } from "../context/DropContext.tsx";
import { DROP_CONFIG } from "../config/contracts.ts";

export interface EscrowJobUI {
  jobId: string;
  title: string;
  buyer: string;
  seller: string;
  amount: number;
  bond: number;
  expectedEffectHash: string;
  status: "INITIALIZED" | "ACTIVE" | "COMPLETED" | "SLASHED";
}

export const EscrowView: React.FC = () => {
  const [jobs, setJobs] = useState<EscrowJobUI[]>([
    {
      jobId: "0x0000000000000000000000000000000000000000000000000000000000000001",
      title: "Cross-DEX Arbitrage Execution",
      buyer: DROP_CONFIG.contracts.smartAccount,
      seller: DROP_CONFIG.demoSuppliers[0].address,
      amount: 500,
      bond: 100,
      expectedEffectHash: "0x4f7d1a29384728ef1a7c2b3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f",
      status: "ACTIVE",
    },
    {
      jobId: "0x0000000000000000000000000000000000000000000000000000000000000002",
      title: "Solana-to-Base Bridge Relaying",
      buyer: DROP_CONFIG.contracts.smartAccount,
      seller: DROP_CONFIG.attackerAddress,
      amount: 500,
      bond: 100,
      expectedEffectHash: "0x9876543210fedcba0987654321fedcba09876543210fedcba09876543210fedc",
      status: "INITIALIZED",
    },
  ]);

  const [notification, setNotification] = useState<string | null>(null);

  const handleComplete = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, status: "COMPLETED" } : j))
    );
    setNotification("Deliverable state effect verified! Escrow payment (500 USDC) + seller bond (100 USDC) released to worker.");
    setTimeout(() => setNotification(null), 4000);
  };

  const handleSlash = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, status: "SLASHED" } : j))
    );
    setNotification("Malicious worker slashed! Buyer received 500 USDC refund + 100 USDC penalty bond.");
    setTimeout(() => setNotification(null), 4000);
  };

  const handleStake = (jobId: string) => {
    setJobs((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, status: "ACTIVE" } : j))
    );
    setNotification("Seller staked 100 USDC bond. Job is now ACTIVE.");
    setTimeout(() => setNotification(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-border/60 pb-5">
        <h1 className="text-xl font-bold text-white flex items-center space-x-2">
          <ArrowRightLeft className="h-5 w-5 text-blue-400" />
          <span>Bonded Agent-to-Agent (A2A) Escrow</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Hire autonomous AI agents with bonded security deposits and cryptographic deliverable verification (<code className="text-blue-300">DropEscrow.sol</code>).
        </p>
      </div>

      {notification && (
        <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs flex items-center space-x-2">
          <CheckCircle2 className="h-4 w-4 text-blue-400 shrink-0" />
          <span>{notification}</span>
        </div>
      )}

      {/* Jobs List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {jobs.map((job) => {
          return (
            <div
              key={job.jobId}
              className="rounded-xl border border-border bg-surface/50 p-5 backdrop-blur space-y-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">{job.title}</h3>
                  <span className="text-[10px] text-slate-500 font-mono">
                    ID: {job.jobId.slice(0, 10)}...{job.jobId.slice(-4)}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                    job.status === "COMPLETED"
                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                      : job.status === "ACTIVE"
                      ? "bg-blue-500/10 text-blue-400 border border-blue-500/30"
                      : job.status === "INITIALIZED"
                      ? "bg-amber-500/10 text-amber-400 border border-amber-500/30"
                      : "bg-red-500/10 text-red-400 border border-red-500/30"
                  }`}
                >
                  {job.status}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-950/60 p-3 rounded-lg border border-border/40">
                <div>
                  <span className="text-slate-500 text-[10px] block">PAYMENT ESCROW</span>
                  <span className="text-white font-bold">${job.amount} USDC</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] block">WORKER BOND</span>
                  <span className="text-purple-400 font-bold">${job.bond} USDC</span>
                </div>
                <div className="col-span-2 pt-1 border-t border-slate-900 truncate">
                  <span className="text-slate-500 text-[10px] block">EXPECTED EFFECT HASH</span>
                  <span className="text-blue-300 text-[10px] truncate block">{job.expectedEffectHash}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-1">
                {job.status === "INITIALIZED" && (
                  <button
                    onClick={() => handleStake(job.jobId)}
                    className="px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded text-xs font-medium transition-all"
                  >
                    Stake Bond ($100) & Activate
                  </button>
                )}

                {job.status === "ACTIVE" && (
                  <>
                    <button
                      onClick={() => handleComplete(job.jobId)}
                      className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded text-xs font-medium transition-all"
                    >
                      Verify Effect & Complete
                    </button>
                    <button
                      onClick={() => handleSlash(job.jobId)}
                      className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded text-xs font-medium transition-all"
                    >
                      Slash Bond
                    </button>
                  </>
                )}

                {job.status === "COMPLETED" && (
                  <span className="text-xs text-emerald-400 font-mono flex items-center space-x-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Payout Settled</span>
                  </span>
                )}

                {job.status === "SLASHED" && (
                  <span className="text-xs text-red-400 font-mono flex items-center space-x-1">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>Worker Bond Slashed</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
