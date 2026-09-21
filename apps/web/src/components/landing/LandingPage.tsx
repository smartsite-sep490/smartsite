import React, { useState } from 'react';
import {
  IconCheck,
  IconHardHat,
  IconShield,
  IconUsers,
  IconKey,
  IconAlertTriangle,
  IconX
} from '../icons';

interface LandingPageProps {
  onEnterApp: (tab?: 'ppe' | 'zones' | 'dashboard' | 'workforce' | 'access' | 'iot' | 'progress' | 'incidents') => void;
}

export function LandingPage({ onEnterApp }: LandingPageProps) {
  const [activeAiTab, setActiveAiTab] = useState<'ppe' | 'zones'>('ppe');

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans selection:bg-[#F66B17]/20 scroll-smooth">
      {/* 1. Header Navigation - Updated for Dark Hero */}
      <header className="absolute top-0 inset-x-0 z-50 bg-transparent">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => window.scrollTo(0, 0)}>
            <div className="w-8 h-8 rounded-lg bg-[#F66B17] flex items-center justify-center font-black text-white text-base shadow-sm">
              S
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              Smart<span className="text-[#F66B17]">Site</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
            <a href="#platform" className="hover:text-white transition-colors">Platform</a>
            <a href="#solutions" className="hover:text-white transition-colors">Solutions</a>
            <a href="#safety-ai" className="hover:text-white transition-colors">Safety AI</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How It Works</a>
            <a href="#about" className="hover:text-white transition-colors">About</a>
          </nav>

          <div className="flex items-center gap-4">
            <button
              onClick={() => onEnterApp('dashboard')}
              className="text-sm font-semibold text-white hover:text-slate-200 px-2 py-2"
            >
              Sign In
            </button>
            <button
              onClick={() => onEnterApp('dashboard')}
              className="px-5 py-2.5 rounded-lg bg-[#F66B17] hover:bg-[#D94E07] text-white text-sm font-bold shadow-sm transition-colors"
            >
              Request a Demo
            </button>
          </div>
        </div>
      </header>

          </div>
  );
}

export default LandingPage;
