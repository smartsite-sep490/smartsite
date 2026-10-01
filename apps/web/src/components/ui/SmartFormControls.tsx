/* eslint-disable react-refresh/only-export-components */
/**
 * SmartFormControls — Premium form primitives for SmartSite
 * Built on Radix UI Popover + react-day-picker + date-fns
 * Design language: Soft Structuralism, #071A2B palette
 */

import React, { useState, useId } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { format, parse, isValid } from 'date-fns';
import 'react-day-picker/style.css';

// ── Shared field base class ────────────────────────────────────────────────────
const FIELD_BASE =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#DCE6EF] bg-[#F9FAFC] text-sm font-semibold text-[#071A2B] placeholder-[#94A3B8] outline-none transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] hover:border-[#B0C4D8] focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/8 shadow-[inset_0_1px_2px_rgba(7,26,43,0.04)]';

// ── SmartInput ────────────────────────────────────────────────────────────────
export interface SmartInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  fieldRequired?: boolean;
  error?: string;
}

export const SmartInput = React.forwardRef<HTMLInputElement, SmartInputProps>(
  ({ label, fieldRequired, error, className = '', id: propId, type, ...props }, ref) => {
    const fallbackId = useId();
    const id = propId ?? fallbackId;
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';
    const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
            {label}
            {fieldRequired && <span className="text-red-400 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          <input
            id={id}
            ref={ref}
            type={inputType}
            className={`${FIELD_BASE} ${isPassword ? 'pr-10' : ''} ${error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''} ${className}`}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#94A3B8] hover:text-[#071A2B] transition-colors focus:outline-none"
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
          )}
        </div>
        {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
      </div>
    );
  }
);
SmartInput.displayName = 'SmartInput';

// ── SmartSelect ───────────────────────────────────────────────────────────────
export interface SmartSelectOption {
  value: string;
  label: string;
}
export interface SmartSelectProps {
  label?: string;
  fieldRequired?: boolean;
  error?: string;
  placeholder?: string;
  options: SmartSelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
}

export function SmartSelect({ label, fieldRequired, error, placeholder, options, value, onChange, className = '', id: propId, name, required }: SmartSelectProps) {
  const fallbackId = useId();
  const id = propId ?? fallbackId;
  const [open, setOpen] = useState(false);

  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
          {label}
          {fieldRequired && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      {name && (
        <input type="hidden" name={name} value={value || ''} required={required} />
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={`${FIELD_BASE} flex items-center justify-between text-left cursor-pointer w-full ${
              error ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''
            } ${!selectedOption ? 'text-[#94A3B8] font-normal' : ''} ${className}`}
          >
            <span className="truncate pr-4">
              {selectedOption ? selectedOption.label : placeholder || 'Select an option'}
            </span>
            <IconChevDown open={open} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            className="z-50 w-[var(--radix-popover-trigger-width)] max-h-[300px] overflow-y-auto"
            style={{ outline: 'none' }}
          >
            <div className="bg-white rounded-xl border border-[#DCE6EF] shadow-[0_16px_48px_rgba(7,26,43,0.14)] overflow-hidden flex flex-col p-1">
              {options.length === 0 ? (
                <div className="p-3 text-xs text-[#94A3B8] text-center">No options available</div>
              ) : (
                options.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      onChange?.(opt.value);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors cursor-pointer ${
                      value === opt.value
                        ? 'bg-[#071A2B] text-white font-bold'
                        : 'text-[#071A2B] hover:bg-[#F5F8FB] font-medium'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  );
}

// ── SmartCheckbox ─────────────────────────────────────────────────────────────
export interface SmartCheckboxProps {
  id?: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

export function SmartCheckbox({ id: propId, label, checked, onChange, description }: SmartCheckboxProps) {
  const fallbackId = useId();
  const id = propId ?? fallbackId;
  return (
    <label htmlFor={id} className="group flex items-start gap-3 cursor-pointer select-none">
      <div className="relative mt-0.5 shrink-0">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <div
          onClick={() => onChange(!checked)}
          className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
            checked
              ? 'bg-[#071A2B] border-[#071A2B] shadow-[0_2px_8px_rgba(7,26,43,0.25)]'
              : 'bg-white border-[#DCE6EF] group-hover:border-[#607A96]'
          }`}
        >
          {checked && (
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
              <path d="M1 4L4.2 7.5L10 1" stroke="white" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>
      <div>
        <span className="text-xs font-semibold text-[#071A2B] leading-none">{label}</span>
        {description && <p className="text-[11px] text-[#607A96] mt-0.5">{description}</p>}
      </div>
    </label>
  );
}

// ── react-day-picker custom classNames ────────────────────────────────────────
const rdpClassNames: Partial<Record<string, string>> = {
  root: 'p-2',
  months: 'flex flex-col gap-2',
  month: 'space-y-1.5',
  month_caption: 'flex items-center justify-between px-1',
  caption_label: 'text-sm font-bold text-[#071A2B]',
  nav: 'flex items-center gap-1',
  button_previous:
    'p-1.5 rounded-lg hover:bg-[#F5F8FB] text-[#607A96] transition-colors cursor-pointer border border-transparent hover:border-[#DCE6EF]',
  button_next:
    'p-1.5 rounded-lg hover:bg-[#F5F8FB] text-[#607A96] transition-colors cursor-pointer border border-transparent hover:border-[#DCE6EF]',
  weeks: 'mt-0',
  weekdays: 'grid grid-cols-7 mb-0.5',
  weekday: 'text-[10px] font-bold text-[#94A3B8] text-center uppercase py-0.5',
  week: 'grid grid-cols-7 gap-0',
  day: 'h-7 w-8 flex items-center justify-center rounded-lg text-sm font-medium text-[#071A2B] cursor-pointer transition-all duration-200 hover:bg-[#F5F8FB] mx-auto aria-selected:bg-[#071A2B] aria-selected:text-white',
  day_button:
    'h-7 w-8 flex items-center justify-center rounded-lg text-sm font-medium text-inherit cursor-pointer transition-all duration-200 hover:bg-[#F5F8FB] hover:text-[#071A2B]',
  selected: 'bg-[#071A2B] !text-white rounded-lg shadow-[0_2px_8px_rgba(7,26,43,0.25)] [&_button]:!text-white',
  today: 'font-black text-[#F66B17]',
  outside: 'text-[#94A3B8] opacity-40',
  disabled: 'opacity-25 cursor-not-allowed',
  hidden: 'invisible',
};

// ── Inline Mini Icons ─────────────────────────────────────────────────────────
function IconCalSm({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 shrink-0 ${className}`} viewBox="0 0 16 16" fill="none">
      <rect x="1.5" y="2.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.25" />
      <path d="M1.5 6.5h13" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M5 1.5v2M11 1.5v2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <circle cx="5.5" cy="10" r="0.8" fill="currentColor" />
      <circle cx="8" cy="10" r="0.8" fill="currentColor" />
      <circle cx="10.5" cy="10" r="0.8" fill="currentColor" />
    </svg>
  );
}
function IconChevDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 shrink-0 text-[#607A96] transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
      viewBox="0 0 14 14"
      fill="none"
    >
      <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconClockSm({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 shrink-0 ${className}`} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── SmartDatePicker (date only) ───────────────────────────────────────────────
export interface SmartDatePickerProps {
  label?: string;
  fieldRequired?: boolean;
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  id?: string;
}

export function SmartDatePicker({
  label,
  fieldRequired,
  value,
  onChange,
  placeholder = 'Pick a date',
  error,
  id: propId,
}: SmartDatePickerProps) {
  const fallbackId = useId();
  const id = propId ?? fallbackId;
  const [open, setOpen] = useState(false);

  const parsed = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined;
  const validDate = parsed && isValid(parsed) ? parsed : undefined;
  const displayValue = validDate ? format(validDate, 'dd MMM yyyy') : '';

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      onChange(format(day, 'yyyy-MM-dd'));
      setOpen(false);
    }
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
          {label}
          {fieldRequired && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={`${FIELD_BASE} flex items-center justify-between text-left cursor-pointer ${
              error ? 'border-red-300' : ''
            } ${!displayValue ? 'text-[#94A3B8] font-normal' : ''}`}
          >
            <span className="flex items-center gap-2">
              <IconCalSm />
              {displayValue || placeholder}
            </span>
            <IconChevDown open={open} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            className="z-50 w-auto max-w-[calc(100vw-24px)]"
            style={{ outline: 'none' }}
          >
            <div className="bg-white rounded-2xl border border-[#DCE6EF] shadow-[0_16px_48px_rgba(7,26,43,0.14)] overflow-hidden">
              <DayPicker
                mode="single"
                selected={validDate}
                onSelect={handleSelect}
                classNames={rdpClassNames as Parameters<typeof DayPicker>[0]['classNames']}
              />
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  );
}

// ── SmartDateTimePicker ───────────────────────────────────────────────────────
// ── Time Helpers for Shadcn Luxury Time Selector ──────────────────────────────
export function parseHHMM(timeStr: string) {
  const defaultRes = { hour12: 8, minute: 0, period: 'AM' as const };
  if (!timeStr) return defaultRes;
  const parts = timeStr.split(':');
  if (parts.length < 2) return defaultRes;
  let hh = parseInt(parts[0] ?? '8', 10);
  let mm = parseInt(parts[1] ?? '0', 10);
  if (isNaN(hh)) hh = 8;
  if (isNaN(mm)) mm = 0;

  const period: 'AM' | 'PM' = hh >= 12 ? 'PM' : 'AM';
  let hour12 = hh % 12;
  if (hour12 === 0) hour12 = 12;

  return { hour12, minute: mm, period };
}

export function format24h(hour12: number, minute: number, period: 'AM' | 'PM') {
  let hh = hour12;
  if (period === 'PM' && hour12 < 12) {
    hh = hour12 + 12;
  } else if (period === 'AM' && hour12 === 12) {
    hh = 0;
  }
  const hhStr = String(hh).padStart(2, '0');
  const mmStr = String(minute).padStart(2, '0');
  return `${hhStr}:${mmStr}`;
}

export function formatDisplayTime(timeStr: string) {
  const { hour12, minute, period } = parseHHMM(timeStr);
  const hStr = String(hour12).padStart(2, '0');
  const mStr = String(minute).padStart(2, '0');
  return `${hStr}:${mStr} ${period}`;
}

// ── LuxuryTimeSelector (Interactive 3-Column Shadcn Time Selector) ────────────
export interface LuxuryTimeSelectorProps {
  timeStr: string; // "HH:mm"
  onChange: (newTimeStr: string) => void;
}

export function LuxuryTimeSelector({ timeStr, onChange }: LuxuryTimeSelectorProps) {
  const { hour12, minute, period } = parseHHMM(timeStr);

  const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const minutesList = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  const handleHourSelect = (h: number) => {
    onChange(format24h(h, minute, period));
  };

  const handleMinuteSelect = (m: number) => {
    onChange(format24h(hour12, m, period));
  };

  const handlePeriodSelect = (p: 'AM' | 'PM') => {
    onChange(format24h(hour12, minute, p));
  };

  const presets = [
    { label: '08:00 AM', val: '08:00' },
    { label: '12:00 PM', val: '12:00' },
    { label: '04:00 PM', val: '16:00' },
    { label: '08:00 PM', val: '20:00' },
  ];

  return (
    <div className="p-3 bg-white rounded-2xl border border-[#DCE6EF] shadow-[0_16px_48px_rgba(7,26,43,0.14)] min-w-[270px]">
      {/* Presets Header */}
      <div className="pb-2.5 mb-2.5 border-b border-[#F5F8FB] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
            Select Time
          </span>
          <span className="text-xs font-mono font-bold text-[#071A2B] bg-[#F5F8FB] px-2 py-0.5 rounded-md border border-[#DCE6EF]/60">
            {formatDisplayTime(timeStr)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {presets.map((p) => (
            <button
              key={p.val}
              type="button"
              onClick={() => onChange(p.val)}
              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                timeStr === p.val
                  ? 'bg-[#071A2B] text-white'
                  : 'bg-[#F5F8FB] text-[#607A96] hover:bg-[#EBF1F6] hover:text-[#071A2B]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3 Columns Layout: Hours | Minutes | AM/PM */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {/* Hours Column */}
        <div className="space-y-1">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
            Hour
          </span>
          <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1 pr-0.5">
            {hoursList.map((h) => {
              const isSelected = hour12 === h;
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => handleHourSelect(h)}
                  className={`w-full py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#071A2B] text-white shadow-xs'
                      : 'text-[#071A2B] hover:bg-[#F5F8FB]'
                  }`}
                >
                  {String(h).padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>

        {/* Minutes Column */}
        <div className="space-y-1">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
            Minute
          </span>
          <div className="max-h-36 overflow-y-auto custom-scrollbar space-y-1 pr-0.5">
            {minutesList.map((m) => {
              const isSelected = Math.abs(minute - m) < 3 || (m === 55 && minute >= 53);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleMinuteSelect(m)}
                  className={`w-full py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#071A2B] text-white shadow-xs'
                      : 'text-[#071A2B] hover:bg-[#F5F8FB]'
                  }`}
                >
                  {String(m).padStart(2, '0')}
                </button>
              );
            })}
          </div>
        </div>

        {/* Period Column */}
        <div className="space-y-1">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-[#94A3B8]">
            Period
          </span>
          <div className="flex flex-col gap-1.5 pt-1">
            {(['AM', 'PM'] as const).map((p) => {
              const isSelected = period === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePeriodSelect(p)}
                  className={`w-full py-2 rounded-lg text-xs font-black tracking-wider transition-all cursor-pointer uppercase ${
                    isSelected
                      ? 'bg-[#F66B17] text-white shadow-xs'
                      : 'bg-[#F5F8FB] text-[#607A96] hover:bg-[#EBF1F6] hover:text-[#071A2B]'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SmartTimePicker (Standalone Time Picker Field) ─────────────────────────────
export interface SmartTimePickerProps {
  label?: string;
  fieldRequired?: boolean;
  value: string; // "HH:mm" e.g., "08:00"
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  id?: string;
  className?: string;
}

export function SmartTimePicker({
  label,
  fieldRequired,
  value,
  onChange,
  placeholder = 'Select time',
  error,
  id: propId,
  className = '',
}: SmartTimePickerProps) {
  const fallbackId = useId();
  const id = propId ?? fallbackId;
  const [open, setOpen] = useState(false);

  const displayVal = value ? formatDisplayTime(value) : '';

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
          {label}
          {fieldRequired && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={`${FIELD_BASE} flex items-center justify-between text-left cursor-pointer ${
              error ? 'border-red-300' : ''
            } ${!displayVal ? 'text-[#94A3B8] font-normal' : ''} ${className}`}
          >
            <span className="flex items-center gap-2">
              <IconClockSm className="text-[#607A96]" />
              {displayVal || placeholder}
            </span>
            <IconChevDown open={open} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            className="z-50 w-auto"
            style={{ outline: 'none' }}
          >
            <LuxuryTimeSelector
              timeStr={value || '08:00'}
              onChange={(newTime) => {
                onChange(newTime);
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  );
}

// ── SmartDateTimePicker ───────────────────────────────────────────────────────
export interface SmartDateTimePickerProps {
  label?: string;
  fieldRequired?: boolean;
  value: string; // "YYYY-MM-DDTHH:mm:ss" or similar
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  id?: string;
}

export function SmartDateTimePicker({
  label,
  fieldRequired,
  value,
  onChange,
  placeholder = 'Pick date & time',
  error,
  id: propId,
}: SmartDateTimePickerProps) {
  const fallbackId = useId();
  const id = propId ?? fallbackId;
  const [open, setOpen] = useState(false);

  const parsed = value ? new Date(value) : undefined;
  const validParsed = parsed && isValid(parsed) ? parsed : undefined;

  const [timeStr, setTimeStr] = useState<string>(() => {
    if (validParsed) return format(validParsed, 'HH:mm');
    return '08:00';
  });

  const displayValue = validParsed ? `${format(validParsed, 'dd MMM yyyy')}, ${formatDisplayTime(timeStr)}` : '';

  const selectedDay = validParsed
    ? new Date(validParsed.getFullYear(), validParsed.getMonth(), validParsed.getDate())
    : undefined;

  const handleSelectDay = (day: Date | undefined) => {
    if (!day) return;
    const parts = timeStr.split(':').map(Number);
    const hh = parts[0] ?? 0;
    const mm = parts[1] ?? 0;
    const combined = new Date(day);
    combined.setHours(hh, mm, 0, 0);
    onChange(format(combined, "yyyy-MM-dd'T'HH:mm:ss"));
  };

  const handleTimeChange = (newTime: string) => {
    setTimeStr(newTime);
    if (validParsed) {
      const parts = newTime.split(':').map(Number);
      const hh = parts[0] ?? 0;
      const mm = parts[1] ?? 0;
      const combined = new Date(validParsed);
      combined.setHours(hh, mm, 0, 0);
      onChange(format(combined, "yyyy-MM-dd'T'HH:mm:ss"));
    }
  };

  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-[10px] font-bold uppercase tracking-[0.18em] text-[#607A96]">
          {label}
          {fieldRequired && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={`${FIELD_BASE} flex items-center justify-between text-left cursor-pointer ${
              error ? 'border-red-300' : ''
            } ${!displayValue ? 'text-[#94A3B8] font-normal' : ''}`}
          >
            <span className="flex items-center gap-2">
              <IconCalSm />
              {displayValue || placeholder}
            </span>
            <IconChevDown open={open} />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="bottom"
            sideOffset={8}
            align="start"
            collisionPadding={12}
            className="z-50 w-auto max-w-[calc(100vw-24px)]"
            style={{ outline: 'none' }}
          >
            <div className="bg-white rounded-2xl border border-[#DCE6EF] shadow-[0_16px_48px_rgba(7,26,43,0.14)] overflow-hidden p-1">
              <DayPicker
                mode="single"
                selected={selectedDay}
                onSelect={handleSelectDay}
                classNames={rdpClassNames as Parameters<typeof DayPicker>[0]['classNames']}
              />
              {/* Luxury Time row */}
              <div className="border-t border-[#F5F8FB] pt-2 px-1 pb-1 bg-[#F9FAFC] rounded-b-xl">
                <LuxuryTimeSelector
                  timeStr={timeStr}
                  onChange={handleTimeChange}
                />
              </div>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="text-[11px] text-red-500 font-medium">{error}</p>}
    </div>
  );
}
