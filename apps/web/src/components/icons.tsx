/**
 * Coherent icon family — Phosphor Bold
 *
 * Re-exports every icon used across the SmartSite Web app under the same
 * names that the codebase already imports. Each wrapper accepts the same
 * `{ className?: string }` prop signature so callers need zero changes.
 *
 * All icons render with aria-hidden="true" because they are decorative
 * (always paired with visible text or an aria-label on the parent button).
 * Icon-only controls MUST have aria-label on the <button> element.
 *
 * Package: @phosphor-icons/react  v2.1.10  MIT
 */
import {
  ShieldCheck as PhShield,
  HardHat as PhHardHat,
  User as PhUser,
  UsersThree as PhUsers,
  Key as PhKey,
  Warning as PhAlertTriangle,
  Check as PhCheck,
  X as PhX,
  Bell as PhBell,
  MagnifyingGlass as PhSearch,
  CaretDown as PhChevronDown,
  CaretLeft as PhChevronLeft,
  CaretRight as PhChevronRight,
  Funnel as PhFilter,
  Eye as PhEye,
  Buildings as PhBuilding,
  Clock as PhClock,
  SquaresFour as PhDashboard,
  VideoCamera as PhCamera,
  Cpu as PhCpu,
  TrendUp as PhTrendingUp,
  House as PhHome,
  Broadcast as PhRadio,
  SlidersHorizontal as PhSliders,
  Building as PhBuilding2,
  Play as PhPlay,
  Pause as PhPause,
  SpeakerHigh as PhVolume,
  ArrowsOut as PhMaximize,
  GridFour as PhGrid,
} from '@phosphor-icons/react';

/* ── Shared prop type ──────────────────────────────────────────────── */
type IconProps = { className?: string };

/* ── Re-exports (keep existing names + signatures) ─────────────────── */
export function IconShield({ className = 'w-5 h-5' }: IconProps) {
  return <PhShield className={className} weight="bold" aria-hidden="true" />;
}
export function IconHardHat({ className = 'w-5 h-5' }: IconProps) {
  return <PhHardHat className={className} weight="bold" aria-hidden="true" />;
}
export function IconUser({ className = 'w-5 h-5' }: IconProps) {
  return <PhUser className={className} weight="bold" aria-hidden="true" />;
}
export function IconUsers({ className = 'w-5 h-5' }: IconProps) {
  return <PhUsers className={className} weight="bold" aria-hidden="true" />;
}
export function IconKey({ className = 'w-5 h-5' }: IconProps) {
  return <PhKey className={className} weight="bold" aria-hidden="true" />;
}
export function IconAlertTriangle({ className = 'w-5 h-5' }: IconProps) {
  return <PhAlertTriangle className={className} weight="bold" aria-hidden="true" />;
}
export function IconCheck({ className = 'w-5 h-5' }: IconProps) {
  return <PhCheck className={className} weight="bold" aria-hidden="true" />;
}
export function IconX({ className = 'w-5 h-5' }: IconProps) {
  return <PhX className={className} weight="bold" aria-hidden="true" />;
}
export function IconBell({ className = 'w-5 h-5' }: IconProps) {
  return <PhBell className={className} weight="bold" aria-hidden="true" />;
}
export function IconSearch({ className = 'w-5 h-5' }: IconProps) {
  return <PhSearch className={className} weight="bold" aria-hidden="true" />;
}
export function IconChevronDown({ className = 'w-4 h-4' }: IconProps) {
  return <PhChevronDown className={className} weight="bold" aria-hidden="true" />;
}
export function IconChevronLeft({ className = 'w-4 h-4' }: IconProps) {
  return <PhChevronLeft className={className} weight="bold" aria-hidden="true" />;
}
export function IconChevronRight({ className = 'w-4 h-4' }: IconProps) {
  return <PhChevronRight className={className} weight="bold" aria-hidden="true" />;
}
export function IconFilter({ className = 'w-4 h-4' }: IconProps) {
  return <PhFilter className={className} weight="bold" aria-hidden="true" />;
}
export function IconEye({ className = 'w-4 h-4' }: IconProps) {
  return <PhEye className={className} weight="bold" aria-hidden="true" />;
}
export function IconBuilding({ className = 'w-4 h-4' }: IconProps) {
  return <PhBuilding className={className} weight="bold" aria-hidden="true" />;
}
export function IconClock({ className = 'w-4 h-4' }: IconProps) {
  return <PhClock className={className} weight="bold" aria-hidden="true" />;
}
export function IconDashboard({ className = 'w-5 h-5' }: IconProps) {
  return <PhDashboard className={className} weight="bold" aria-hidden="true" />;
}
export function IconCamera({ className = 'w-5 h-5' }: IconProps) {
  return <PhCamera className={className} weight="bold" aria-hidden="true" />;
}
export function IconCpu({ className = 'w-5 h-5' }: IconProps) {
  return <PhCpu className={className} weight="bold" aria-hidden="true" />;
}
export function IconTrendingUp({ className = 'w-5 h-5' }: IconProps) {
  return <PhTrendingUp className={className} weight="bold" aria-hidden="true" />;
}
export function IconHome({ className = 'w-5 h-5' }: IconProps) {
  return <PhHome className={className} weight="bold" aria-hidden="true" />;
}
export function IconRadio({ className = 'w-5 h-5' }: IconProps) {
  return <PhRadio className={className} weight="bold" aria-hidden="true" />;
}
export function IconSliders({ className = 'w-4 h-4' }: IconProps) {
  return <PhSliders className={className} weight="bold" aria-hidden="true" />;
}
export function IconBuilding2({ className = 'w-4 h-4' }: IconProps) {
  return <PhBuilding2 className={className} weight="bold" aria-hidden="true" />;
}
export function IconPlay({ className = 'w-4 h-4' }: IconProps) {
  return <PhPlay className={className} weight="bold" aria-hidden="true" />;
}
export function IconPause({ className = 'w-4 h-4' }: IconProps) {
  return <PhPause className={className} weight="bold" aria-hidden="true" />;
}
export function IconVolume({ className = 'w-4 h-4' }: IconProps) {
  return <PhVolume className={className} weight="bold" aria-hidden="true" />;
}
export function IconMaximize({ className = 'w-4 h-4' }: IconProps) {
  return <PhMaximize className={className} weight="bold" aria-hidden="true" />;
}
export function IconGrid({ className = 'w-4 h-4' }: IconProps) {
  return <PhGrid className={className} weight="bold" aria-hidden="true" />;
}

export function IconRefresh({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

export function IconArrowRight({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}

export function IconLoader({ className = 'w-5 h-5 animate-spin' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  );
}
export function IconLogOut({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  );
}

export function IconCalendar({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

export function IconRefreshCw({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

export function IconAlertCircle({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function IconCheckCircle2({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

export function IconPlus({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

export function IconTrash({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16m-10 4v6m4-6v6M9 7V4h6v3m-8 0l1 13h8l1-13" />
    </svg>
  );
}
