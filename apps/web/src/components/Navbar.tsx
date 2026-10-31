import React from "react";
import { Shield, ShieldAlert, ShieldCheck, Cpu, Key, FileCheck, Flame, Search, ArrowRightLeft } from "lucide-react";
import { useDrop } from "../context/DropContext.tsx";
import { DROP_CONFIG } from "../config/contracts.ts";

export type TabType = "dashboard" | "mandates" | "command" | "arena" | "audit" | "escrow";

interface NavbarProps {
  currentTab: TabType;
  setCurrentTab: (tab: TabType) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab }) => {
  const { firewallEnabled, setFirewallEnabled, balanceUSDC } = useDrop();

  const navItems: Array<{ id: TabType; label: string; icon: any; badge?: string }> = [
    { id: "dashboard", label: "Dashboard", icon: ShieldCheck },
    { id: "mandates", label: "Mandate Manager", icon: Key },
    { id: "command", label: "Command Center", icon: Cpu },
    { id: "arena", label: "DRAIN ME Arena", icon: Flame, badge: "Live Demo" },
    { id: "audit", label: "Audit Explorer", icon: Search },
    { id: "escrow", label: "A2A Escrow", icon: ArrowRightLeft },
  ];

  return (
    <header className="border-b border-border bg-[#0a0f1d]/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20 border border-blue-400/30">
              <Shield className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xl font-bold tracking-tight text-white font-mono">DROP</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
                  EVM Firewall
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                The wallet an AI can't be talked into emptying
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="hidden md:flex space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id as TabType)}
                  className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-blue-600/20 text-blue-400 border border-blue-500/30 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-500/20 text-red-400 border border-red-500/30">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Controls: Firewall Toggle & Wallet Status */}
          <div className="flex items-center space-x-3">
            {/* Firewall Toggle */}
            <div
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-lg border text-xs font-mono transition-all ${
                firewallEnabled
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-red-500/10 border-red-500/30 text-red-400 animate-pulse"
              }`}
            >
              <button
                onClick={() => setFirewallEnabled(!firewallEnabled)}
                className="flex items-center space-x-1.5 focus:outline-none"
                title="Toggle DROP Simulation & Execution Firewall"
              >
                {firewallEnabled ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>FIREWALL: ON</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-4 w-4 text-red-400" />
                    <span>FIREWALL: OFF</span>
                  </>
                )}
              </button>
            </div>

            {/* Account Pill */}
            <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-slate-400">Account:</span>
              <span className="text-slate-200 font-mono">
                {DROP_CONFIG.contracts.smartAccount.slice(0, 6)}...{DROP_CONFIG.contracts.smartAccount.slice(-4)}
              </span>
              <span className="text-blue-400 font-mono font-medium pl-1 border-l border-slate-800">
                ${balanceUSDC.toLocaleString()} USDC
              </span>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        <div className="flex md:hidden overflow-x-auto py-2 space-x-1 border-t border-border/50">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as TabType)}
              className={`px-2.5 py-1 text-xs rounded font-medium whitespace-nowrap ${
                currentTab === item.id ? "bg-blue-600/20 text-blue-400" : "text-slate-400"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
};
