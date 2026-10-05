import React from 'react';
import { IconLoader } from '../icons';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = 'default',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      className = '',
      disabled,
      type = 'button',
      ...props
    },
    ref,
  ) => {
    // Base styles: tactile push, transition, typography, border
    const baseStyles =
      'inline-flex items-center justify-center font-bold transition-all duration-200 ease-out outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none active:scale-[0.98] select-none cursor-pointer';

    // Variant styles
    const variantStyles = {
      default:
        'bg-[#071A2B] text-white hover:bg-[#0E2841] focus-visible:ring-[#071A2B]/20 shadow-xs',
      primary:
        'bg-[#F66B17] text-white hover:bg-[#E05A0A] focus-visible:ring-[#F66B17]/20 shadow-xs',
      secondary:
        'bg-slate-100 text-slate-800 hover:bg-slate-200/80 focus-visible:ring-slate-300',
      outline:
        'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 focus-visible:ring-slate-200 shadow-xs',
      ghost:
        'bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-slate-200',
      destructive:
        'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500/20 shadow-xs',
    };

    // Size styles
    const sizeStyles = {
      sm: 'text-[11px] px-2.5 py-1.5 rounded-lg gap-1.5',
      md: 'text-xs px-3.5 py-2 rounded-xl gap-2',
      lg: 'text-sm px-4.5 py-2.5 rounded-xl gap-2.5',
      icon: 'w-8 h-8 rounded-lg p-0',
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <IconLoader className="w-3.5 h-3.5 animate-spin shrink-0" />
        ) : (
          leftIcon && <span className="shrink-0">{leftIcon}</span>
        )}
        {children && <span>{children}</span>}
        {!isLoading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
      </button>
    );
  },
);

Button.displayName = 'Button';
