import React from 'react';

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
}

export function Alert({
  variant = 'default',
  className = '',
  children,
  ...props
}: AlertProps) {
  const variantStyles = {
    default:
      'bg-white text-slate-900 border-slate-200/90 shadow-xs',
    success:
      'bg-gradient-to-r from-emerald-500/10 via-emerald-50/50 to-white text-slate-900 border-emerald-400/40 ring-1 ring-emerald-400/15 shadow-xs [&>svg]:text-emerald-600',
    warning:
      'bg-gradient-to-r from-amber-500/10 via-amber-50/50 to-white text-slate-900 border-amber-400/40 ring-1 ring-amber-400/15 shadow-xs [&>svg]:text-amber-600',
    destructive:
      'bg-gradient-to-r from-rose-500/10 via-rose-50/50 to-white text-slate-900 border-rose-400/40 ring-1 ring-rose-400/15 shadow-xs [&>svg]:text-rose-600',
    info:
      'bg-gradient-to-r from-blue-500/10 via-blue-50/50 to-white text-slate-900 border-blue-400/40 ring-1 ring-blue-400/15 shadow-xs [&>svg]:text-blue-600',
  };

  return (
    <div
      role="alert"
      className={`relative w-full rounded-2xl border p-4 text-sm transition-all [&>svg~*]:pl-9 [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4.5 ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function AlertTitle({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      className={`mb-1 font-bold text-xs tracking-tight text-[#071A2B] ${className}`}
      {...props}
    >
      {children}
    </h5>
  );
}

export function AlertDescription({
  className = '',
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div
      className={`text-xs text-slate-700 font-medium leading-relaxed ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
