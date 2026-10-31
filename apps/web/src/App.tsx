import React, { useState } from "react";
import { DropProvider } from "./context/DropContext.tsx";
import { Navbar, TabType } from "./components/Navbar.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { MandateManager } from "./components/MandateManager.tsx";
import { CommandCenter } from "./components/CommandCenter.tsx";
import { DrainMeArena } from "./components/DrainMeArena.tsx";
import { AuditExplorer } from "./components/AuditExplorer.tsx";
import { EscrowView } from "./components/EscrowView.tsx";
import { Shield, Github, ExternalLink } from "lucide-react";

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<TabType>("dashboard");

  return (
    <DropProvider>
      <div className="min-h-screen bg-[#090d16] flex flex-col selection:bg-blue-500/20 selection:text-blue-300">
        {/* Navigation Bar */}
        <Navbar currentTab={currentTab} setCurrentTab={setCurrentTab} />

        {/* Main Content Area */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {currentTab === "dashboard" && <Dashboard />}
          {currentTab === "mandates" && <MandateManager />}
          {currentTab === "command" && <CommandCenter />}
          {currentTab === "arena" && <DrainMeArena />}
          {currentTab === "audit" && <AuditExplorer />}
          {currentTab === "escrow" && <EscrowView />}
        </main>

        {/* Footer */}
        <footer className="border-t border-border/60 bg-[#070b13] py-8 text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="h-6 w-6 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <Shield className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="font-semibold text-slate-300 font-mono">DROP Protocol</span>
                <span className="text-slate-500 ml-2">
                  The wallet an AI can't be talked into emptying
                </span>
              </div>
            </div>

            <div className="flex items-center space-x-6 text-slate-400">
              <span className="font-mono text-[11px] text-slate-400 italic">
                "AI proposes. Contracts decide. Simulation verifies."
              </span>
              <a
                href="https://github.com/NKishoreVarma/Drop-Chain.git"
                target="_blank"
                rel="noreferrer"
                className="flex items-center space-x-1.5 hover:text-white transition-colors"
              >
                <Github className="h-4 w-4" />
                <span>NKishoreVarma/Drop-Chain</span>
              </a>
            </div>
          </div>
        </footer>
      </div>
    </DropProvider>
  );
};

export default App;
