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
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.1] mb-8 drop-shadow-2xl">
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

      {/* 4. One Platform Diagram */}
      <section id="platform" className="py-32 px-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#F66B17] mb-4">The SmartSite platform</h2>
            <h3 className="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-6">
              One platform.<br />Every part of your<br />site connected.
            </h3>
            <p className="text-lg text-slate-500 leading-relaxed">
              SmartSite brings workforce, access, safety intelligence and site operations into one connected construction platform.
            </p>
          </div>

          <div className="relative aspect-square max-w-[400px] mx-auto w-full flex items-center justify-center animate-[spin_60s_linear_infinite]">
            {/* Outer rings */}
            <div className="absolute inset-0 rounded-full border border-slate-100 flex items-center justify-center shadow-[inset_0_0_50px_rgba(0,0,0,0.02)]">
              <div className="absolute w-[65%] h-[65%] rounded-full border border-slate-100 flex items-center justify-center shadow-[0_0_30px_rgba(0,0,0,0.02)]">
                {/* Core */}
                <div className="absolute w-[45%] h-[45%] rounded-full bg-[#041D2E] shadow-2xl flex flex-col items-center justify-center z-10 shadow-[#041D2E]/20 animate-[spin_60s_linear_infinite_reverse]">
                   <div className="w-8 h-8 rounded-lg bg-[#F66B17] flex items-center justify-center font-black text-white text-base shadow-sm mb-2">
                    S
                   </div>
                   <span className="text-white font-bold text-sm">SmartSite</span>
                </div>
              </div>
            </div>

            {/* Orbiting nodes */}
            <div className="absolute top-[8%] left-1/2 -translate-x-1/2 px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse]">
              Workforce
            </div>
            <div className="absolute bottom-[8%] left-1/2 -translate-x-1/2 px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse]">
              Operations
            </div>
            <div className="absolute left-[-2%] top-1/2 -translate-y-1/2 px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse]">
              Access
            </div>
            <div className="absolute right-[-2%] top-1/2 -translate-y-1/2 px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse]">
              Safety AI
            </div>
          </div>
        </div>
      </section>

      {/* 5. Built Around Operations */}
      <section id="solutions" className="py-24 px-6 bg-slate-50 border-y border-slate-100">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-20 max-w-2xl">
            Built around how construction<br />sites actually operate.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
            {/* Workforce Management */}
            <div className="flex gap-6 group">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
                <IconUsers className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Workforce Management</div>
                <h4 className="text-xl font-black text-slate-900 mb-6">One verified workforce record</h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Worker profiles</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Contractor assignments</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Certificates</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Site assignments</li>
                </ul>
              </div>
            </div>

            {/* Site Access */}
            <div className="flex gap-6 group">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
                <IconKey className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Site Access</div>
                <h4 className="text-xl font-black text-slate-900 mb-6">Secure every arrival and departure</h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Face recognition</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Dynamic QR</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Assignment verification</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Entry / exit records</li>
                </ul>
              </div>
            </div>

            {/* AI Safety */}
            <div className="flex gap-6 group">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
                <IconShield className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">AI Safety</div>
                <h4 className="text-xl font-black text-slate-900 mb-6">Always-on safety intelligence</h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />PPE Monitoring</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Restricted Zone Monitoring</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Real-time safety alerts</li>
                </ul>
              </div>
            </div>

            {/* Incident Management */}
            <div className="flex gap-6 group">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0 transition-transform group-hover:scale-110">
                <IconAlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">Incident Management</div>
                <h4 className="text-xl font-black text-slate-900 mb-6">Move evidence into action</h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Safety-event review</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Evidence</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Status tracking</li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium"><IconCheck className="w-4 h-4 text-[#F66B17]" />Resolution workflow</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Safety AI - EXACTLY like screenshot 2 */}
      <section id="safety-ai" className="py-24 px-6 bg-[#041D2E] text-white overflow-hidden">
        <div className="max-w-7xl mx-auto space-y-12">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h3 className="text-4xl md:text-5xl font-black text-white leading-tight mb-4">
                See risk.<br />Verify context. Act faster.
              </h3>
              <p className="text-slate-400 text-lg leading-relaxed">
                SmartSite turns site cameras into an intelligent safety layer that detects potential risks and connects them with real operational data.
              </p>
            </div>
            <div className="flex bg-[#0B1521] border border-white/10 rounded-xl p-1 shadow-inner">
              <button
                onClick={() => setActiveAiTab('ppe')}
                className={`px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activeAiTab === 'ppe' ? 'bg-[#F66B17] text-white shadow-lg' : 'text-slate-400 hover:text-white'
                }`}
              >
                PPE MONITORING
              </button>
              <button
                onClick={() => setActiveAiTab('zones')}
                className={`px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activeAiTab === 'zones' ? 'bg-[#F66B17] text-white shadow-lg' : 'text-slate-400 hover:text-white'
                }`}
              >
                RESTRICTED ZONES
              </button>
            </div>
          </div>

          {/* Interactive AI Showcase Component */}
          <div className="bg-[#0B1521] border border-white/10 rounded-2xl flex flex-col lg:flex-row overflow-hidden shadow-2xl">
            {/* Left side: Video Feed */}
            <div className="lg:w-2/3 relative aspect-video bg-black">
              <img
                src="https://images.pexels.com/photos/1216589/pexels-photo-1216589.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=1"
                alt="Construction AI View"
                className="w-full h-full object-cover opacity-90"
              />
              
              {/* Video Overlays */}
              <div className="absolute top-4 left-4">
                <div className="text-white text-xs font-bold tracking-widest bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10 shadow-sm mb-1">
                  CAM-07
                </div>
                <div className="text-slate-300 text-[10px] tracking-widest font-semibold ml-1">
                  WORK AREA B
                </div>
              </div>
              
              <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-md border border-white/10">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-[10px] font-bold tracking-widest">LIVE • 10:42:16</span>
              </div>

              {/* Bounding Box Simulation */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-80 border-[3px] border-[#F66B17] group cursor-pointer transition-colors hover:bg-[#F66B17]/10">
                <div className="absolute -top-[28px] left-[-3px] bg-[#F66B17] px-3 py-1">
                  <span className="text-white text-[10px] font-bold tracking-widest">WORKER #1024 • 97%</span>
                </div>
              </div>
              
              {/* Scanning laser effect */}
              <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-[#F66B17] opacity-50 shadow-[0_0_10px_#F66B17] animate-pulse" />
            </div>

            {/* Right side: PPE Checklist & Result */}
            <div className="lg:w-1/3 bg-[#0B1521] p-8 flex flex-col h-full border-l border-white/5">
              <div className="mb-6">
                <span className="text-[#F66B17] text-[10px] font-bold tracking-widest uppercase">PPE CHECK</span>
              </div>

              <div className="space-y-6 flex-1">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="text-white text-sm font-semibold">Helmet</span>
                  <IconCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="text-white text-sm font-semibold">Safety Vest</span>
                  <IconCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="flex items-center justify-between border-b border-white/10 pb-4 bg-red-500/5 -mx-8 px-8 border-l-[3px] border-l-red-500">
                  <span className="text-white text-sm font-semibold">Gloves</span>
                  <IconX className="w-5 h-5 text-red-500" />
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-white/10">
                <div className="border-l-4 border-red-500 pl-4 mb-6">
                  <div className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mb-1">RESULT</div>
                  <div className="text-red-500 text-xl font-black tracking-tight mb-1">PPE VIOLATION</div>
                  <div className="text-slate-400 text-xs">Missing required PPE: Gloves</div>
                </div>
                
                <button
                  onClick={() => onEnterApp('ppe')}
                  className="w-full sm:w-auto px-6 py-3 rounded-lg bg-[#F66B17] hover:bg-[#D94E07] text-white font-bold text-sm shadow-xl transition-all flex items-center justify-between"
                >
                  <span>Explore PPE Monitoring</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Dashboard Mockup - EXACTLY like screenshot 3 */}
      <section className="py-24 px-6 bg-[#041D2E] text-white border-t border-white/5">
        <div className="max-w-7xl mx-auto space-y-12">
          
          <div className="flex flex-col md:flex-row justify-between md:items-end gap-6 max-w-5xl">
            <h3 className="text-4xl md:text-5xl font-black leading-tight text-white">
              Your construction site.<br />One operational view.
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed max-w-sm mb-2">
              Live signals from people, access points, cameras and connected equipment — organized for faster decisions.
            </p>
          </div>

          {/* Full Dashboard Mockup Card */}
          <div className="bg-white rounded-[20px] shadow-2xl overflow-hidden text-slate-900 border border-white/10">
            {/* Mockup Header bar */}
            <div className="bg-white px-6 py-4 flex items-center gap-2 border-b border-slate-100">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F66B17]" />
              <span className="text-sm font-bold text-slate-800">Tower A · Live Operations</span>
            </div>

            <div className="flex flex-col md:flex-row h-[500px]">
              {/* Sidebar */}
              <div className="w-full md:w-56 bg-[#041D2E] p-4 flex flex-col gap-1 shrink-0 h-full">
                <div className="bg-[#F66B17] text-white px-4 py-2.5 rounded-lg text-sm font-bold cursor-pointer">Overview</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">Workforce</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">Access</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">Safety</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">Cameras</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">Incidents</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">IoT</div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">Progress</div>
              </div>

              {/* Main Dashboard Content */}
              <div className="flex-1 bg-slate-50 p-6 md:p-8 overflow-y-auto">
                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">Workers On Site</div>
                    <div className="text-3xl font-black text-slate-900">328</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">Active Contractors</div>
                    <div className="text-3xl font-black text-slate-900">14</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">Safety Compliance</div>
                    <div className="text-3xl font-black text-slate-900">96.8%</div>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">Open Alerts</div>
                    <div className="text-3xl font-black text-slate-900">7</div>
                  </div>
                </div>

                {/* Charts Row */}
                <div className="flex flex-col lg:flex-row gap-6 h-[250px]">
                  {/* Site Activity Chart */}
                  <div className="flex-[2] bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                      <h4 className="font-bold text-slate-800 text-sm">Site activity</h4>
                      <span className="text-xs text-slate-400 font-medium">Today</span>
                    </div>
                    <div className="flex-1 flex items-end justify-between gap-4 px-2">
                      {[30, 45, 60, 40, 80, 50, 70, 90, 65, 85].map((h, i) => (
                        <div 
                          key={i} 
                          className="w-full bg-[#F66B17]/80 hover:bg-[#F66B17] rounded-t-md transition-colors cursor-pointer" 
                          style={{ height: `${h}%` }} 
                        />
                      ))}
                    </div>
                  </div>

                  {/* Live Systems List */}
                  <div className="flex-1 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                    <h4 className="font-bold text-slate-800 text-sm mb-6">Live systems</h4>
                    <div className="space-y-6">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-500">Access Control</span>
                        <span className="text-xs font-bold text-emerald-600">Online</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-500">Safety AI</span>
                        <span className="text-xs font-bold text-emerald-600">12 cameras</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-semibold text-slate-500">IoT Sensors</span>
                        <span className="text-xs font-bold text-emerald-600">48 active</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. Lifecycle */}
      <section className="py-24 px-6 bg-white border-t border-slate-100">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-16 items-center">
          <div className="md:w-1/2">
            <h3 className="text-4xl md:text-5xl font-black text-slate-900 mb-6 leading-tight">Connected from the gate to the jobsite.</h3>
            <p className="text-slate-500 text-lg leading-relaxed">
              SmartSite connects events across the worker lifecycle instead of operating as isolated tools.
            </p>
          </div>

          <div className="md:w-1/2 pl-8">
            <div className="border-l-2 border-slate-100 py-4 space-y-10 relative">
              {[
                'Onboarding',
                'Site Access',
                'Zone Entry',
                'Safety Monitoring',
                'Alerts',
                'Incident Review',
                'Site Operations'
              ].map((step, index) => (
                <div key={step} className="relative flex items-center pl-8 group">
                  <div className="absolute -left-[11px] w-5 h-5 rounded-full bg-[#F66B17] border-[4px] border-white shadow-sm transition-transform group-hover:scale-150" />
                  <div className="text-base font-bold text-slate-900 transition-colors group-hover:text-[#F66B17]">{step}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 10. Bottom CTA */}
      <section className="py-24 px-6 bg-[#041D2E] text-white border-b border-white/5 relative overflow-hidden">
        {/* Subtle background decoration */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#F66B17]/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-12 relative z-10">
          <div className="md:w-1/2 text-center md:text-left">
            <h2 className="text-4xl md:text-5xl font-black mb-6 leading-tight">Build smarter.<br /><span className="text-[#F66B17]">Work safer.</span></h2>
            <p className="text-slate-400 text-lg">
              Connect your workforce, safety systems and construction operations with SmartSite.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4">
            <button onClick={() => onEnterApp('dashboard')} className="px-8 py-4 rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] font-bold text-sm shadow-[0_0_20px_rgba(246,107,23,0.3)] hover:shadow-[0_0_30px_rgba(246,107,23,0.5)] transition-all whitespace-nowrap">
              Launch Workspace
            </button>
            <button onClick={() => onEnterApp('dashboard')} className="px-8 py-4 rounded-xl bg-white/5 hover:bg-white/10 font-bold text-sm border border-white/10 transition-all whitespace-nowrap backdrop-blur-sm">
              Request Demo
            </button>
          </div>
        </div>
      </section>

      {/* 11. Footer */}
      <footer className="py-16 px-6 bg-[#041D2E] text-white">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-12 text-sm">
          <div className="col-span-2 space-y-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#F66B17] flex items-center justify-center font-black text-white text-base shadow-[0_0_15px_rgba(246,107,23,0.4)]">
                S
              </div>
              <span className="text-xl font-bold tracking-tight">Smart<span className="text-[#F66B17]">Site</span></span>
            </div>
            <p className="text-slate-400 text-sm max-w-xs leading-relaxed">
              Intelligent construction operations and AI safety, connected in one platform.
            </p>
            <p className="text-slate-500 text-xs pt-4">© 2026 SmartSite · SEP490 Capstone Project.</p>
          </div>

          <div>
            <h4 className="font-bold text-white mb-6 text-xs tracking-widest">PLATFORM</h4>
            <ul className="space-y-4 text-slate-400 text-sm">
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('workforce')}>Workforce</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('access')}>Site Access</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('ppe')}>Safety AI</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('iot')}>IoT</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('progress')}>Progress</li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white mb-6 text-xs tracking-widest">SOLUTIONS</h4>
            <ul className="space-y-4 text-slate-400 text-sm">
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('ppe')}>PPE Monitoring</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('zones')}>Restricted Zones</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('incidents')}>Incident Management</li>
            </ul>
          </div>

          <div>
            <h4 className="font-bold text-white mb-6 text-xs tracking-widest">PRODUCT</h4>
            <ul className="space-y-4 text-slate-400 text-sm">
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('dashboard')}>Sign In</li>
              <li className="hover:text-white cursor-pointer transition-colors" onClick={() => onEnterApp('dashboard')}>Request Demo</li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
