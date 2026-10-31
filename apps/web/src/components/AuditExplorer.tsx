import React, { useState } from "react";
import { Search, ShieldCheck, CheckCircle2, Copy, FileText, Check } from "lucide-react";
import { useDrop } from "../context/DropContext.tsx";

export const AuditExplorer: React.FC = () => {
  const { audits } = useDrop();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedAudit, setSelectedAudit] = useState<any>(audits[0] || null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredAudits = audits.filter(
    (a) =>
      a.receiptId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.mandateHash.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a.account.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-border/60 pb-5">
        <h1 className="text-xl font-bold text-white flex items-center space-x-2">
          <Search className="h-5 w-5 text-blue-400" />
          <span>Cryptographic Audit Explorer</span>
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Verify immutable onchain audit receipts recorded by <code className="text-blue-300">DropAuditRegistry.sol</code>.
        </p>
      </div>

      {/* Search Input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search by Receipt ID, Mandate Hash, or Account Address..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full bg-surface/50 border border-border rounded-xl px-4 py-3 pl-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500/60 font-mono shadow-sm"
        />
        <Search className="h-4 w-4 text-slate-500 absolute left-3.5 top-3.5" />
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left List */}
        <div className="rounded-xl border border-border bg-surface/40 p-4 backdrop-blur space-y-2">
          <h2 className="text-xs font-semibold text-slate-400 uppercase font-mono px-2">
            Recorded Receipts ({filteredAudits.length})
          </h2>
          <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
            {filteredAudits.map((a) => (
              <button
                key={a.receiptId}
                onClick={() => setSelectedAudit(a)}
                className={`w-full text-left p-3 rounded-lg border text-xs transition-all ${
                  selectedAudit?.receiptId === a.receiptId
                    ? "bg-blue-600/20 border-blue-500/40 text-white"
                    : "bg-slate-900/40 border-border/60 hover:bg-slate-800/40 text-slate-400"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded ${
                      a.decision === "APPROVED"
                        ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                        : "bg-red-500/20 text-red-400 border border-red-500/30"
                    }`}
                  >
                    {a.decision}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">{a.timestamp}</span>
                </div>
                <div className="font-mono text-xs text-slate-200 mt-2 truncate">
                  {a.receiptId.slice(0, 14)}...{a.receiptId.slice(-6)}
                </div>
                <div className="text-[11px] text-slate-400 truncate mt-0.5">{a.reason}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Right Details */}
        <div className="lg:col-span-2 rounded-xl border border-border bg-surface/50 p-6 backdrop-blur space-y-5">
          {selectedAudit ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-border/60 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-white">Cryptographic Proof Bundle</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Receipt ID: {selectedAudit.receiptId}
                  </p>
                </div>
                <span className="text-xs font-mono px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded flex items-center space-x-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>ONCHAIN VERIFIED</span>
                </span>
              </div>

              {/* Hash Table */}
              <div className="space-y-2 text-xs font-mono">
                {[
                  { label: "1. Mandate Hash (EIP-712)", value: selectedAudit.mandateHash },
                  { label: "2. Agent Intent Hash", value: selectedAudit.intentHash },
                  { label: "3. Canonical Tx Hash", value: selectedAudit.canonicalTxHash },
                  { label: "4. Simulation Result Hash", value: selectedAudit.simulationHash },
                  { label: "5. Effect Diff Hash", value: selectedAudit.effectDiffHash },
                  { label: "6. UserOp Hash", value: selectedAudit.userOpHash },
                ].map((item, idx) => (
                  <div key={idx} className="p-3 bg-slate-950/80 rounded-lg border border-border/60 flex items-center justify-between">
                    <div className="space-y-0.5 truncate mr-3">
                      <span className="text-slate-400 text-[10px] block font-sans">{item.label}</span>
                      <span className="text-blue-300 text-[11px] truncate block">{item.value}</span>
                    </div>
                    <button
                      onClick={() => handleCopy(`hash-${idx}`, item.value)}
                      className="text-slate-500 hover:text-slate-200 shrink-0"
                      title="Copy Hash"
                    >
                      {copiedKey === `hash-${idx}` ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>

              {/* Verdict Summary */}
              <div className="p-4 bg-slate-900 rounded-lg border border-border space-y-2 text-xs">
                <div className="flex items-center justify-between font-semibold">
                  <span className="text-slate-300">Decision Verdict:</span>
                  <span className={selectedAudit.decision === "APPROVED" ? "text-emerald-400" : "text-red-400"}>
                    {selectedAudit.decision}
                  </span>
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  <strong>Verification Statement:</strong> {selectedAudit.reason}
                </p>
                <div className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-800">
                  Account: {selectedAudit.account} • Session Key: {selectedAudit.sessionKey}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500 text-xs">
              Select an audit receipt on the left to inspect its cryptographic proof chain.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
