import { localizedLabel } from '../../../i18n/labels';

export function AttendanceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, { bg: string; text: string; dot: string; border: string }> = {
    PRESENT: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      dot: 'bg-emerald-500',
      border: 'border-emerald-200',
    },
    ABSENT: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      dot: 'bg-rose-500',
      border: 'border-rose-200',
    },
    NEEDS_REVIEW: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      dot: 'bg-amber-500',
      border: 'border-amber-200',
    },
    SCHEDULED: {
      bg: 'bg-sky-50',
      text: 'text-sky-700',
      dot: 'bg-sky-500',
      border: 'border-sky-200',
    },
    NOT_ARRIVED: {
      bg: 'bg-amber-50/70',
      text: 'text-amber-800',
      dot: 'bg-amber-400',
      border: 'border-amber-200',
    },
    OFF: {
      bg: 'bg-slate-50',
      text: 'text-slate-500',
      dot: 'bg-slate-400',
      border: 'border-slate-200',
    },
    APPROVED_LEAVE: {
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      dot: 'bg-purple-400',
      border: 'border-purple-200',
    },
    UNAVAILABLE: {
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      dot: 'bg-slate-400',
      border: 'border-slate-200',
    },
  };

  const current = styles[status] ?? {
    bg: 'bg-slate-50',
    text: 'text-slate-600',
    dot: 'bg-slate-400',
    border: 'border-slate-200',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${current.bg} ${current.text} ${current.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${current.dot}`} aria-hidden="true" />
      <span>{localizedLabel(status)}</span>
    </span>
  );
}
