import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { IconArrowRight, IconAlertTriangle, IconUser, IconKey } from '../../components/icons';

interface RegisterScreenProps {
  onRegisterSuccess: () => void;
  onBackToLogin: () => void;
  onBackToSite: () => void;
}

export function RegisterScreen({ onRegisterSuccess, onBackToLogin, onBackToSite }: RegisterScreenProps) {
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // Start as form panel directly to avoid square->rectangle jump
      gsap.set(panelRef.current, { width: 440, height: 560, opacity: 0, scale: 0.95 });
      gsap.set('.register-form-content', { opacity: 0 });
      gsap.set('.register-loading-content', { display: 'none' });

      // Cinematic entrance
      gsap.to('.register-bg-overlay', { opacity: 1, duration: 1.5, ease: 'power2.out' });
      
      const tl = gsap.timeline({ delay: 0.05 });
      tl.to(panelRef.current, { opacity: 1, scale: 1, duration: 0.5, ease: 'back.out(1.2)' })
        .to('.register-form-content', {
          opacity: 1,
          duration: 0.3
        }, '-=0.1');
    },
    { scope: containerRef }
  );

  const handleNavigateLogin = () => {
    const tl = gsap.timeline();
    tl.to(panelRef.current, {
      opacity: 0,
      scale: 0.95,
      duration: 0.3,
      onComplete: onBackToLogin
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);

    // Simulate API call and success animation
    const tl = gsap.timeline();
    tl.to('.register-form-content', {
      opacity: 0,
      scale: 0.95,
      duration: 0.3,
    })
      .to(
        panelRef.current,
        {
          width: 240,
          height: 240,
          duration: 0.7,
          ease: 'back.inOut(1.2)',
        },
        'morph'
      )
      .to('.register-loading-content', { opacity: 1, scale: 1, duration: 0.4, onStart: () => gsap.set('.register-loading-content', { display: 'flex' }) }, 'morph+=0.4');

    setTimeout(() => {
      // Success transition
      gsap.to('.orb-core', { backgroundColor: '#10B981', boxShadow: '0 0 40px 20px rgba(16,185,129,0.4)' });
      gsap.to(panelRef.current, {
        scale: 1.1,
        opacity: 0,
        duration: 0.5,
        ease: 'power3.in',
        delay: 0.5,
        onComplete: onRegisterSuccess,
      });
    }, 1500);
  };

  return (
    <div ref={containerRef} className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#020810]">
      {/* Background with abstract dark glow */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-[#F66B17] opacity-[0.03] blur-[150px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-[#041D2E] opacity-50 blur-[120px] rounded-full pointer-events-none" />
      </div>
      <div className="register-bg-overlay opacity-0 absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')] opacity-[0.02] pointer-events-none mix-blend-overlay" />

      {/* Top Nav */}
      <div className="absolute top-0 inset-x-0 h-24 flex items-center px-8 z-20">
        <button
          onClick={onBackToSite}
          className="text-white/40 hover:text-white transition-colors text-xs font-bold tracking-widest flex items-center gap-2"
        >
          <IconArrowRight className="w-4 h-4 rotate-180" />
          BACK TO SITE
        </button>
      </div>

      {/* Cyber-Chamfered Panel */}
      <div ref={panelRef} className="relative z-10 filter drop-shadow-[0_20px_40px_rgba(0,0,0,0.7)] flex items-center justify-center mx-4 mt-8 mb-8" style={{ minHeight: 600 }}>
        
        {/* Outer Thin Border Layer */}
        <div 
          className="absolute inset-0 bg-white/20 transition-all"
          style={{ clipPath: 'polygon(40px 0, 100% 0, 100% calc(100% - 40px), calc(100% - 40px) 100%, 0 100%, 0 40px)' }}
        />
        
        {/* Inner Dark Glass Layer */}
        <div 
          className="absolute inset-[1px] bg-[#0A1118]/80 backdrop-blur-2xl transition-all"
          style={{ clipPath: 'polygon(39px 0, 100% 0, 100% calc(100% - 39px), calc(100% - 39px) 100%, 0 100%, 0 39px)' }}
        >
           <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none" />
        </div>

        {/* Top Left Glass Accent */}
        <div 
          className="absolute top-[1px] left-[1px] w-[39px] h-[39px] bg-white/5 border-b border-r border-white/10 backdrop-blur-3xl hidden sm:block"
          style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
        />
        {/* Bottom Right Glass Accent */}
        <div 
          className="absolute bottom-[1px] right-[1px] w-[39px] h-[39px] bg-white/5 border-t border-l border-white/10 backdrop-blur-3xl hidden sm:block"
          style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
        />

        {/* --- FORM STATE --- */}
        <div className="register-form-content absolute inset-0 flex flex-col p-10 justify-center">
          <div className="mb-6 text-center">
            <h1 className="text-3xl font-black text-white tracking-tight mb-2">
              Create <span className="text-[#F66B17]">Account</span>
            </h1>
            <p className="text-white/40 text-xs font-medium tracking-wide">
              Join SmartSite to access operational data
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 flex-1 flex flex-col justify-center">
            
            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-white/60 mb-1.5 uppercase tracking-widest">Full Name</label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconUser className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="bg-transparent text-white w-full focus:outline-none text-sm placeholder:text-white/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-white/60 mb-1.5 uppercase tracking-widest">Username</label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconUser className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Choose a username"
                    className="bg-transparent text-white w-full focus:outline-none text-sm placeholder:text-white/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-white/60 mb-1.5 uppercase tracking-widest">Password</label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconKey className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Create a strong password"
                    className="bg-transparent text-white w-full focus:outline-none text-sm placeholder:text-white/20"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-white/60 mb-1.5 uppercase tracking-widest">Confirm Password</label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl px-4 py-3 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconKey className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    className="bg-transparent text-white w-full focus:outline-none text-sm placeholder:text-white/20"
                  />
                </div>
              </div>
            </div>

            {errorMessage && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <IconAlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                <p className="text-red-400 text-xs font-medium">{errorMessage}</p>
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="group relative w-full flex items-center justify-center gap-2 py-4 bg-[#F66B17] hover:bg-[#D94E07] transition-all rounded-xl overflow-hidden active:scale-[0.98] shadow-[0_0_20px_rgba(246,107,23,0.3)]"
              >
                <span className="font-bold text-white tracking-wide text-sm">Create Account</span>
                <IconArrowRight className="w-4 h-4 text-white transition-transform group-hover:translate-x-1" />
              </button>
            </div>

            <div className="text-center mt-2">
              <span className="text-white/40 text-xs font-medium">Already have an account? </span>
              <button 
                type="button" 
                onClick={handleNavigateLogin}
                className="text-[#F66B17] text-xs font-bold hover:text-[#D94E07] transition-colors"
              >
                Sign In
              </button>
            </div>
            
          </form>
        </div>

        {/* --- LOADING STATE --- */}
        <div className="register-loading-content absolute inset-0 hidden flex-col items-center justify-center">
          <div className="relative w-full h-full flex items-center justify-center">
            <div className="absolute w-20 h-20 border border-white/10 rounded-2xl" />
            <div className="absolute w-24 h-24 border border-[#F66B17]/20 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <div className="absolute w-32 h-32 border border-[#F66B17]/10 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ animationDelay: '1s' }} />
            <div className="orb-core relative w-8 h-8 bg-[#F66B17] rounded-full shadow-[0_0_40px_20px_rgba(246,107,23,0.4)] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
