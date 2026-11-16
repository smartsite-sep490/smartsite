import { isSafetyIdentificationRouteEnabled } from '../safety-episodes/safetyUrlParams';
import { registerSafetyTaskTourCatalog } from './safety-task-tour-catalog';

registerSafetyTaskTourCatalog();

export const SAFETY_TOUR_STORAGE_KEY = 'smartsite.safetyTaskTour.v1';
export const MONITOR_TOUR_VERSION = 1;
export const ALERTS_TOUR_VERSION = 1;
export const CAMERA_SETUP_TOUR_VERSION = 1;
export const FRAME_INBOX_TOUR_VERSION = 1;

export type SafetyTaskId = 'monitor' | 'alerts' | 'camera-setup' | 'polygon' | 'frame-inbox';

export type SafetyTourProgressStatus = 'COMPLETED' | 'SKIPPED';

export interface SafetyTourStepSpec {
  id: string;
  anchorSelector: string;
  titleKey: string;
  bodyKey: string;
  isAllowed?: () => boolean;
}

export interface SafetyTaskTourProps {
  taskId: SafetyTaskId;
  tourVersion?: number;
  userId?: string | null;
  scopeKey: string;
  isAuthorized?: boolean;
  steps?: readonly SafetyTourStepSpec[];
}

const stepSpec = (id: string, anchor: string, prefix: string): SafetyTourStepSpec => ({
  id,
  anchorSelector: `[data-tour-anchor="${anchor}"]`,
  titleKey: `${prefix}.title`,
  bodyKey: `${prefix}.body`,
});

export const MONITOR_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('monitor-scope', 'monitor-scope', 'tour.monitor.scope'),
  stepSpec('monitor-view-mode', 'monitor-view-mode', 'tour.monitor.viewMode'),
  stepSpec('monitor-enlarge', 'monitor-enlarge', 'tour.monitor.enlarge'),
  stepSpec('monitor-evidence', 'monitor-evidence', 'tour.monitor.evidence'),
  stepSpec('monitor-setup', 'monitor-setup', 'tour.monitor.setup'),
];

export const ALERTS_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('alerts-queue-filter', 'alerts-queue-filter', 'tour.alerts.queueFilter'),
  stepSpec('alerts-case-summary', 'alerts-case-summary', 'tour.alerts.caseSummary'),
  stepSpec('alerts-action-bar', 'alerts-action-bar', 'tour.alerts.actionBar'),
  stepSpec('alerts-followup', 'alerts-followup', 'tour.alerts.followup'),
];

export const PROPOSED_ALERTS_TOUR_ANCHORS: readonly SafetyTourStepSpec[] = ALERTS_TOUR_STEPS;

export interface AlertsTourStepOptions {
  hasQueueFilter: boolean;
  hasSelectedCase: boolean;
  canRecordReview: boolean;
  hasFollowupContext: boolean;
}

export function buildAlertsTourSteps(
  options: AlertsTourStepOptions,
): readonly SafetyTourStepSpec[] {
  return ALERTS_TOUR_STEPS.map((step) => {
    if (step.id === 'alerts-queue-filter') {
      return { ...step, isAllowed: () => options.hasQueueFilter };
    }
    if (step.id === 'alerts-case-summary') {
      return { ...step, isAllowed: () => options.hasSelectedCase };
    }
    if (step.id === 'alerts-action-bar') {
      return { ...step, isAllowed: () => options.canRecordReview };
    }
    if (step.id === 'alerts-followup') {
      return { ...step, isAllowed: () => options.hasFollowupContext };
    }
    return step;
  });
}

export const CAMERA_SETUP_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('camera-setup-scope', 'camera-setup-scope', 'tour.cameraSetup.scope'),
  stepSpec('camera-setup-source', 'camera-setup-source', 'tour.cameraSetup.source'),
  stepSpec('camera-setup-zone-draw', 'camera-setup-zone-draw', 'tour.cameraSetup.zoneDraw'),
  stepSpec('camera-setup-save', 'camera-setup-save', 'tour.cameraSetup.save'),
];

export const PROPOSED_CAMERA_SETUP_TOUR_ANCHORS: readonly SafetyTourStepSpec[] =
  CAMERA_SETUP_TOUR_STEPS;

export interface CameraSetupTourStepOptions {
  canManageCameras: boolean;
  canAccessZones: boolean;
  hasCameraContext: boolean;
}

export function buildCameraSetupTourSteps(
  options: CameraSetupTourStepOptions,
): readonly SafetyTourStepSpec[] {
  return CAMERA_SETUP_TOUR_STEPS.map((step) => {
    if (step.id === 'camera-setup-source') {
      return { ...step, isAllowed: () => options.canManageCameras };
    }
    if (step.id === 'camera-setup-zone-draw') {
      return { ...step, isAllowed: () => options.canManageCameras || options.canAccessZones };
    }
    if (step.id === 'camera-setup-save') {
      return { ...step, isAllowed: () => options.hasCameraContext };
    }
    return step;
  });
}

export const FRAME_INBOX_TOUR_STEPS: readonly SafetyTourStepSpec[] = [
  stepSpec('frame-inbox-filters', 'frame-inbox-filters', 'tour.frameInbox.filters'),
  stepSpec('frame-inbox-card-summary', 'frame-inbox-card-summary', 'tour.frameInbox.frameSummary'),
  stepSpec(
    'frame-inbox-media-evidence',
    'frame-inbox-media-evidence',
    'tour.frameInbox.mediaEvidence',
  ),
  stepSpec(
    'frame-inbox-subject-status',
    'frame-inbox-subject-status',
    'tour.frameInbox.subjectStatus',
  ),
  stepSpec('frame-inbox-open-case', 'frame-inbox-open-case', 'tour.frameInbox.caseHandoff'),
];

export interface FrameInboxTourStepOptions {
  hasFrames: boolean;
  hasExpandedSubject?: boolean;
  enableIdentification?: boolean;
}

export function buildFrameInboxTourSteps(
  options: FrameInboxTourStepOptions,
): readonly SafetyTourStepSpec[] {
  const c02Enabled = isSafetyIdentificationRouteEnabled(options.enableIdentification);
  return FRAME_INBOX_TOUR_STEPS.map((step) => {
    if (step.id === 'frame-inbox-card-summary') {
      return { ...step, isAllowed: () => options.hasFrames };
    }
    if (
      step.id === 'frame-inbox-media-evidence' ||
      step.id === 'frame-inbox-subject-status' ||
      step.id === 'frame-inbox-open-case'
    ) {
      const prefix =
        step.id === 'frame-inbox-open-case' && !c02Enabled ? 'tour.frameInbox.caseReview' : null;
      return {
        ...step,
        ...(prefix ? { titleKey: `${prefix}.title`, bodyKey: `${prefix}.body` } : {}),
        isAllowed: () => options.hasFrames && (options.hasExpandedSubject ?? true),
      };
    }
    return step;
  });
}

export function sanitizeTourUserId(userId: string | null | undefined): string | null {
  if (typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  if (!trimmed || trimmed.length > 128 || /[\s.:/]/.test(trimmed) || /^bearer\b/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function readSafetyTourProgress(
  userId: string | null | undefined,
  taskId: string,
  tourVersion: number,
): SafetyTourProgressStatus | null {
  const safeUser = sanitizeTourUserId(userId);
  if (!safeUser || !Number.isSafeInteger(tourVersion) || tourVersion < 1) return null;
  try {
    const raw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    const entry = parsed?.[`${safeUser}:${taskId}:v${tourVersion}`] as
      { status?: unknown; tourVersion?: unknown } | undefined;
    return entry?.tourVersion === tourVersion &&
      (entry.status === 'COMPLETED' || entry.status === 'SKIPPED')
      ? entry.status
      : null;
  } catch {
    return null;
  }
}

export function writeSafetyTourProgress(
  userId: string | null | undefined,
  taskId: string,
  tourVersion: number,
  status: SafetyTourProgressStatus,
): boolean {
  const safeUser = sanitizeTourUserId(userId);
  if (!safeUser || !Number.isSafeInteger(tourVersion) || tourVersion < 1) return false;
  try {
    const raw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const safeStore: Record<string, { status: SafetyTourProgressStatus; tourVersion: number }> = {};
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        const rec = v as { status?: unknown; tourVersion?: unknown } | null;
        if (
          rec &&
          (rec.status === 'COMPLETED' || rec.status === 'SKIPPED') &&
          typeof rec.tourVersion === 'number'
        ) {
          safeStore[k] = { status: rec.status, tourVersion: rec.tourVersion };
        }
      }
    }
    safeStore[`${safeUser}:${taskId}:v${tourVersion}`] = { status, tourVersion };
    window.localStorage.setItem(SAFETY_TOUR_STORAGE_KEY, JSON.stringify(safeStore));
    return true;
  } catch {
    return false;
  }
}

export function clearSafetyTourProgress(
  userId: string | null | undefined,
  taskId: string,
  tourVersion: number,
): boolean {
  const safeUser = sanitizeTourUserId(userId);
  if (!safeUser || !Number.isSafeInteger(tourVersion) || tourVersion < 1) return false;
  try {
    const raw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') {
      window.localStorage.removeItem(SAFETY_TOUR_STORAGE_KEY);
      return true;
    }
    const targetKey = `${safeUser}:${taskId}:v${tourVersion}`;
    const safeStore: Record<string, { status: SafetyTourProgressStatus; tourVersion: number }> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (k === targetKey) continue;
      const rec = v as { status?: unknown; tourVersion?: unknown } | null;
      if (
        rec &&
        (rec.status === 'COMPLETED' || rec.status === 'SKIPPED') &&
        typeof rec.tourVersion === 'number'
      ) {
        safeStore[k] = { status: rec.status, tourVersion: rec.tourVersion };
      }
    }
    if (Object.keys(safeStore).length === 0) {
      window.localStorage.removeItem(SAFETY_TOUR_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SAFETY_TOUR_STORAGE_KEY, JSON.stringify(safeStore));
    }
    return true;
  } catch {
    return false;
  }
}

export function isElementAvailable(el: HTMLElement | null): el is HTMLElement {
  if (!el || !el.isConnected || el.closest('[hidden], [inert], [aria-hidden="true"], .sr-only')) {
    return false;
  }
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) {
      return false;
    }
  }
  return true;
}
