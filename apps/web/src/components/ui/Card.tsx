import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  doubleBezel?: boolean;
}

export function Card({
  children,
  doubleBezel = false,
  className = '',
  ...props
}: CardProps) {
  if (doubleBezel) {
    return (
      <div className="p-1 rounded-2xl bg-slate-100/80 border border-slate-200/90 shadow-xs">
        <div
          className={`bg-white rounded-xl border border-slate-200/60 p-5 ${className}`}
          {...props}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
  className = '',
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between pb-3 border-b border-slate-100 ${className}`}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-center text-slate-700 shrink-0">
            {icon}
          </div>
        )}
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 leading-tight">
            {title}
          </h3>
          {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}
