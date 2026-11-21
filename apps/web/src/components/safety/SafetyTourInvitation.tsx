export interface SafetyTourInvitationProps {
  ariaLabel: string;
  promptText: string;
  startLabel: string;
  skipLabel: string;
  onStart: () => void;
  onSkip: () => void;
}

export function SafetyTourInvitation({
  ariaLabel,
  promptText,
  startLabel,
  skipLabel,
  onStart,
  onSkip,
}: SafetyTourInvitationProps) {
  return (
    <div
      role="note"
      aria-label={ariaLabel}
      data-testid="safety-task-tour-invitation"
      className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-1.5 text-xs text-slate-700"
    >
      <span className="min-w-0 break-words font-medium text-slate-700 [overflow-wrap:anywhere]">
        {promptText}
      </span>
      <div className="inline-flex shrink-0 items-center gap-2">
        <button
          type="button"
          data-testid="safety-task-tour-invitation-start"
          onClick={onStart}
          className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-900 transition-colors hover:bg-slate-100 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {startLabel}
        </button>
        <button
          type="button"
          data-testid="safety-task-tour-invitation-skip"
          onClick={onSkip}
          className="inline-flex min-h-8 items-center rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-900 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {skipLabel}
        </button>
      </div>
    </div>
  );
}
