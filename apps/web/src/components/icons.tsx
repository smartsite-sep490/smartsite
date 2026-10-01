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
