import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import {
  MONITOR_TOUR_STEPS,
  MONITOR_TOUR_VERSION,
  isElementAvailable,
  readSafetyTourProgress,
  writeSafetyTourProgress,
  type SafetyTaskId,
  type SafetyTaskTourProps,
  type SafetyTourProgressStatus,
  type SafetyTourStepSpec,
} from './safetyTaskTourModel';

const HIGHLIGHT_PROPS: readonly [string, string][] = [
  ['outline', '2px solid #0F172A'],
  ['outline-offset', '3px'],
  ['box-shadow', '0 0 0 4px rgba(15, 23, 42, 0.16)'],
];

function hasBlockingDialog(trigger: HTMLElement | null): boolean {
  const hostDialog = trigger?.closest<HTMLElement>('[role="dialog"], [aria-modal="true"]') ?? null;
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [aria-modal="true"]'),
  );
  if (!hostDialog) return dialogs.length > 0;
  return dialogs.some((dialog) => dialog !== hostDialog && !dialog.contains(hostDialog));
}

interface SafetyTaskTourSessionProps {
  taskId: SafetyTaskId;
  tourVersion: number;
  userId?: string | null;
  steps: readonly SafetyTourStepSpec[];
}

function SafetyTaskTourSession({ taskId, tourVersion, userId, steps }: SafetyTaskTourSessionProps) {
  const { locale } = useLocale();
  const { t: tr } = useTranslation(SAFETY_NAMESPACE, { lng: locale });
  const titleId = useId();
  const bodyId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const nextBtnRef = useRef<HTMLButtonElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const focusPrimaryRef = useRef(false);
  const wasTourVisibleRef = useRef(false);
  const prevStepIdRef = useRef<string | null>(null);
  const stepsRef = useRef(steps);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const [isOpen, setIsOpen] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [domTick, setDomTick] = useState(0);
  const [writtenProgress, setWrittenProgress] = useState<SafetyTourProgressStatus | null>(null);

  const progress = useMemo(
    () => writtenProgress ?? readSafetyTourProgress(userId, taskId, tourVersion),
    [writtenProgress, userId, taskId, tourVersion],
  );

  const availableSteps = useMemo(() => {
    if (typeof document === 'undefined') return [];
    void domTick;
    return steps.filter(
      (step) =>
        (!step.isAllowed || step.isAllowed()) &&
        isElementAvailable(document.querySelector<HTMLElement>(step.anchorSelector)),
    );
  }, [steps, domTick]);

  const closeTour = useCallback((restoreFocus = true) => {
    focusPrimaryRef.current = false;
    wasTourVisibleRef.current = false;
    prevStepIdRef.current = null;
    setIsOpen(false);
    setActiveStepId(null);
    if (restoreFocus) {
      queueMicrotask(() => {
        if (triggerRef.current?.isConnected && !hasBlockingDialog(triggerRef.current)) {
          triggerRef.current.focus();
        }
      });
    }
  }, []);

  const currentIndex = useMemo(() => {
    if (!isOpen || availableSteps.length === 0) return -1;
    if (!activeStepId) return 0;
    const exactIdx = availableSteps.findIndex((step) => step.id === activeStepId);
    if (exactIdx >= 0) return exactIdx;
    const oldOrder = steps.findIndex((step) => step.id === activeStepId);
    if (oldOrder < 0) return 0;
    const nextIdx = availableSteps.findIndex(
      (step) => steps.findIndex((master) => master.id === step.id) > oldOrder,
    );
    return nextIdx >= 0 ? nextIdx : availableSteps.length - 1;
  }, [isOpen, availableSteps, activeStepId, steps]);

  const currentStep = currentIndex >= 0 ? availableSteps[currentIndex] : null;
  const isTourVisible = isOpen && currentStep !== null;

  if (isOpen && !currentStep) {
    setIsOpen(false);
    setActiveStepId(null);
  } else if (isOpen && currentStep && activeStepId !== currentStep.id) {
    setActiveStepId(currentStep.id);
  }

  useEffect(() => {
    if (!isOpen || typeof MutationObserver === 'undefined') return;
    const obs = new MutationObserver(() => {
      const hasAnyPermittedAnchor = stepsRef.current.some(
        (step) =>
          (!step.isAllowed || step.isAllowed()) &&
          isElementAvailable(document.querySelector<HTMLElement>(step.anchorSelector)),
      );
      if (!hasAnyPermittedAnchor) {
        closeTour(true);
        return;
      }
      setDomTick((n) => n + 1);
    });
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'style', 'data-tour-anchor', 'aria-hidden', 'inert'],
    });
    return () => obs.disconnect();
  }, [isOpen, closeTour]);

  useEffect(() => {
    if (!isTourVisible || !currentStep) {
      if (wasTourVisibleRef.current) {
        wasTourVisibleRef.current = false;
        prevStepIdRef.current = null;
        focusPrimaryRef.current = false;
        queueMicrotask(() => {
          if (triggerRef.current?.isConnected && !hasBlockingDialog(triggerRef.current)) {
            triggerRef.current.focus();
          }
        });
      }
      return;
    }
    const stepChangedToFirst =
      prevStepIdRef.current !== null &&
      prevStepIdRef.current !== currentStep.id &&
      currentIndex === 0;
    wasTourVisibleRef.current = true;
    prevStepIdRef.current = currentStep.id;

    const active = document.activeElement;
    const lost = !active || active === document.body || active === document.documentElement;
    if (
      (focusPrimaryRef.current || stepChangedToFirst || lost) &&
      !hasBlockingDialog(triggerRef.current)
    ) {
      nextBtnRef.current?.focus();
    }
    focusPrimaryRef.current = false;
  }, [isTourVisible, currentIndex, currentStep]);

  useEffect(() => {
    if (!isOpen || !currentStep) return;
    const anchor = document.querySelector<HTMLElement>(currentStep.anchorSelector);
    if (!isElementAvailable(anchor)) return;

    const saved = HIGHLIGHT_PROPS.map(
      ([prop]) =>
        [
          prop,
          anchor.style.getPropertyValue(prop),
          anchor.style.getPropertyPriority(prop),
        ] as const,
    );
    anchor.setAttribute('data-tour-active-anchor', 'true');
    for (const [prop, val] of HIGHLIGHT_PROPS) {
      anchor.style.setProperty(prop, val);
    }
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    anchor.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });

    const applyHighlightGeometry = () => {
      const overlay = highlightRef.current;
      if (!overlay) return;
      const rect = anchor.getBoundingClientRect();
      overlay.style.top = `${Math.max(0, rect.top - 4)}px`;
      overlay.style.left = `${Math.max(0, rect.left - 4)}px`;
      overlay.style.width = `${Math.max(0, rect.width + 8)}px`;
      overlay.style.height = `${Math.max(0, rect.height + 8)}px`;
    };

    const onViewportOrAnchorChange = () => {
      if (!isElementAvailable(anchor)) {
        setDomTick((n) => n + 1);
        return;
      }
      applyHighlightGeometry();
    };

    applyHighlightGeometry();
    window.addEventListener('scroll', onViewportOrAnchorChange, true);
    window.addEventListener('resize', onViewportOrAnchorChange);
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onViewportOrAnchorChange) : null;
    ro?.observe(anchor);

    return () => {
      window.removeEventListener('scroll', onViewportOrAnchorChange, true);
      window.removeEventListener('resize', onViewportOrAnchorChange);
      ro?.disconnect();
      anchor.removeAttribute('data-tour-active-anchor');
      for (const [prop, val, priority] of saved) {
        if (val) {
          anchor.style.setProperty(prop, val, priority);
        } else {
          anchor.style.removeProperty(prop);
        }
      }
    };
  }, [isOpen, currentStep]);

  useEffect(() => {
    if (!isTourVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (hasBlockingDialog(triggerRef.current)) return;
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        closeTour(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isTourVisible, closeTour]);

  const finishWithStatus = (status: SafetyTourProgressStatus) => {
    writeSafetyTourProgress(userId, taskId, tourVersion, status);
    setWrittenProgress(status);
    closeTour(true);
  };

  const isLastStep = currentIndex + 1 >= availableSteps.length;

  return (
    <div className="relative inline-flex items-center">
      <button
        ref={triggerRef}
        type="button"
        data-testid="safety-task-tour-trigger"
        aria-expanded={isTourVisible}
        onClick={() => {
          if (isTourVisible) {
            closeTour(true);
            return;
          }
          const firstStep = steps.find(
            (step) =>
              (!step.isAllowed || step.isAllowed()) &&
              isElementAvailable(document.querySelector<HTMLElement>(step.anchorSelector)),
          );
          if (!firstStep) return;
          focusPrimaryRef.current = true;
          setDomTick((n) => n + 1);
          setActiveStepId(firstStep.id);
          setIsOpen(true);
        }}
        className="px-3 py-1 rounded-full border border-slate-200/90 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 hover:text-slate-900 transition-colors cursor-pointer shadow-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {progress ? tr('tour.replayBtn') : tr('tour.triggerBtn')}
      </button>

      {isTourVisible && currentStep && (
        <>
          <div
            ref={highlightRef}
            aria-hidden="true"
            data-testid="safety-task-tour-highlight"
            className="pointer-events-none fixed z-30 rounded-2xl border-2 border-[#0F172A] ring-4 ring-slate-900/15"
          />

          <section
            role="region"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            data-testid="safety-task-tour"
            data-tour-step={currentStep.id}
            className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl text-slate-900 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {tr('tour.stepCounter', {
                    current: currentIndex + 1,
                    total: availableSteps.length,
                  })}
                </p>
                <h2 id={titleId} className="text-sm font-bold text-slate-900 mt-0.5">
                  {tr(currentStep.titleKey)}
                </h2>
              </div>
              <button
                type="button"
                data-testid="safety-task-tour-close"
                aria-label={tr('tour.closeAria')}
                onClick={() => closeTour(true)}
                className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
              >
                ×
              </button>
            </div>
            <p id={bodyId} className="text-xs text-slate-600 leading-relaxed">
              {tr(currentStep.bodyKey)}
            </p>
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
              <button
                type="button"
                data-testid="safety-task-tour-skip"
                onClick={() => finishWithStatus('SKIPPED')}
                className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                {tr('tour.skipBtn')}
              </button>
              <div className="flex items-center gap-1.5">
                {currentIndex > 0 && (
                  <button
                    type="button"
                    data-testid="safety-task-tour-back"
                    onClick={() => {
                      if (currentIndex <= 1) focusPrimaryRef.current = true;
                      setActiveStepId(availableSteps[currentIndex - 1]?.id ?? null);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    {tr('tour.backBtn')}
                  </button>
                )}
                <button
                  ref={nextBtnRef}
                  type="button"
                  data-testid={isLastStep ? 'safety-task-tour-done' : 'safety-task-tour-next'}
                  onClick={() => {
                    if (isLastStep) {
                      finishWithStatus('COMPLETED');
                    } else {
                      setActiveStepId(availableSteps[currentIndex + 1]?.id ?? null);
                    }
                  }}
                  className="rounded-lg bg-[#0F172A] px-3 py-1 text-xs font-semibold text-white hover:bg-slate-800 cursor-pointer"
                >
                  {tr(isLastStep ? 'tour.doneBtn' : 'tour.nextBtn')}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function SafetyTaskTour({
  taskId,
  tourVersion = MONITOR_TOUR_VERSION,
  userId,
  scopeKey,
  isAuthorized = true,
  steps = MONITOR_TOUR_STEPS,
}: SafetyTaskTourProps) {
  if (!isAuthorized) return null;
  const sessionKey = `${scopeKey}::${userId ?? ''}::${taskId}::${tourVersion}`;
  return (
    <SafetyTaskTourSession
      key={sessionKey}
      taskId={taskId}
      tourVersion={tourVersion}
      userId={userId}
      steps={steps}
    />
  );
}
