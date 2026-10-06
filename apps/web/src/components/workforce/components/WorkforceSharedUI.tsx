import React from 'react';
import type { SchedulingRequestStatus } from '@smartsite/api-client';

export const SmartCard = ({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) => (
  <div
    onClick={onClick}
    className={`p-1.5 bg-[#F8FAFC] border border-slate-200/60 rounded-[2rem] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] ${onClick ? 'cursor-pointer active:scale-[0.99] hover:bg-slate-100 hover:shadow-sm' : ''} ${className}`}
  >
    <div className="bg-white rounded-[calc(2rem-0.375rem)] border border-slate-100 shadow-[inset_0_1px_1px_rgba(255,255,255,1),_0_2px_10px_rgba(7,26,43,0.02)] h-full w-full p-8 relative overflow-hidden">
      {children}
    </div>
  </div>
);

// Backward-compatible alias for existing imports
export const DoubleBezelCard = SmartCard;

export const PillButton = ({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  type = 'button',
  icon,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'outline';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  icon?: React.ReactNode;
  className?: string;
}) => {
  const base =
    'group inline-flex items-center justify-center gap-3 pl-6 pr-2 py-1.5 rounded-full font-bold text-[13px] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] outline-none active:scale-[0.98] whitespace-nowrap cursor-pointer tracking-wide';

  const variants = {
    primary: 'bg-[#0A0A0A] text-white hover:bg-[#1A1A1A] shadow-sm',
    secondary: 'bg-[#F1F5F9] text-slate-700 hover:bg-[#E2E8F0] border border-slate-200/60',
    outline: 'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 shadow-sm',
    danger: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-100',
    success: 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-sm',
  };

  const iconWrappers = {
    primary: 'bg-white/10 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)]',
    secondary: 'bg-white text-slate-700 shadow-sm border border-slate-100',
    outline: 'bg-slate-100 text-slate-700 border border-slate-200/50',
    danger: 'bg-white text-red-600 shadow-sm',
    success: 'bg-white/20 text-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${disabled ? 'opacity-50 cursor-not-allowed active:scale-100' : ''} ${!icon ? '!pr-6' : ''} ${className}`}
    >
      <span>{children}</span>
      {icon && (
        <span className={`w-8 h-8 flex items-center justify-center rounded-full transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-[2px] group-hover:scale-[1.03] ${iconWrappers[variant]}`}>
          {icon}
        </span>
      )}
    </button>
  );
};

export const SmartButton = ({
  children,
  onClick,
  variant = 'default',
  size = 'default',
  disabled = false,
  type = 'button',
  title,
  className = '',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'success';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  className?: string;
}) => {
  const base =
    'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer shadow-sm';

  const variants = {
    default: 'bg-[#0F172A] text-white hover:bg-[#0F172A]/90',
    destructive: 'bg-red-500 text-white hover:bg-red-500/90',
    outline: 'border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900',
    secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-100/80',
    ghost: 'hover:bg-slate-100 hover:text-slate-900 shadow-none',
    success: 'bg-[#10B981] text-white hover:bg-[#059669]',
  };

  const sizes = {
    default: 'h-10 px-4 py-2',
    sm: 'h-9 rounded-md px-3',
    lg: 'h-11 rounded-md px-8',
    icon: 'h-10 w-10',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  );
};

export const LabelBadge = ({ children, dotColor, className = '' }: { children: React.ReactNode; dotColor?: string; className?: string }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-white border border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.02)] text-slate-600 ${className}`}>
    {dotColor && <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${dotColor}`} />}
    {children}
  </span>
);

export const StatusBadge = ({ status }: { status: SchedulingRequestStatus | string }) => {
  const styles: Record<string, { dot: string; label: string }> = {
    PENDING_COWORKER: { dot: 'bg-amber-400', label: 'Pending Coworker' },
    PENDING_MANAGER: { dot: 'bg-amber-400', label: 'Pending Contractor Review' },
    APPROVED: { dot: 'bg-emerald-500', label: 'Approved' },
    APPLIED: { dot: 'bg-emerald-500', label: 'Applied' },
    REJECTED: { dot: 'bg-red-500', label: 'Rejected' },
    CANCELLED: { dot: 'bg-slate-400', label: 'Cancelled' },
    EXPIRED: { dot: 'bg-slate-400', label: 'Expired' },
    DRAFT: { dot: 'bg-slate-400', label: 'Draft' },
  };

  const current = styles[status] || { dot: 'bg-slate-400', label: status.replace('_', ' ') };
  return <LabelBadge dotColor={current.dot}>{current.label}</LabelBadge>;
};

export const Modal = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-[#0A0A0A]/40 backdrop-blur-xl transition-opacity animate-in fade-in duration-700 ease-[cubic-bezier(0.32,0.72,0,1)]" onClick={onClose} />
      <div className="relative bg-white/95 rounded-[2rem] shadow-2xl w-full max-w-xl overflow-hidden border border-white/20 animate-in fade-in slide-in-from-bottom-8 zoom-in-95 duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] z-10 backdrop-blur-2xl">
        <div className="flex justify-between items-start p-8 border-b border-slate-100 bg-white/50">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">{title}</h2>
            {subtitle && <p className="text-sm font-medium text-slate-500 mt-2">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center bg-slate-100/50 hover:bg-slate-200/50 rounded-full transition-all duration-500 text-slate-500 hover:text-slate-900 cursor-pointer active:scale-95"
            aria-label="Close modal"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-8 bg-white/80">{children}</div>
      </div>
    </div>
  );
};
