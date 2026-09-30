import React from 'react';

export const DoubleBezelCard = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
  <div className={`p-1.5 bg-slate-50 ring-1 ring-slate-100 rounded-[2rem] ${className}`}>
    <div className="bg-white rounded-[1.625rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/50 relative overflow-hidden">
      {children}
    </div>
  </div>
);

export const PillButton = ({ children, onClick, variant = 'primary', disabled = false, type = 'button' }: { children: React.ReactNode, onClick?: () => void, variant?: 'primary' | 'secondary' | 'danger' | 'success', disabled?: boolean, type?: 'button'|'submit'|'reset' }) => {
  const base = "group relative flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold text-sm transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none active:scale-[0.98]";
  const variants = {
    primary: "bg-[#0A1118] text-white hover:bg-[#1A2333] shadow-[0_4px_20px_rgba(10,17,24,0.15)]",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    success: "bg-green-50 text-green-700 hover:bg-green-100"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed active:scale-100' : ''}`}>
      {children}
    </button>
  );
};

export const Modal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-300">
        <div className="flex justify-between items-center p-6 border-b border-slate-100">
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  );
};
