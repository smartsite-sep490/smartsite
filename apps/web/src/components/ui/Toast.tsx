import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconAlertCircle, IconCheck, IconX } from '../icons';

export interface ToastMessage {
  id?: string;
  message: string;
  type?: 'success' | 'error' | 'info';
}

export interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  onClose: () => void;
}

export function Toast({ message, type = 'success', onClose }: ToastProps) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="pointer-events-auto relative overflow-hidden rounded-2xl bg-[#071A2B]/95 backdrop-blur-xl border border-white/15 p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35),0_0_0_1px_rgba(16,185,129,0.25)] text-white transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in slide-in-from-top-4 fade-in"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-lg text-white flex items-center justify-center shrink-0 ${
              type === 'success'
                ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                : 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
            }`}
          >
            {type === 'success' ? (
              <IconCheck className="w-4 h-4 text-white" />
            ) : (
              <IconAlertCircle className="w-4 h-4 text-white" />
            )}
          </div>
          <span className="text-xs font-semibold text-slate-100">{message}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="text-slate-400 hover:text-white rounded-lg p-1 transition-colors cursor-pointer"
        >
          <IconX className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function ToastContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed top-5 right-5 z-50 flex flex-col gap-3 pointer-events-none max-w-sm sm:max-w-md w-[calc(100vw-2.5rem)]">
      {children}
    </div>
  );
}
