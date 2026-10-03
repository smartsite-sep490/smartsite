import React, { useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { useLogin } from './auth-session';
import { IconArrowRight, IconAlertTriangle, IconUser, IconKey } from '../../components/icons';

interface LoginScreenProps {
  onLoginSuccess: () => void;
  onBack: () => void;
  onNavigateToRegister: () => void;
}

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function LoginScreen({ onLoginSuccess, onBack, onNavigateToRegister }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const loginMutation = useLogin(apiUrl);

  useGSAP(
    () => {
      // Start as a small square (solid, no opacity 0, to make morph seamless)
      gsap.set(panelRef.current, { width: 240, height: 240, opacity: 1, scale: 1 });
      gsap.set('.login-form-content', { opacity: 0, scale: 0.95 });
      gsap.set('.login-loading-content', { display: 'none' });

      const tl = gsap.timeline({ delay: 0.01 });
      tl.to(panelRef.current, { width: 440, height: 560, duration: 0.5, ease: 'back.out(1.2)' })
        .to('.login-form-content', {
          opacity: 1,
          scale: 1,
          duration: 0.3
        }, '-=0.1');
    },
    { scope: containerRef }
  );

  const handleNavigateRegister = () => {
    const tl = gsap.timeline();
    tl.to('.login-form-content', { opacity: 0, scale: 0.95, duration: 0.2 })
      .to(panelRef.current, {
        width: 240,
        height: 240,
        duration: 0.4,
        ease: 'back.in(1.2)',
        onComplete: onNavigateToRegister
      }, '-=0.1');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const tl = gsap.timeline();

    // Morph into loading state
    tl.to('.login-form-content', {
      opacity: 0,
      scale: 0.95,
      duration: 0.3,
      onComplete: () => {
        gsap.set('.login-form-content', { display: 'none' });
        gsap.set('.login-loading-content', { display: 'flex' });
      },
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
      .to(
        '.login-loading-content',
        {
          opacity: 1,
          scale: 1,
          duration: 0.4,
          ease: 'power2.out',
        },
        'morph+=0.4'
      );

    loginMutation.mutate(
      { username, password },
      {
        onSuccess: () => {
          gsap.to(panelRef.current, {
            scale: 1.1,
            opacity: 0,
            duration: 0.5,
            ease: 'power3.in',
            onComplete: onLoginSuccess,
            delay: 0.5, // let them see the success glow briefly
          });
          // Turn orb to green/success
          gsap.to('.orb-core', { backgroundColor: '#10B981', boxShadow: '0 0 40px 20px rgba(16,185,129,0.4)' });
        },
        onError: (err: unknown) => {
          let msg = 'An unexpected error occurred.';
          const errorObj = err as { status?: number; message?: string; type?: string };
          if (errorObj?.status === 401) {
            msg = 'Invalid credentials.';
          } else if (errorObj?.status === 429) {
            msg = 'Too many attempts.';
          } else if (errorObj?.message === 'Network Error' || errorObj?.type === 'network') {
            msg = 'Connection failed.';
          }

          setErrorMessage(msg);

          // Shake effect on error
          gsap.fromTo(panelRef.current,
            { x: -10 },
            { x: 0, duration: 0.4, ease: "elastic.out(2, 0.2)" }
          );

          // Revert back to form
          const revertTl = gsap.timeline({ delay: 0.5 });
          revertTl
            .to('.login-loading-content', {
              opacity: 0,
              scale: 0.9,
              duration: 0.3,
              onComplete: () => {
                gsap.set('.login-loading-content', { display: 'none' });
                gsap.set('.login-form-content', { display: 'flex' });
              },
            })
            .to(
              panelRef.current,
              {
                width: 440,
                height: 560,
                duration: 0.5,
                ease: 'back.out(1.2)',
              },
              'revert'
            )
            .to(
              '.login-form-content',
              {
                opacity: 1,
                scale: 1,
                duration: 0.4,
              },
              'revert+=0.2'
            );
        },
      }
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#020810]"
      style={{ perspective: 1200 }}
    >
      {/* Background with abstract dark glow */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Subtle orange/navy radial glows mimicking the reference's sleek background */}
        <div className="absolute top-[-20%] left-[-10%] w-[70%] h-[70%] bg-[#F66B17] opacity-[0.03] blur-[150px] rounded-full pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] bg-[#041D2E] opacity-50 blur-[120px] rounded-full pointer-events-none" />
      </div>

      <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.8%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E')] opacity-[0.02] pointer-events-none mix-blend-overlay" />

      {/* Top Nav */}
      <div className="absolute top-0 inset-x-0 h-24 flex items-center px-8 z-20">
        <button
          onClick={onBack}
          className="text-white/40 hover:text-white transition-colors text-xs font-bold tracking-widest flex items-center gap-2"
        >
          <IconArrowRight className="w-4 h-4 rotate-180" />
          BACK TO SITE
        </button>
      </div>

      {/* Cyber-Chamfered Panel */}
      <div ref={panelRef} className="relative z-10 filter drop-shadow-[0_20px_40px_rgba(0,0,0,0.7)] flex items-center justify-center mx-4">

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
        <div className="login-form-content absolute inset-0 flex flex-col p-10 justify-center">
          <div className="mb-8">
            <h1 className="text-3xl font-black text-white tracking-tight mb-2">
              Welcome <span className="text-[#F66B17]">Back</span>
            </h1>
            <p className="text-white/40 text-xs font-medium tracking-wide">
              Enter your credentials to access your secure account
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5 flex-1 flex flex-col justify-center">

            <div className="space-y-4">
              {/* Username Input */}
              <div>
                <label className="block text-[11px] font-bold text-white/60 mb-2 uppercase tracking-widest">Username</label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl px-4 py-3.5 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconUser className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="bg-transparent text-white w-full !outline-none focus:outline-none focus-visible:!outline-none text-sm placeholder:text-white/20"
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <label className="block text-[11px] font-bold text-white/60 mb-2 uppercase tracking-widest">Password</label>
                <div className="relative flex items-center bg-black/40 border border-white/10 rounded-xl pl-4 pr-3 py-3.5 focus-within:border-[#F66B17]/60 transition-colors">
                  <IconKey className="w-4 h-4 text-white/30 mr-3 shrink-0" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="bg-transparent text-white w-full pr-8 !outline-none focus:outline-none focus-visible:!outline-none text-sm placeholder:text-white/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors focus:outline-none cursor-pointer"
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
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
                className="group relative w-full flex items-center justify-center gap-2 py-4 bg-[#F66B17] hover:bg-[#D94E07] transition-all rounded-xl overflow-hidden active:scale-[0.98] shadow-[0_0_20px_rgba(246,107,23,0.3)]"
              >
                <span className="font-bold text-white tracking-wide text-sm">Sign In</span>
                <IconArrowRight className="w-4 h-4 text-white transition-transform group-hover:translate-x-1" />
              </button>
            </div>

            <div className="text-center mt-2">
              <span className="text-white/40 text-xs font-medium">Don't have an account? </span>
              <button
                type="button"
                onClick={handleNavigateRegister}
                className="text-[#F66B17] text-xs font-bold hover:text-[#D94E07] transition-colors"
              >
                Sign Up
              </button>
            </div>

          </form>
        </div>

        {/* --- LOADING STATE --- */}
        <div className="login-loading-content absolute inset-0 flex items-center justify-center">
          <div className="relative w-full h-full flex items-center justify-center">
            {/* The wireframe square inside the orb container */}
            <div className="absolute w-20 h-20 border border-white/10 rounded-2xl" />

            {/* Outer animated rings */}
            <div className="absolute w-24 h-24 border border-[#F66B17]/20 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <div className="absolute w-32 h-32 border border-[#F66B17]/10 rounded-full animate-[ping_3s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ animationDelay: '1s' }} />

            {/* The glowing orb */}
            <div className="orb-core relative w-8 h-8 bg-[#F66B17] rounded-full shadow-[0_0_40px_20px_rgba(246,107,23,0.4)] animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
