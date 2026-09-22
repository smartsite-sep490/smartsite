import React from 'react';
import { IconAlertTriangle, IconCheck, IconX } from '../icons';

interface DetailItem {
  label: string;
  value: React.ReactNode;
}

interface EventDetailPanelProps {
  title: string;
  eventId: string;
  details: DetailItem[];
  checklistSlot?: React.ReactNode;
  resultStatus: 'success' | 'warning' | 'error' | 'info';
  resultTitle: string;
  resultMessage: string;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  secondaryActionLabel: string;
  onSecondaryAction: () => void;
}

export function EventDetailPanel({
  title,
  eventId,
  details,
  checklistSlot,
  resultStatus,
  resultTitle,
  resultMessage,
  primaryActionLabel,
  onPrimaryAction,
  secondaryActionLabel,
  onSecondaryAction,
}: EventDetailPanelProps) {
  const resultColors = {
    error: 'border-red-500 text-red-500 bg-red-50/50',
    warning: 'border-amber-500 text-amber-600 bg-amber-50/50',
    success: 'border-emerald-500 text-emerald-600 bg-emerald-50/50',
    info: 'border-slate-500 text-slate-600 bg-slate-50',
  };

  return (
    <div className="w-full bg-slate-50 border border-slate-200 p-1.5 rounded-[2rem] shadow-sm">
      <div className="bg-white rounded-[calc(2rem-0.375rem)] shadow-[inset_0_1px_1px_rgba(255,255,255,1)] border border-slate-100 flex flex-col justify-between h-[600px] xl:h-[466px] overflow-hidden">
        
        {/* Scrollable Content Area */}
        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          {/* Header */}
          <div className="flex items-center justify-between pb-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              {title}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 font-mono text-[10px] font-semibold tracking-wider">
              {eventId}
            </span>
          </div>

          {/* 2-Column Details Grid */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {details.map((item, idx) => (
              <div key={idx} className="flex flex-col gap-1">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.1em]">
                  {item.label}
                </p>
                <div className="font-semibold text-slate-900 text-[13px] leading-tight">
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="h-px bg-slate-100 w-full" />

          {/* Optional Checklist / Custom Slot */}
          {checklistSlot && (
            <div>{checklistSlot}</div>
          )}

          {/* Result Alert Box */}
          <div className="pt-2">
            <div className={`border-l-[3px] p-3 rounded-r-lg ${resultColors[resultStatus]}`}>
              <p className="text-[9px] font-bold uppercase tracking-widest opacity-60 mb-1">
                RESULT
              </p>
              <div className="flex items-center gap-1.5 text-xs font-bold mb-1">
                {resultStatus === 'error' && <IconAlertTriangle className="w-3.5 h-3.5" />}
                {resultStatus === 'warning' && <IconAlertTriangle className="w-3.5 h-3.5" />}
                {resultStatus === 'success' && <IconCheck className="w-3.5 h-3.5" />}
                <span className="uppercase tracking-wide">{resultTitle}</span>
              </div>
              <p className="text-xs font-medium opacity-80 leading-relaxed">
                {resultMessage}
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons (Fixed Bottom) */}
        <div className="p-4 bg-white/80 backdrop-blur-md border-t border-slate-100 flex gap-2">
          <button
            onClick={onPrimaryAction}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[#F66B17] hover:bg-[#E05A0B] text-white font-semibold text-sm shadow-[0_2px_10px_rgba(246,107,23,0.3)] transition-all active:scale-[0.98]"
          >
            {primaryActionLabel}
          </button>
          <button
            onClick={onSecondaryAction}
            className="flex-1 py-2.5 px-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-100 transition-all active:scale-[0.98]"
          >
            {secondaryActionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
