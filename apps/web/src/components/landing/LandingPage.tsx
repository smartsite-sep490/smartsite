import React, { useState } from 'react';
import {
  IconCheck,
  IconHardHat,
  IconShield,
  IconUsers,
  IconKey,
  IconRadio,
  IconAlertTriangle,
  IconCamera,
} from '../icons';

interface LandingPageProps {
  onEnterApp: (tab?: 'ppe' | 'zones' | 'dashboard') => void;
}

export function LandingPage({ onEnterApp }: LandingPageProps) {
  const [activePreview, setActivePreview] = useState<'ppe' | 'zones'>('ppe');

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans">
      {/* Top Navigation */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#F66B17] flex items-center justify-center font-black text-white text-base shadow-sm">
              S
            </div>
            <span className="text-xl font-bold tracking-tight">
              Smart<span className="text-[#F66B17]">Site</span>
            </span>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#platform" className="hover:text-slate-900 transition-colors">Platform</a>
            <a href="#solutions" className="hover:text-slate-900 transition-colors">Solutions</a>
            <a href="#ai" className="hover:text-slate-900 transition-colors">Safety AI</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How It Works</a>
            <a href="#about" className="hover:text-slate-900 transition-colors">About</a>
          </nav>

          {/* Action Buttons */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => onEnterApp('dashboard')}
              className="text-sm font-semibold text-slate-700 hover:text-slate-950 px-3 py-1.5"
            >
              Sign In
            </button>
            <button
              onClick={() => onEnterApp('dashboard')}
              className="px-5 py-2.5 rounded-lg bg-[#F66B17] hover:bg-[#D94E07] text-white text-sm font-bold shadow-sm transition-colors"
            >
              Open Workspace
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative bg-[#0F172A] text-white py-24 px-6 overflow-hidden">
        {/* Background Image / Overlay Simulation */}
        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(#94a3b8_1px,transparent_1px)] [background-size:16px_16px]" />

        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 items-center relative z-10">
          {/* Hero Left Content */}
          <div className="lg:col-span-7 space-y-6">
            <span className="text-xs font-bold uppercase tracking-widest text-[#F66B17]">
              INTELLIGENT CONSTRUCTION PLATFORM
            </span>
            <h1 className="text-5xl sm:text-6xl font-black tracking-tight leading-tight">
              SMARTER SITES. <br />
              <span className="text-[#F66B17]">SAFER WORK.</span>
            </h1>
            <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
              Connect workforce management, site access, AI safety monitoring and construction operations in one intelligent platform.
            </p>
            <div className="flex flex-wrap gap-4 pt-2">
              <button
                onClick={() => onEnterApp('dashboard')}
                className="px-6 py-3.5 rounded-xl bg-[#F66B17] hover:bg-[#D94E07] text-white text-sm font-bold shadow-lg transition-colors flex items-center gap-2"
              >
                <span>Explore SmartSite</span>
                <span>↓</span>
              </button>
              <button
                onClick={() => onEnterApp('ppe')}
                className="px-6 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold border border-slate-700 transition-colors flex items-center gap-2"
              >
                <span>See AI Safety</span>
                <span>→</span>
              </button>
            </div>
          </div>

          {/* Hero Right Floating Card (Live Site Status) */}
          <div className="lg:col-span-5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl p-6 text-white space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <span className="text-xs font-bold tracking-widest text-slate-400">LIVE SITE</span>
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                ONLINE
              </span>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center py-1">
                <span className="text-sm text-slate-300">Workers On Site</span>
                <span className="text-2xl font-black text-white">328</span>
              </div>
              <div className="flex justify-between items-center py-1 border-t border-white/10 pt-3">
                <span className="text-sm text-slate-300">Safety Compliance</span>
                <span className="text-2xl font-black text-emerald-400">96.8%</span>
              </div>
              <div className="flex justify-between items-center py-1 border-t border-white/10 pt-3">
                <span className="text-sm text-slate-300">Active Alerts</span>
                <span className="text-2xl font-black text-orange-400">7</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Challenge Section */}
      <section className="py-20 px-6 max-w-7xl mx-auto border-b border-slate-100">
        <div className="space-y-4 max-w-2xl mb-12">
          <span className="text-xs font-bold uppercase tracking-widest text-[#F66B17]">
            THE CHALLENGE
          </span>
          <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-slate-900">
            Construction sites are complex. Your systems shouldn't be.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <span className="text-xs font-mono font-bold text-[#F66B17]">01</span>
            <h3 className="font-bold text-base text-slate-900">DISCONNECTED WORKFORCE</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Worker profiles, contractor assignments, certifications and site eligibility are often managed separately.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <span className="text-xs font-mono font-bold text-[#F66B17]">02</span>
            <h3 className="font-bold text-base text-slate-900">SAFETY RISKS</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Manual observation cannot continuously monitor every worker, camera and restricted area.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <span className="text-xs font-mono font-bold text-[#F66B17]">03</span>
            <h3 className="font-bold text-base text-slate-900">FRAGMENTED SITE DATA</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Access control, safety events, cameras, IoT and project operations can become disconnected.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Architecture Section */}
      <section id="solutions" className="py-20 px-6 max-w-7xl mx-auto space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-3">
          <span className="text-xs font-bold uppercase tracking-widest text-[#F66B17]">
            BUILT FOR OPERATIONS
          </span>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900">
            Built around how construction sites actually operate.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center">
              <IconUsers className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900">One verified workforce record</h3>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-center gap-2"><IconCheck className="w-3.5 h-3.5 text-emerald-600" /> Worker profiles & certifications</li>
              <li className="flex items-center gap-2"><IconCheck className="w-3.5 h-3.5 text-emerald-600" /> Contractor assignments & site eligibility</li>
            </ul>
          </div>

          <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
              <IconKey className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900">Secure arrival & departure</h3>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-center gap-2"><IconCheck className="w-3.5 h-3.5 text-emerald-600" /> Face recognition & dynamic QR</li>
              <li className="flex items-center gap-2"><IconCheck className="w-3.5 h-3.5 text-emerald-600" /> Automated entry / exit records</li>
            </ul>
          </div>

          <div className="p-6 rounded-2xl border border-slate-200 bg-white shadow-sm space-y-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center">
              <IconHardHat className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-lg text-slate-900">Always-on safety intelligence</h3>
            <ul className="space-y-2 text-xs text-slate-600">
              <li className="flex items-center gap-2"><IconCheck className="w-3.5 h-3.5 text-emerald-600" /> MF05 PPE Monitoring (Helmets, Vests, Gloves)</li>
              <li className="flex items-center gap-2"><IconCheck className="w-3.5 h-3.5 text-emerald-600" /> MF06 Restricted Zone Polygon Monitoring</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Interactive AI Preview Section */}
      <section id="ai" className="py-20 px-6 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#F66B17]">
                SMARTSITE AI SAFETY
              </span>
              <h2 className="text-3xl sm:text-4xl font-black mt-2">
                See risk. Verify context. Act faster.
              </h2>
              <p className="text-sm text-slate-400 mt-2 max-w-xl">
                SmartSite turns site cameras into an intelligent safety layer that detects potential risks and connects them with real operational data.
              </p>
            </div>

            <div className="flex items-center gap-2 bg-slate-800 p-1.5 rounded-xl border border-slate-700">
              <button
                onClick={() => setActivePreview('ppe')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activePreview === 'ppe'
                    ? 'bg-[#F66B17] text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                PPE MONITORING
              </button>
              <button
                onClick={() => setActivePreview('zones')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  activePreview === 'zones'
                    ? 'bg-[#F66B17] text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                RESTRICTED ZONES
              </button>
            </div>
          </div>

          {/* Quick Interactive Card */}
          <div className="bg-[#041D2E] border border-slate-700/80 rounded-2xl overflow-hidden p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-4 max-w-xl">
              <h3 className="text-2xl font-black text-white">
                {activePreview === 'ppe'
                  ? 'Real-Time PPE Detection (MF05)'
                  : 'Zone Perimeter Breach Detection (MF06)'}
              </h3>
              <p className="text-sm text-slate-300 leading-relaxed">
                {activePreview === 'ppe'
                  ? 'Detects missing hard hats, high-vis safety vests, and gloves using YOLO11s on live camera streams with sub-50ms latency.'
                  : 'Monitors dynamic geometric polygons on site and triggers instant authorization checks against current worker access rights.'}
              </p>
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => onEnterApp(activePreview)}
                  className="px-6 py-2.5 rounded-lg bg-[#F66B17] hover:bg-[#E05A0B] text-white text-xs font-bold shadow-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Open Live {activePreview === 'ppe' ? 'PPE' : 'Zone'} Console →
                </button>
              </div>
            </div>

            {/* Thumbnail Preview of Real Camera Feed */}
            <div className="w-full md:w-80 h-48 rounded-xl overflow-hidden border border-white/15 relative shadow-xl shrink-0">
              <img
                src={activePreview === 'ppe' ? '/assets/ppe-camera-view.png' : '/assets/crane-camera-view.png'}
                alt="Camera live preview"
                className="w-full h-full object-cover"
              />
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-bold">
                {activePreview === 'ppe' ? 'CAM-07 · WORK AREA B' : 'CAM-04 · CRANE ZONE'}
              </div>
              <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-[#F66B17] text-white text-[10px] font-bold">
                {activePreview === 'ppe' ? 'PPE VIOLATION' : 'NO ENTRY ZONE'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 max-w-7xl mx-auto text-center space-y-6">
        <h2 className="text-4xl font-black text-slate-900">
          Build smarter. <span className="text-[#F66B17]">Work safer.</span>
        </h2>
        <p className="text-slate-600 text-sm max-w-xl mx-auto">
          Connect your workforce, safety systems and construction operations with SmartSite today.
        </p>
        <button
          onClick={() => onEnterApp('dashboard')}
          className="px-8 py-3.5 rounded-xl bg-[#F66B17] hover:bg-[#D94E07] text-white font-bold text-sm shadow-xl transition-all"
        >
          Launch SmartSite Workspace
        </button>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-100 py-10 px-6 bg-slate-50 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <p>© 2026 SmartSite · SEP490 Capstone Project. Built for safer construction.</p>
          <div className="flex gap-6">
            <button onClick={() => onEnterApp('ppe')} className="hover:text-slate-900">PPE Monitoring</button>
            <button onClick={() => onEnterApp('zones')} className="hover:text-slate-900">Restricted Zones</button>
            <button onClick={() => onEnterApp('dashboard')} className="hover:text-slate-900">Dashboard</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
