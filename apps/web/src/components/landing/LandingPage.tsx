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

      {/* 2. Hero Section - EXACTLY like screenshot 1 */}
      <section 
        className="relative min-h-screen flex items-center pt-20 overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: "url('https://onsite-guard-ai.lovable.app/assets/smartsite-hero-BVCX8sql.jpg')" }}
      >
        {/* Gradient Overlays - Reduced opacity to make image clearer */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#041D2E]/90 via-[#041D2E]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#041D2E]/70" />
        <div className="absolute inset-0 bg-[#041D2E]/20" /> {/* Slight overall tint for text readability */}
        
        <div className="max-w-7xl mx-auto px-6 relative z-10 w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center h-full pb-20">
          <div className="lg:col-span-8">
            <div className="inline-block mb-6 text-[#F66B17] text-xs font-bold tracking-widest uppercase bg-black/30 px-3 py-1.5 rounded backdrop-blur-sm">
              Intelligent construction platform
            </div>
            <h1 className="text-6xl sm:text-7xl md:text-8xl font-black tracking-tight text-white leading-[1.05] mb-8 drop-shadow-2xl">
              SMARTER SITES.<br />
              <span className="text-[#F66B17]">SAFER</span> WORK.
            </h1>
            <p className="text-lg md:text-xl text-slate-200 mb-12 max-w-2xl leading-relaxed drop-shadow-lg font-medium">
              Connect workforce management, site access, AI safety monitoring and construction operations in one intelligent platform.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <a
                href="#platform"
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] text-white font-bold text-sm shadow-xl shadow-[#F66B17]/20 transition-all flex justify-center items-center gap-2"
              >
                Explore SmartSite <span className="ml-1">↓</span>
              </a>
              <a
                href="#safety-ai"
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-black/40 hover:bg-black/60 backdrop-blur-md text-white font-bold text-sm shadow-sm border border-white/20 transition-all flex justify-center items-center gap-2"
              >
                See AI Safety <span className="ml-1">→</span>
              </a>
            </div>
          </div>
          
          {/* Live Site Float Card - Moved down to not block the worker */}
          <div className="lg:col-span-4 lg:justify-self-end w-full max-w-sm mt-12 lg:mt-48 xl:mt-64 translate-y-12 animate-fade-in-up">
             <div className="bg-[#0B1521]/30 backdrop-blur-2xl border border-white/20 rounded-2xl p-6 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
               <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
                 <span className="text-xs font-bold text-white tracking-widest">LIVE SITE</span>
                 <span className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase">
                   <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                   Online
                 </span>
               </div>
               <div className="space-y-6">
                 <div className="flex justify-between items-center">
                   <span className="text-sm text-slate-400">Workers On Site</span>
                   <span className="text-3xl font-black text-white">328</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-sm text-slate-400">Safety Compliance</span>
                   <span className="text-3xl font-black text-white">96.8%</span>
                 </div>
                 <div className="flex justify-between items-center">
                   <span className="text-sm text-slate-400">Active Alerts</span>
                   <span className="text-3xl font-black text-white">7</span>
                 </div>
               </div>
             </div>
          </div>
        </div>
      </section>

          </div>
  );
}

export default LandingPage;
