import React, { useState } from "react";
import { Key, ShieldCheck, XCircle, Plus, CheckCircle2, Copy } from "lucide-react";
import { useDrop } from "../context/DropContext.tsx";
import { DROP_CONFIG } from "../config/contracts.ts";

export const MandateManager: React.FC = () => {
  const { mandates, createMandate, revokeMandate } = useDrop();

  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [sessionKey, setSessionKey] = useState<string>("0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
  const [recipient, setRecipient] = useState<string>(DROP_CONFIG.demoSuppliers[0].address);
  const [recipientName, setRecipientName] = useState<string>("Supplier A");
  const [maxAmount, setMaxAmount] = useState<number>(400);
  const [dailyBudget, setDailyBudget] = useState<number>(2000);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMandate({
      authorizer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      sessionKey,
      token: DROP_CONFIG.contracts.mockUSDC,
      tokenSymbol: "USDC",
      recipient,
      recipientName,
      maxAmount,
      dailyBudget,
      validUntil: "2026-12-31",
      nonce: mandates.length + 1,
    });
    setShowCreateModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center space-x-2">
            <Key className="h-5 w-5 text-blue-400" />
            <span>Human Mandate Manager (EIP-712)</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Sign cryptographic spending boundaries that restrict agent session keys onchain.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-all shadow-md shadow-blue-600/20"
        >
          <Plus className="h-4 w-4" />
          <span>New Mandate</span>
        </button>
      </div>

      {/* Mandates Table */}
      <div className="rounded-xl border border-border bg-surface/40 backdrop-blur overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/60 border-b border-border/60 text-slate-400 uppercase font-mono">
              <tr>
                <th className="px-5 py-3.5">Mandate Hash</th>
                <th className="px-5 py-3.5">Session Key</th>
                <th className="px-5 py-3.5">Allowed Recipient</th>
                <th className="px-5 py-3.5">Per-Tx Limit</th>
                <th className="px-5 py-3.5">Daily Budget</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40 font-mono text-slate-300">
              {mandates.map((m) => {
                const isActive = m.status === "ACTIVE";
                return (
                  <tr key={m.mandateHash} className="hover:bg-slate-800/20 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center space-x-2">
                        <span className="text-slate-200">
                          {m.mandateHash.slice(0, 10)}...{m.mandateHash.slice(-6)}
                        </span>
                        <button
                          onClick={() => handleCopy(m.mandateHash)}
                          className="text-slate-500 hover:text-slate-300"
                          title="Copy full hash"
                        >
                          {copiedHash === m.mandateHash ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans mt-0.5">
                        Nonce: {m.nonce} • Valid to {m.validUntil}
                      </div>
                    </td>

                    <td className="px-5 py-4">
                      <span className="text-blue-400">
                        {m.sessionKey.slice(0, 6)}...{m.sessionKey.slice(-4)}
                      </span>
                    </td>

                    <td className="px-5 py-4 font-sans">
                      <div className="font-semibold text-slate-200">{m.recipientName}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {m.recipient.slice(0, 8)}...{m.recipient.slice(-4)}
                      </div>
                    </td>

                    <td className="px-5 py-4 font-bold text-white">
                      ${m.maxAmount.toLocaleString()} {m.tokenSymbol}
                    </td>

                    <td className="px-5 py-4">
                      <div className="text-slate-200">
                        ${m.dailyBudget.toLocaleString()} {m.tokenSymbol}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Spent: ${m.spentToday.toLocaleString()}
                      </div>
                    </td>

                    <td className="px-5 py-4 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
                          isActive
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30"
                            : "bg-red-500/10 text-red-400 border border-red-500/30"
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>

                    <td className="px-5 py-4 text-right">
                      {isActive ? (
                        <button
                          onClick={() => revokeMandate(m.mandateHash)}
                          className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded text-[11px] font-sans font-medium transition-all"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[11px] font-sans">Revoked</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: New Mandate */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-base font-semibold text-white flex items-center space-x-2">
                <Key className="h-5 w-5 text-blue-400" />
                <span>Create & Sign Human Mandate</span>
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 font-medium mb-1">Agent Session Key Address</label>
                <input
                  type="text"
                  value={sessionKey}
                  onChange={(e) => setSessionKey(e.target.value)}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 font-medium mb-1">Approved Recipient Whitelist</label>
                <select
                  value={recipient}
                  onChange={(e) => {
                    setRecipient(e.target.value);
                    const sel = DROP_CONFIG.demoSuppliers.find((s) => s.address === e.target.value);
                    if (sel) setRecipientName(sel.name);
                  }}
                  className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-white font-sans text-xs focus:outline-none focus:border-blue-500"
                >
                  {DROP_CONFIG.demoSuppliers.map((s) => (
                    <option key={s.address} value={s.address}>
                      {s.name} ({s.address.slice(0, 8)}...)
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Per-Tx Max Amount (USDC)</label>
                  <input
                    type="number"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-400 font-medium mb-1">Daily Budget Limit (USDC)</label>
                  <input
                    type="number"
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(Number(e.target.value))}
                    className="w-full bg-slate-900 border border-border rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                    required
                  />
                </div>
              </div>

              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-[11px] leading-relaxed">
                <span className="font-semibold">EIP-712 Cryptographic Commitment:</span> This mandate will be
                signed by the human owner and verified by <code className="text-white">DropMandate.sol</code> and{" "}
                <code className="text-white">DropValidator.sol</code>.
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-blue-600/30"
                >
                  Sign & Register Mandate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
