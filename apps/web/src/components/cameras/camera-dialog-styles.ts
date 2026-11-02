export const CAMERA_FIELD_STYLES = Object.freeze({
  label: 'block text-xs font-semibold tracking-wide text-[#111111] break-words',
  input:
    'w-full min-w-0 max-w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-[#111111] shadow-xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus-visible:border-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] aria-[invalid=true]:border-rose-500 aria-[invalid=true]:bg-rose-50/30 aria-[invalid=true]:focus-visible:outline-rose-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500',
  readOnlyInput:
    'w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-slate-100/90 px-3.5 py-2.5 font-mono text-xs text-slate-700 disabled:cursor-default disabled:text-slate-600',
  help: 'text-xs leading-relaxed text-[#6B6B6B] break-words',
  error: 'text-xs font-medium leading-relaxed text-rose-700 break-words',
});

export const CAMERA_BUTTON_STYLES = Object.freeze({
  primary:
    'inline-flex items-center justify-center rounded-xl bg-[#0F172A] px-4 py-2 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 cursor-pointer',
  secondary:
    'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 hover:text-[#111111] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 cursor-pointer',
  compactSecondary:
    'inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs transition-colors hover:bg-slate-50 hover:text-[#111111] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 cursor-pointer',
});
