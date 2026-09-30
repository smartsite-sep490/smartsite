import React from 'react';
import { IconAlertTriangle, IconCheck } from '../icons';

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
    error: 'border-[#9F2F2D] text-[#9F2F2D] bg-[#FDEBEC]/50',
    warning: 'border-[#956400] text-[#956400] bg-[#FBF3DB]/50',
    success: 'border-[#346538] text-[#346538] bg-[#EDF3EC]/50',
    info: 'border-[#6B6B6B] text-[#6B6B6B] bg-[#F7F6F3]',
  };

  return (
    <div className="w-full bg-white border border-[#EAEAEA] rounded-lg flex flex-col justify-between h-[600px] xl:h-[466px] overflow-hidden">
      {/* Scrollable Content Area */}
      <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-2">
          <span className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest">
            {title}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-[#F7F6F3] text-[#6B6B6B] font-mono text-[10px] font-semibold tracking-wider">
            {eventId}
          </span>
        </div>

        {/* 2-Column Details Grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          {details.map((item, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <p className="text-[10px] font-bold text-[#6B6B6B] uppercase tracking-[0.1em]">
                {item.label}
              </p>
              <div className="font-semibold text-[#2F3437] text-[13px] leading-tight">
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className="h-px bg-[#EAEAEA] w-full" />

        {/* Optional Checklist / Custom Slot */}
        {checklistSlot && <div>{checklistSlot}</div>}

        {/* Result Alert Box */}
        <div className="pt-2">
          <div className={`border-l-[3px] p-3 rounded-r-md ${resultColors[resultStatus]}`}>
            <p className="text-[9px] font-bold uppercase tracking-widest mb-1">RESULT</p>
            <div className="flex items-center gap-1.5 text-xs font-bold mb-1">
              {resultStatus === 'error' && <IconAlertTriangle className="w-3.5 h-3.5" />}
              {resultStatus === 'warning' && <IconAlertTriangle className="w-3.5 h-3.5" />}
              {resultStatus === 'success' && <IconCheck className="w-3.5 h-3.5" />}
              <span className="uppercase tracking-wide">{resultTitle}</span>
            </div>
            <p className="text-xs font-medium leading-relaxed">{resultMessage}</p>
          </div>
        </div>
      </div>

      {/* Action Buttons (Fixed Bottom) */}
      <div className="p-4 bg-white border-t border-[#EAEAEA] flex gap-2">
        <button
          onClick={onPrimaryAction}
          className="flex-1 py-2.5 px-4 rounded-md bg-[#111111] hover:bg-[#333333] text-white font-semibold text-sm transition-all active:scale-[0.98]"
        >
          {primaryActionLabel}
        </button>
        <button
          onClick={onSecondaryAction}
          className="flex-1 py-2.5 px-4 rounded-md bg-[#FBFBFA] border border-[#EAEAEA] text-[#2F3437] font-semibold text-sm hover:bg-[#F7F6F3] transition-all active:scale-[0.98]"
        >
          {secondaryActionLabel}
        </button>
      </div>
    </div>
  );
}
