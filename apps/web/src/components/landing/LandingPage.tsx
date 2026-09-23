import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

import {
  IconCheck,
  IconHardHat,
  IconShield,
  IconUsers,
  IconKey,
  IconAlertTriangle,
  IconX,
} from '../icons';

gsap.registerPlugin(ScrollTrigger);

interface LandingPageProps {
  onEnterApp: (
    tab?: 'ppe' | 'zones' | 'dashboard' | 'workforce' | 'access' | 'iot' | 'progress' | 'incidents',
  ) => void;
}

export function LandingPage({ onEnterApp }: LandingPageProps) {
  const [activeAiTab, setActiveAiTab] = useState<'ppe' | 'zones'>('ppe');

  const containerRef = useRef<HTMLDivElement>(null);

  // 1. Hero Section Animation
  useGSAP(() => {
    const tl = gsap.timeline();

    // Animate the main headline
    tl.from('.hero-badge', { y: 20, opacity: 0, duration: 0.6, ease: 'power3.out', delay: 0.2 })
      .from('.hero-headline', { y: 40, opacity: 0, duration: 0.8, ease: 'power3.out' }, '-=0.4')
      .from('.hero-desc', { y: 20, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.6')
      .from('.hero-btns', { y: 20, opacity: 0, duration: 0.6, ease: 'power3.out' }, '-=0.4')
      .from('.hero-card', { x: -30, opacity: 0, duration: 0.8, ease: 'back.out(1.5)' }, '-=0.4');

    // Parallax on scroll for the hero background
    gsap.to('.hero-bg', {
      y: '20%',
      ease: 'none',
      scrollTrigger: {
        trigger: '.hero-section',
        start: 'top top',
        end: 'bottom top',
        scrub: true,
      },
    });

    // 2. The Challenge Section
    gsap.from('.challenge-header', {
      scrollTrigger: { trigger: '.challenge-section', start: 'top 80%' },
      y: 30, opacity: 0, duration: 0.6, ease: 'power2.out'
    });
    gsap.fromTo('.challenge-card',
      { y: 40, opacity: 0 },
      {
        scrollTrigger: { trigger: '.challenge-cards-container', start: 'top 80%' },
        y: 0, opacity: 1, duration: 0.6, stagger: 0.15, ease: 'power2.out'
      }
    );

    // 3. One Platform
    const platformTl = gsap.timeline({
      scrollTrigger: { trigger: '.platform-section', start: 'top 70%' },
    });
    platformTl.from('.platform-text > *', {
      x: -50,
      opacity: 0,
      duration: 0.8,
      stagger: 0.2,
      ease: 'back.out(1.2)',
    });
    platformTl.from(
      '.platform-diagram',
      {
        scale: 0.5,
        rotation: -45,
        opacity: 0,
        duration: 1.2,
        ease: 'elastic.out(1, 0.5)',
      },
      '-=0.6',
    );
    // Add subtle floating to the orbiting nodes
    gsap.to('.orbit-node', {
      y: -10,
      duration: 1.5,
      yoyo: true,
      repeat: -1,
      ease: 'sine.inOut',
      stagger: 0.3,
    });

    // 4. Solutions Grid Entrance
    gsap.fromTo('.solution-card',
      { y: 100, opacity: 0, scale: 0.95 },
      {
        scrollTrigger: { trigger: '.solutions-section', start: 'top 80%' },
        y: 0,
        opacity: 1,
        scale: 1,
        duration: 0.8,
        stagger: 0.15,
        ease: 'back.out(1.5)'
      }
    );

    // 4b. Solutions Grid Hover
    const solutionCards = Array.from(document.querySelectorAll('.solution-card')) as HTMLElement[];
    solutionCards.forEach((card) => {
      const icon = card.querySelector('.group-hover\\:scale-110'); // the icon container
      
      card.addEventListener('mouseenter', () => {
        gsap.to(card, { y: -10, scale: 1.02, duration: 0.3, ease: 'power2.out', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' });
        if (icon) gsap.to(icon, { rotation: 15, scale: 1.2, duration: 0.4, ease: 'back.out(2)' });
      });
      
      card.addEventListener('mouseleave', () => {
        gsap.to(card, { y: 0, scale: 1, duration: 0.3, ease: 'power2.out', boxShadow: 'none' });
        if (icon) gsap.to(icon, { rotation: 0, scale: 1, duration: 0.4, ease: 'power2.out' });
      });
    });

    // 5. Safety AI Showcase
    gsap.to('.ai-laser', {
      scrollTrigger: { trigger: '.safety-ai-section', start: 'top center', end: 'bottom center', scrub: 1 },
      top: '90%', ease: 'none'
    });
    gsap.from('.ai-checklist-item', {
      scrollTrigger: { trigger: '.safety-ai-section', start: 'top 60%' },
      x: 30, opacity: 0, duration: 0.5, stagger: 0.2, ease: 'power2.out'
    });

    // 6. Timeline
    gsap.from('.timeline-step', {
      scrollTrigger: { trigger: '.timeline-section', start: 'top 75%' },
      y: 30, opacity: 0, duration: 0.5, stagger: 0.2, ease: 'power2.out'
    });
    gsap.from('.timeline-line', {
      scrollTrigger: { trigger: '.timeline-section', start: 'top 75%' },
      width: 0, duration: 1.5, ease: 'power2.out'
    });

    // 7. Dashboard
    gsap.from('.dashboard-mockup', {
      scrollTrigger: { trigger: '.dashboard-section', start: 'top 80%' },
      y: 100, opacity: 0, duration: 0.8, ease: 'power3.out'
    });
    gsap.from('.dashboard-stat', {
      scrollTrigger: { trigger: '.dashboard-section', start: 'top 60%' },
      scale: 0.8, opacity: 0, duration: 0.5, stagger: 0.1, ease: 'back.out(1.5)'
    });

    // 8. Lifecycle
    gsap.from('.lifecycle-text', {
      scrollTrigger: { trigger: '.lifecycle-section', start: 'top 75%' },
      x: -40, opacity: 0, duration: 0.7, ease: 'power2.out'
    });
    gsap.from('.lifecycle-step', {
      scrollTrigger: { trigger: '.lifecycle-section', start: 'top 75%' },
      x: 40, opacity: 0, duration: 0.5, stagger: 0.1, ease: 'power2.out'
    });
  }, { scope: containerRef });

  return (
    <div ref={containerRef} className="relative w-full overflow-x-hidden min-h-screen bg-white text-slate-900 font-sans selection:bg-[#F66B17]/20 scroll-smooth">
      {/* 1. Header Navigation - Updated for Dark Hero */}
      <header className="absolute top-0 inset-x-0 z-50 bg-transparent">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div
            className="flex items-center gap-2.5 cursor-pointer"
            onClick={() => window.scrollTo(0, 0)}
          >
            <div className="w-8 h-8 rounded-lg bg-[#F66B17] flex items-center justify-center font-black text-white text-base shadow-sm">
              S
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              Smart<span className="text-[#F66B17]">Site</span>
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-300">
            <a href="#platform" className="hover:text-white transition-colors">
              Platform
            </a>
            <a href="#solutions" className="hover:text-white transition-colors">
              Solutions
            </a>
            <a href="#safety-ai" className="hover:text-white transition-colors">
              Safety AI
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#about" className="hover:text-white transition-colors">
              About
            </a>
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
        className="hero-section relative min-h-screen flex items-center pt-20 overflow-hidden"
      >
        <div
          className="hero-bg absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('https://onsite-guard-ai.lovable.app/assets/smartsite-hero-BVCX8sql.jpg')" }}
        />
        {/* Gradient Overlays - Reduced opacity to make image clearer */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#041D2E]/90 via-[#041D2E]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#041D2E]/70" />
        <div className="absolute inset-0 bg-[#041D2E]/20" />{' '}
        {/* Slight overall tint for text readability */}
        <div className="max-w-7xl mx-auto px-6 relative z-10 w-full grid grid-cols-1 lg:grid-cols-12 gap-12 items-center h-full pb-20">
          <div className="lg:col-span-8">
            <div className="hero-badge inline-block mb-6 text-[#F66B17] text-xs font-bold tracking-widest uppercase bg-black/30 px-3 py-1.5 rounded backdrop-blur-sm">
              Intelligent construction platform
            </div>
            <h1 className="hero-headline text-5xl md:text-6xl lg:text-7xl font-black tracking-tight text-white leading-[1.1] mb-8 drop-shadow-2xl">
              SMARTER SITES.
              <br />
              <span className="text-[#F66B17]">SAFER</span> WORK.
            </h1>
            <p className="hero-desc text-lg md:text-xl text-slate-200 mb-12 max-w-2xl leading-relaxed drop-shadow-lg font-medium">
              Connect workforce management, site access, AI safety monitoring and construction
              operations in one intelligent platform.
            </p>
            <div className="hero-btns flex flex-col sm:flex-row items-center gap-4">
              <a
                href="#platform"
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] !text-white font-bold text-sm shadow-xl shadow-[#F66B17]/20 transition-all flex justify-center items-center gap-2"
              >
                Explore SmartSite <span className="ml-1">↓</span>
              </a>
              <a
                href="#safety-ai"
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-black/40 hover:bg-black/60 backdrop-blur-md !text-white font-bold text-sm shadow-sm border border-white/20 transition-all flex justify-center items-center gap-2"
              >
                See AI Safety <span className="ml-1">→</span>
              </a>
            </div>

            {/* Live Site Float Card - Moved to the left side under the buttons to never block the worker */}
            <div className="hero-card mt-16 w-full max-w-[280px] hidden md:block">
              <div className="bg-[#0B1521]/30 backdrop-blur-2xl border border-white/20 rounded-xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-3">
                  <span className="text-[10px] font-bold text-white tracking-widest">
                    LIVE SITE
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-400 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Online
                  </span>
                </div>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-300">Workers On Site</span>
                    <span className="text-2xl font-black text-white">328</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-300">Safety Compliance</span>
                    <span className="text-2xl font-black text-white">96.8%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-300">Active Alerts</span>
                    <span className="text-2xl font-black text-white">7</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. The Challenge Section */}
      <section className="challenge-section py-24 px-6 bg-slate-50 border-t border-slate-100">
        <div className="max-w-6xl mx-auto">
          <div className="challenge-header mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#F66B17] mb-4">
              The challenge
            </h2>
            <h3 className="text-3xl md:text-5xl font-black text-slate-900 max-w-3xl leading-tight">
              Construction sites are complex.
              <br />
              Your systems shouldn't be.
            </h3>
          </div>

          <div className="challenge-cards-container space-y-0 text-sm md:text-base hover:opacity-100 group">
            <div className="challenge-card grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-8 border-t border-slate-200 transition-all hover:bg-white hover:shadow-lg hover:px-4 rounded-xl cursor-default">
              <div className="md:col-span-1 text-[#F66B17] font-mono font-bold">01</div>
              <div className="md:col-span-4 font-bold text-slate-900">DISCONNECTED WORKFORCE</div>
              <div className="md:col-span-7 text-slate-500 leading-relaxed">
                Worker profiles, contractor assignments, certifications and site eligibility are
                often managed separately.
              </div>
            </div>
            <div className="challenge-card grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-8 border-t border-slate-200 transition-all hover:bg-white hover:shadow-lg hover:px-4 rounded-xl cursor-default">
              <div className="md:col-span-1 text-[#F66B17] font-mono font-bold">02</div>
              <div className="md:col-span-4 font-bold text-slate-900">SAFETY RISKS</div>
              <div className="md:col-span-7 text-slate-500 leading-relaxed">
                Manual observation cannot continuously monitor every worker, camera and restricted
                area.
              </div>
            </div>
            <div className="challenge-card grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 py-8 border-y border-slate-200 transition-all hover:bg-white hover:shadow-lg hover:px-4 rounded-xl cursor-default">
              <div className="md:col-span-1 text-[#F66B17] font-mono font-bold">03</div>
              <div className="md:col-span-4 font-bold text-slate-900">FRAGMENTED SITE DATA</div>
              <div className="md:col-span-7 text-slate-500 leading-relaxed">
                Access control, safety events, cameras, IoT and project operations can become
                disconnected.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. One Platform Diagram */}
      <section id="platform" className="platform-section py-32 px-6 max-w-6xl mx-auto scroll-mt-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div className="platform-text">
            <h2 className="text-xs font-bold uppercase tracking-widest text-[#F66B17] mb-4">
              The SmartSite platform
            </h2>
            <h3 className="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-6">
              One platform.
              <br />
              Every part of your
              <br />
              site connected.
            </h3>
            <p className="text-lg text-slate-500 leading-relaxed">
              SmartSite brings workforce, access, safety intelligence and site operations into one
              connected construction platform.
            </p>
          </div>

          <div className="platform-diagram relative aspect-square max-w-[400px] mx-auto w-full flex items-center justify-center animate-[spin_60s_linear_infinite]">
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
            <div className="orbit-node absolute top-[8%] left-1/2 -translate-x-1/2">
              <div className="px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse] transition-transform hover:scale-110 cursor-pointer">
                Workforce
              </div>
            </div>
            <div className="orbit-node absolute bottom-[8%] left-1/2 -translate-x-1/2">
              <div className="px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse] transition-transform hover:scale-110 cursor-pointer">
                Operations
              </div>
            </div>
            <div className="orbit-node absolute left-[-2%] top-1/2 -translate-y-1/2">
              <div className="px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse] transition-transform hover:scale-110 cursor-pointer">
                Access
              </div>
            </div>
            <div className="orbit-node absolute right-[-2%] top-1/2 -translate-y-1/2">
              <div className="px-4 py-2.5 bg-white rounded-lg border border-slate-200 shadow-xl text-xs font-bold text-slate-700 tracking-wide uppercase animate-[spin_60s_linear_infinite_reverse] transition-transform hover:scale-110 cursor-pointer">
                Safety AI
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Built Around Operations */}
      <section id="solutions" className="solutions-section py-24 px-6 bg-slate-50 border-y border-slate-100 scroll-mt-10">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black text-slate-900 leading-tight mb-20 max-w-2xl">
            Built around how construction
            <br />
            sites actually operate.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16">
            {/* Workforce Management */}
            <div className="solution-card flex gap-6 group p-6 rounded-2xl bg-white border border-transparent transition-colors hover:border-slate-200">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0">
                <IconUsers className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">
                  Workforce Management
                </div>
                <h4 className="text-xl font-black text-slate-900 mb-6">
                  One verified workforce record
                </h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Worker profiles
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Contractor assignments
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Certificates
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Site assignments
                  </li>
                </ul>
              </div>
            </div>

            {/* Site Access */}
            <div className="solution-card flex gap-6 group p-6 rounded-2xl bg-white border border-transparent transition-colors hover:border-slate-200">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0">
                <IconKey className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">
                  Site Access
                </div>
                <h4 className="text-xl font-black text-slate-900 mb-6">
                  Secure every arrival and departure
                </h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Face recognition
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Dynamic QR
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Assignment verification
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Entry / exit records
                  </li>
                </ul>
              </div>
            </div>

            {/* AI Safety */}
            <div className="solution-card flex gap-6 group p-6 rounded-2xl bg-white border border-transparent transition-colors hover:border-slate-200">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0">
                <IconShield className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">
                  AI Safety
                </div>
                <h4 className="text-xl font-black text-slate-900 mb-6">
                  Always-on safety intelligence
                </h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    PPE Monitoring
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Restricted Zone Monitoring
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Real-time safety alerts
                  </li>
                </ul>
              </div>
            </div>

            {/* Incident Management */}
            <div className="solution-card flex gap-6 group p-6 rounded-2xl bg-white border border-transparent transition-colors hover:border-slate-200">
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-[#F66B17] flex items-center justify-center shrink-0">
                <IconAlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-400 mb-2 uppercase tracking-widest">
                  Incident Management
                </div>
                <h4 className="text-xl font-black text-slate-900 mb-6">
                  Move evidence into action
                </h4>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Safety-event review
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Evidence
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Status tracking
                  </li>
                  <li className="flex items-center gap-3 text-sm text-slate-600 font-medium">
                    <IconCheck className="w-4 h-4 text-[#F66B17]" />
                    Resolution workflow
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Safety AI - EXACTLY like screenshot 2 */}
      <section id="safety-ai" className="safety-ai-section py-24 px-6 bg-[#041D2E] text-white overflow-hidden scroll-mt-10">
        <div className="max-w-7xl mx-auto space-y-12">
          {/* Section Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h3 className="text-4xl md:text-5xl font-black text-white leading-tight mb-4">
                See risk.
                <br />
                Verify context. Act faster.
              </h3>
              <p className="text-slate-400 text-lg leading-relaxed">
                SmartSite turns site cameras into an intelligent safety layer that detects potential
                risks and connects them with real operational data.
              </p>
            </div>
            <div className="flex bg-[#0B1521] border border-white/10 rounded-xl p-1 shadow-inner">
              <button
                onClick={() => setActiveAiTab('ppe')}
                className={`px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activeAiTab === 'ppe'
                    ? 'bg-[#F66B17] text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                PPE MONITORING
              </button>
              <button
                onClick={() => setActiveAiTab('zones')}
                className={`px-6 py-2.5 rounded-lg text-xs font-bold transition-all ${
                  activeAiTab === 'zones'
                    ? 'bg-[#F66B17] text-white shadow-lg'
                    : 'text-slate-400 hover:text-white'
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
                <span className="text-white text-[10px] font-bold tracking-widest">
                  LIVE • 10:42:16
                </span>
              </div>

              {/* Bounding Box Simulation */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-80 border-[3px] border-[#F66B17] group cursor-pointer transition-colors hover:bg-[#F66B17]/10">
                <div className="absolute -top-[28px] left-[-3px] bg-[#F66B17] px-3 py-1">
                  <span className="text-white text-[10px] font-bold tracking-widest">
                    WORKER #1024 • 97%
                  </span>
                </div>
              </div>

              {/* Scanning laser effect */}
              <div className="ai-laser absolute top-0 left-0 right-0 h-[2px] bg-[#F66B17] shadow-[0_0_15px_#F66B17]" />
            </div>

            {/* Right side: PPE Checklist & Result */}
            <div className="lg:w-1/3 bg-[#0B1521] p-8 flex flex-col h-full border-l border-white/5">
              <div className="mb-6">
                <span className="text-[#F66B17] text-[10px] font-bold tracking-widest uppercase">
                  PPE CHECK
                </span>
              </div>

              <div className="space-y-6 flex-1">
                <div className="ai-checklist-item flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="text-white text-sm font-semibold">Helmet</span>
                  <IconCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="ai-checklist-item flex items-center justify-between border-b border-white/10 pb-4">
                  <span className="text-white text-sm font-semibold">Safety Vest</span>
                  <IconCheck className="w-5 h-5 text-emerald-500" />
                </div>
                <div className="ai-checklist-item flex items-center justify-between border-b border-white/10 pb-4 bg-red-500/5 -mx-8 px-8 border-l-[3px] border-l-red-500">
                  <span className="text-white text-sm font-semibold">Gloves</span>
                  <IconX className="w-5 h-5 text-red-500" />
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-white/10">
                <div className="border-l-4 border-red-500 pl-4 mb-6">
                  <div className="text-[10px] text-slate-400 font-bold tracking-widest uppercase mb-1">
                    RESULT
                  </div>
                  <div className="text-red-500 text-xl font-black tracking-tight mb-1">
                    PPE VIOLATION
                  </div>
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

      {/* 7. How It Works */}
      <section id="how-it-works" className="timeline-section py-24 px-6 bg-[#FAFAFA] scroll-mt-10">
        <div className="max-w-7xl mx-auto">
          <div className="mb-20">
            <div className="text-[#F66B17] text-[10px] font-black tracking-widest uppercase mb-4">
              HOW IT WORKS
            </div>
            <h2 className="text-4xl md:text-[44px] lg:text-[56px] font-black text-[#041D2E] tracking-tight leading-tight">
              From site activity to actionable intelligence.
            </h2>
          </div>

          {/* Timeline */}
          <div className="relative">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-8 lg:gap-12 relative z-10">
              {/* Step 1 */}
              <div className="timeline-step relative pt-8 md:pt-0">
                <div className="timeline-line hidden md:block absolute top-[6px] left-2 w-[calc(100%+2rem)] lg:w-[calc(100%+3rem)] h-[3px] bg-[#F66B17] -z-10 origin-left" />
                <div className="absolute left-0 md:left-auto md:top-0 w-4 h-4 rounded-full bg-[#F66B17] border-[4px] box-content border-[#FAFAFA] z-10" />
                <div className="mt-8 md:mt-10">
                  <div className="text-[#F66B17] font-black text-xs mb-1">01</div>
                  <h4 className="font-black text-[#041D2E] text-base mb-4 tracking-tight">SENSE</h4>
                  <p className="text-slate-500 text-sm leading-relaxed pr-4">
                    Cameras, gates and site systems collect operational events.
                  </p>
                </div>
              </div>
              {/* Step 2 */}
              <div className="timeline-step relative pt-8 md:pt-0">
                <div className="timeline-line hidden md:block absolute top-[6px] left-2 w-[calc(100%+2rem)] lg:w-[calc(100%+3rem)] h-[3px] bg-[#F66B17] -z-10 origin-left" />
                <div className="absolute left-0 md:left-auto md:top-0 w-4 h-4 rounded-full bg-[#F66B17] border-[4px] box-content border-[#FAFAFA] z-10" />
                <div className="mt-8 md:mt-10">
                  <div className="text-[#F66B17] font-black text-xs mb-1">02</div>
                  <h4 className="font-black text-[#041D2E] text-base mb-4 tracking-tight">
                    UNDERSTAND
                  </h4>
                  <p className="text-slate-500 text-sm leading-relaxed pr-4">
                    SmartSite identifies workers, equipment and safety conditions.
                  </p>
                </div>
              </div>
              {/* Step 3 */}
              <div className="timeline-step relative pt-8 md:pt-0">
                <div className="timeline-line hidden md:block absolute top-[6px] left-2 w-[calc(100%+2rem)] lg:w-[calc(100%+3rem)] h-[3px] bg-[#F66B17] -z-10 origin-left" />
                <div className="absolute left-0 md:left-auto md:top-0 w-4 h-4 rounded-full bg-[#F66B17] border-[4px] box-content border-[#FAFAFA] z-10" />
                <div className="mt-8 md:mt-10">
                  <div className="text-[#F66B17] font-black text-xs mb-1">03</div>
                  <h4 className="font-black text-[#041D2E] text-base mb-4 tracking-tight">
                    VERIFY
                  </h4>
                  <p className="text-slate-500 text-sm leading-relaxed pr-4">
                    The platform checks assignments, PPE requirements and zone permissions.
                  </p>
                </div>
              </div>
              {/* Step 4 */}
              <div className="timeline-step relative pt-8 md:pt-0">
                <div className="timeline-line hidden md:block absolute top-[6px] left-2 w-[calc(100%+2rem)] lg:w-[calc(100%+3rem)] h-[3px] bg-[#F66B17] -z-10 origin-left" />
                <div className="absolute left-0 md:left-auto md:top-0 w-4 h-4 rounded-full bg-[#F66B17] border-[4px] box-content border-[#FAFAFA] z-10" />
                <div className="mt-8 md:mt-10">
                  <div className="text-[#F66B17] font-black text-xs mb-1">04</div>
                  <h4 className="font-black text-[#041D2E] text-base mb-4 tracking-tight">ALERT</h4>
                  <p className="text-slate-500 text-sm leading-relaxed pr-4">
                    Relevant violations or uncertain events generate classified alerts.
                  </p>
                </div>
              </div>
              {/* Step 5 */}
              <div className="timeline-step relative pt-8 md:pt-0">
                <div className="absolute left-0 md:left-auto md:top-0 w-4 h-4 rounded-full bg-[#F66B17] border-[4px] box-content border-[#FAFAFA] z-10" />
                <div className="mt-8 md:mt-10">
                  <div className="text-[#F66B17] font-black text-xs mb-1">05</div>
                  <h4 className="font-black text-[#041D2E] text-base mb-4 tracking-tight">ACT</h4>
                  <p className="text-slate-500 text-sm leading-relaxed pr-4">
                    Responsible personnel review and resolve the event.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Dashboard Mockup - EXACTLY like screenshot 3 */}
      <section className="dashboard-section py-24 px-6 bg-[#041D2E] text-white border-t border-white/5">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="flex flex-col md:flex-row justify-between md:items-end gap-6 max-w-5xl">
            <h3 className="text-4xl md:text-5xl font-black leading-tight text-white">
              Your construction site.
              <br />
              One operational view.
            </h3>
            <p className="text-slate-400 text-sm leading-relaxed max-w-sm mb-2">
              Live signals from people, access points, cameras and connected equipment — organized
              for faster decisions.
            </p>
          </div>

          {/* Full Dashboard Mockup Card */}
          <div className="dashboard-mockup bg-white rounded-[20px] shadow-2xl overflow-hidden text-slate-900 border border-white/10">
            {/* Mockup Header bar */}
            <div className="bg-white px-6 py-4 flex items-center gap-2 border-b border-slate-100">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F66B17]" />
              <span className="text-sm font-bold text-slate-800">Tower A · Live Operations</span>
            </div>

            <div className="flex flex-col md:flex-row h-[500px]">
              {/* Sidebar */}
              <div className="w-full md:w-56 bg-[#041D2E] p-4 flex flex-col gap-1 shrink-0 h-full">
                <div className="bg-[#F66B17] text-white px-4 py-2.5 rounded-lg text-sm font-bold cursor-pointer">
                  Overview
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  Workforce
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  Access
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  Safety
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  Cameras
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  Incidents
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  IoT
                </div>
                <div className="text-slate-300 hover:bg-white/5 hover:text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer transition-colors">
                  Progress
                </div>
              </div>

              {/* Main Dashboard Content */}
              <div className="flex-1 bg-slate-50 p-6 md:p-8 overflow-y-auto">
                {/* Stats Row */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="dashboard-stat bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">
                      Workers On Site
                    </div>
                    <div className="text-3xl font-black text-slate-900">328</div>
                  </div>
                  <div className="dashboard-stat bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">
                      Active Contractors
                    </div>
                    <div className="text-3xl font-black text-slate-900">14</div>
                  </div>
                  <div className="dashboard-stat bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">
                      Safety Compliance
                    </div>
                    <div className="text-3xl font-black text-slate-900">96.8%</div>
                  </div>
                  <div className="dashboard-stat bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="text-[10px] text-slate-500 font-bold mb-2 tracking-widest uppercase">
                      Open Alerts
                    </div>
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

      {/* 9. Lifecycle (Connected from the gate to the jobsite) */}
      <section className="lifecycle-section py-24 px-6 bg-white border-t border-slate-100 scroll-mt-10">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-16 md:items-center">
          <div className="lifecycle-text md:w-1/2">
            <h3 className="text-4xl md:text-5xl font-black text-[#041D2E] mb-6 leading-tight">
              Connected from
              <br />
              the gate to the
              <br />
              jobsite.
            </h3>
            <p className="text-slate-500 text-sm leading-relaxed max-w-sm">
              SmartSite connects events across the worker lifecycle instead of operating as isolated
              tools.
            </p>
          </div>

          <div className="md:w-1/2 md:pl-16 w-full">
            <div className="space-y-4">
              {[
                'WORKFORCE',
                'SITE ASSIGNMENT',
                'SITE ACCESS',
                'SITE OPERATIONS',
                'AI SAFETY',
                'INCIDENT RESPONSE',
                'SITE INTELLIGENCE',
              ].map((step, index) => (
                <div
                  key={step}
                  className="lifecycle-step flex items-center justify-between group cursor-pointer py-1"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded-full bg-[#F66B17] flex items-center justify-center text-white text-[10px] font-black shrink-0">
                      {index + 1}
                    </div>
                    <div className="text-xs font-black text-[#041D2E]">{step}</div>
                  </div>
                  <div className="text-[#F66B17] text-lg font-light">↓</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 10. Bottom CTA */}
      <section className="py-24 px-6 bg-[#041D2E] text-white">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-12">
          <div className="md:w-1/2">
            <h2 className="text-5xl md:text-6xl font-black mb-6 leading-tight">
              Build smarter.
              <br />
              <span className="text-[#F66B17]">Work safer.</span>
            </h2>
            <p className="text-slate-400 text-sm max-w-md leading-relaxed">
              Connect your workforce, safety systems and construction operations with SmartSite.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 items-center md:justify-end md:w-1/2">
            <button
              onClick={() => onEnterApp('dashboard')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] !text-white font-bold text-sm transition-all whitespace-nowrap"
            >
              Request a Demo
            </button>
            <button
              onClick={() => onEnterApp('dashboard')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-transparent hover:bg-white/5 !text-white font-bold text-sm border border-slate-600 transition-all whitespace-nowrap flex items-center justify-center gap-2"
            >
              Explore Platform <span className="ml-1">→</span>
            </button>
          </div>
        </div>
      </section>

      {/* 11. Footer */}
      <footer className="py-16 px-6 bg-[#041D2E] text-white border-t border-slate-700/50">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-6 gap-12 md:gap-8 text-sm">
          <div className="col-span-2 space-y-6">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#F66B17] flex items-center justify-center shadow-sm">
                <IconHardHat className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold tracking-tight">
                Smart<span className="text-white">Site</span>
              </span>
            </div>
            <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
              Intelligent construction operations and AI safety, connected in one platform.
            </p>
          </div>

          <div>
            <h4 className="font-black text-[#F66B17] mb-6 text-[10px] tracking-widest uppercase">
              PLATFORM
            </h4>
            <ul className="space-y-4 text-slate-400 text-xs font-medium">
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('workforce')}
              >
                Workforce
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('access')}
              >
                Site Access
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('ppe')}
              >
                Safety AI
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('iot')}
              >
                IoT
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('progress')}
              >
                Progress
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-black text-[#F66B17] mb-6 text-[10px] tracking-widest uppercase">
              SOLUTIONS
            </h4>
            <ul className="space-y-4 text-slate-400 text-xs font-medium">
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('ppe')}
              >
                PPE Monitoring
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('zones')}
              >
                Restricted Zones
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('incidents')}
              >
                Incident Management
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-black text-[#F66B17] mb-6 text-[10px] tracking-widest uppercase">
              RESOURCES
            </h4>
            <ul className="space-y-4 text-slate-400 text-xs font-medium">
              <li className="hover:text-white cursor-pointer transition-colors">Documentation</li>
              <li className="hover:text-white cursor-pointer transition-colors">Support</li>
              <li className="hover:text-white cursor-pointer transition-colors">About</li>
            </ul>
          </div>

          <div>
            <h4 className="font-black text-[#F66B17] mb-6 text-[10px] tracking-widest uppercase">
              PRODUCT
            </h4>
            <ul className="space-y-4 text-slate-400 text-xs font-medium">
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('dashboard')}
              >
                Sign In
              </li>
              <li
                className="hover:text-white cursor-pointer transition-colors"
                onClick={() => onEnterApp('dashboard')}
              >
                Request Demo
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-6xl mx-auto mt-16 pt-8 border-t border-slate-700/50">
          <p className="text-slate-500 text-[10px]">
            © 2026 SmartSite. Built for safer construction.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;
