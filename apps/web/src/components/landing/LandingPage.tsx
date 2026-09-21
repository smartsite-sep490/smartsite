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

      {/* 3. The Challenge Section */}
      <section className="py-24 px-6 bg-slate-50 border-t border-slate-100">
        <div className="max-w-6xl mx-auto">
          <div className="mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#F66B17] mb-4">The challenge</h2>
            <h3 className="text-3xl md:text-5xl font-black text-slate-900 max-w-3xl leading-tight">
              Construction sites are complex.<br />Your systems shouldn't be.
            </h3>
          </div>

          <div className="space-y-0 text-sm md:text-base hover:opacity-100 group">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-8 border-t border-slate-200 transition-all hover:bg-white hover:shadow-lg hover:px-4 rounded-xl cursor-default opacity-80 hover:opacity-100">
              <div className="md:col-span-1 text-[#F66B17] font-mono font-bold">01</div>
              <div className="md:col-span-4 font-bold text-slate-900">DISCONNECTED WORKFORCE</div>
              <div className="md:col-span-7 text-slate-500 leading-relaxed">
                Worker profiles, contractor assignments, certifications and site eligibility are often managed separately.
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-8 border-t border-slate-200 transition-all hover:bg-white hover:shadow-lg hover:px-4 rounded-xl cursor-default opacity-80 hover:opacity-100">
              <div className="md:col-span-1 text-[#F66B17] font-mono font-bold">02</div>
              <div className="md:col-span-4 font-bold text-slate-900">SAFETY RISKS</div>
              <div className="md:col-span-7 text-slate-500 leading-relaxed">
                Manual observation cannot continuously monitor every worker, camera and restricted area.
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-8 border-y border-slate-200 transition-all hover:bg-white hover:shadow-lg hover:px-4 rounded-xl cursor-default opacity-80 hover:opacity-100">
              <div className="md:col-span-1 text-[#F66B17] font-mono font-bold">03</div>
              <div className="md:col-span-4 font-bold text-slate-900">FRAGMENTED SITE DATA</div>
              <div className="md:col-span-7 text-slate-500 leading-relaxed">
                Access control, safety events, cameras, IoT and project operations can become disconnected.
              </div>
            </div>
          </div>
        </div>
      </section>

          </div>
  );
}

export default LandingPage;
