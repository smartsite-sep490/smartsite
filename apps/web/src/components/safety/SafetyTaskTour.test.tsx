// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { SafetyTaskTour } from './SafetyTaskTour';
import {
  ALERTS_TOUR_VERSION,
  MONITOR_TOUR_STEPS,
  MONITOR_TOUR_VERSION,
  PROPOSED_ALERTS_TOUR_ANCHORS,
  PROPOSED_CAMERA_SETUP_TOUR_ANCHORS,
  SAFETY_TOUR_STORAGE_KEY,
  buildAlertsTourSteps,
  isElementAvailable,
  readSafetyTourProgress,
  sanitizeTourUserId,
  writeSafetyTourProgress,
} from './safetyTaskTourModel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

function renderMonitorFixture(props?: {
  userId?: string | null;
  scopeKey?: string;
  isAuthorized?: boolean;
  includeSetupAnchor?: boolean;
  locale?: 'en' | 'vi';
}) {
  const {
    userId = 'user-operator-1',
    scopeKey = 'scope-a:site-1',
    isAuthorized = true,
    includeSetupAnchor = true,
    locale = 'en',
  } = props ?? {};

  void i18n.changeLanguage(locale);

  return render(
    <LocaleProvider defaultLocale={locale}>
      <div>
        <SafetyTaskTour
          taskId="monitor"
          tourVersion={MONITOR_TOUR_VERSION}
          userId={userId}
          scopeKey={scopeKey}
          isAuthorized={isAuthorized}
          steps={MONITOR_TOUR_STEPS}
        />
        <section data-tour-anchor="monitor-scope" data-testid="anchor-scope">
          Scope selector
        </section>
        <div data-tour-anchor="monitor-view-mode" data-testid="anchor-view-mode">
          View mode switcher
        </div>
        <button type="button" data-tour-anchor="monitor-enlarge" data-testid="anchor-enlarge">
          Enlarge camera
        </button>
        <button type="button" data-tour-anchor="monitor-evidence" data-testid="anchor-evidence">
          Evidence details
        </button>
        <section
          data-tour-anchor="monitor-setup"
          data-testid="anchor-setup"
          className={includeSetupAnchor ? '' : 'sr-only'}
        >
          Camera & Zone setup
        </section>
      </div>
    </LocaleProvider>,
  );
}

describe('SafetyTaskTour', () => {
  beforeEach(async () => {
    window.localStorage.clear();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('leaves Escape to an open dialog before closing the background tour', () => {
    renderMonitorFixture();
    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    const onDialogEscape = vi.fn((event: React.KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    });
    const modal = render(
      <div role="dialog" aria-modal="true" onKeyDown={onDialogEscape} tabIndex={-1}>
        Evidence dialog
      </div>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onDialogEscape).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('safety-task-tour')).not.toBeNull();
    modal.unmount();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  });

  it('does not auto-open on initial render, steps through visible anchors without making page elements inert, and persists completion for replay', async () => {
    renderMonitorFixture({ userId: 'user-admin-1', includeSetupAnchor: true });

    const trigger = screen.getByTestId('safety-task-tour-trigger');
    expect(trigger.textContent).toBe('Guided help');
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();

    fireEvent.click(trigger);

    const tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('monitor-scope');
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    expect(screen.getByText('Choose Site & Camera')).toBeTruthy();

    const scopeAnchor = screen.getByTestId('anchor-scope');
    expect(scopeAnchor.getAttribute('data-tour-active-anchor')).toBe('true');
    expect(scopeAnchor.hasAttribute('inert')).toBe(false);
    expect(document.querySelector('[inert]')).toBeNull();

    const nextBtn = screen.getByTestId('safety-task-tour-next');
    expect(document.activeElement).toBe(nextBtn);

    fireEvent.click(nextBtn);
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );
    expect(scopeAnchor.hasAttribute('data-tour-active-anchor')).toBe(false);
    expect(screen.getByTestId('anchor-view-mode').getAttribute('data-tour-active-anchor')).toBe(
      'true',
    );

    const backBtn = screen.getByTestId('safety-task-tour-back');
    backBtn.focus();
    expect(document.activeElement).toBe(backBtn);
    fireEvent.click(backBtn);
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-scope',
    );
    expect(screen.queryByTestId('safety-task-tour-back')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('safety-task-tour-next'));

    // Advance to final step (step 5: monitor-setup)
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-setup',
    );
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
    expect(
      screen.getByText(
        /Configuring cameras and zones requires the assigned Site Manager; monitoring access does not grant setup permissions/i,
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId('safety-task-tour-done'));
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(trigger.textContent).toBe('Replay guide');
    expect(readSafetyTourProgress('user-admin-1', 'monitor', MONITOR_TOUR_VERSION)).toBe(
      'COMPLETED',
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('omits unauthorized/hidden setup anchor and supports Skip and Escape dismissal with focus restoration', async () => {
    renderMonitorFixture({
      userId: 'user-viewer-1',
      includeSetupAnchor: false,
      locale: 'vi',
    });

    const trigger = screen.getByTestId('safety-task-tour-trigger');
    expect(trigger.textContent).toBe('Hướng dẫn nhanh');

    fireEvent.click(trigger);
    expect(screen.getByText('Bước 1 / 4')).toBeTruthy();
    expect(screen.queryByText('Thiết lập Camera & Khu vực')).toBeNull();

    // Dismiss via Escape key without persisting completion
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(readSafetyTourProgress('user-viewer-1', 'monitor', MONITOR_TOUR_VERSION)).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    // Reopen and click Skip
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('safety-task-tour-skip'));
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(readSafetyTourProgress('user-viewer-1', 'monitor', MONITOR_TOUR_VERSION)).toBe(
      'SKIPPED',
    );
    expect(trigger.textContent).toBe('Xem lại hướng dẫn');
  });

  it('advances to nearest permitted step when active anchor disappears mid-step rather than restarting Step 1, and closes on scope rotation', async () => {
    const { rerender } = renderMonitorFixture({
      userId: 'user-operator-2',
      scopeKey: 'scope-1:site-1',
      includeSetupAnchor: true,
    });

    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    // Move to step 2 (monitor-view-mode)
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );

    // Mid-tour anchor (monitor-view-mode) disappears -> advances to next permitted step (monitor-enlarge) instead of restarting Step 1
    act(() => {
      screen.getByTestId('anchor-view-mode').classList.add('sr-only');
    });

    await waitFor(() => {
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'monitor-enlarge',
      );
      expect(screen.getByText('Step 2 of 4')).toBeTruthy();
    });

    // Move to final step (monitor-setup, Step 4 of 4)
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-setup',
    );

    // Final step anchor becomes hidden (.sr-only) -> falls back to nearest permitted predecessor (monitor-evidence) instead of restarting Step 1
    act(() => {
      screen.getByTestId('anchor-setup').classList.add('sr-only');
    });

    await waitFor(() => {
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'monitor-evidence',
      );
      expect(screen.getByText('Step 3 of 3')).toBeTruthy();
    });

    // Scope rotation closes the open tour immediately
    rerender(
      <LocaleProvider defaultLocale="en">
        <div>
          <SafetyTaskTour
            taskId="monitor"
            tourVersion={MONITOR_TOUR_VERSION}
            userId="user-operator-2"
            scopeKey="scope-2:site-2"
            isAuthorized={true}
            steps={MONITOR_TOUR_STEPS}
          />
          <section data-tour-anchor="monitor-scope" data-testid="anchor-scope">
            Scope selector
          </section>
        </div>
      </LocaleProvider>,
    );

    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  });

  it('never persists tokens, URLs, or malformed user identifiers and exports cross-worker anchor specs', () => {
    expect(sanitizeTourUserId('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token.sig')).toBeNull();
    expect(sanitizeTourUserId('Bearer secret-token')).toBeNull();
    expect(sanitizeTourUserId('https://example.com/frame.jpg')).toBeNull();
    expect(sanitizeTourUserId('scope:with:colon')).toBeNull();
    expect(
      writeSafetyTourProgress(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token.sig',
        'monitor',
        1,
        'COMPLETED',
      ),
    ).toBe(false);
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();

    expect(writeSafetyTourProgress('user-safe-99', 'monitor', 1, 'COMPLETED')).toBe(true);
    const raw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '';
    expect(raw).toContain('user-safe-99:monitor:v1');
    expect(PROPOSED_ALERTS_TOUR_ANCHORS.length).toBeGreaterThanOrEqual(3);
    expect(PROPOSED_CAMERA_SETUP_TOUR_ANCHORS.length).toBeGreaterThanOrEqual(4);
  });

  it('renders a bounded visible highlight that repositions on scroll/resize and restores prior inline styles on cleanup', () => {
    renderMonitorFixture({ userId: 'user-highlight-1', includeSetupAnchor: true });

    const scopeAnchor = screen.getByTestId('anchor-scope');
    scopeAnchor.style.setProperty('outline', '1px dashed rgb(12, 34, 56)');
    scopeAnchor.style.setProperty('box-shadow', '0 1px 2px rgba(0, 0, 0, 0.25)');

    let rect = { top: 40, left: 60, width: 200, height: 50 };
    vi.spyOn(scopeAnchor, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          ...rect,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          x: rect.left,
          y: rect.top,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));

    const highlight = screen.getByTestId('safety-task-tour-highlight');
    expect(highlight.className).toContain('pointer-events-none');
    expect(highlight.style.top).toBe('36px');
    expect(highlight.style.left).toBe('56px');
    expect(highlight.style.width).toBe('208px');
    expect(highlight.style.height).toBe('58px');
    expect(scopeAnchor.style.getPropertyValue('outline')).toMatch(/2px solid/i);
    expect(scopeAnchor.style.getPropertyValue('outline-offset')).toBe('3px');
    expect(scopeAnchor.hasAttribute('inert')).toBe(false);

    // Reposition on scroll / resize
    rect = { top: 120, left: 90, width: 320, height: 80 };
    act(() => {
      fireEvent.scroll(window);
    });
    expect(highlight.style.top).toBe('116px');
    expect(highlight.style.left).toBe('86px');
    expect(highlight.style.width).toBe('328px');
    expect(highlight.style.height).toBe('88px');

    rect = { top: 150, left: 110, width: 340, height: 90 };
    act(() => {
      fireEvent.resize(window);
    });
    expect(highlight.style.top).toBe('146px');
    expect(highlight.style.left).toBe('106px');

    // Closing tour removes highlight overlay and restores exact prior inline styles
    fireEvent.click(screen.getByTestId('safety-task-tour-close'));
    expect(screen.queryByTestId('safety-task-tour-highlight')).toBeNull();
    expect(scopeAnchor.hasAttribute('data-tour-active-anchor')).toBe(false);
    expect(scopeAnchor.style.getPropertyValue('outline')).toBe('1px dashed rgb(12, 34, 56)');
    expect(scopeAnchor.style.getPropertyValue('outline-offset')).toBe('');
    expect(scopeAnchor.style.getPropertyValue('box-shadow')).toBe('0 1px 2px rgba(0, 0, 0, 0.25)');
  });

  it('rejects anchors inside CSS-hidden ancestors (display:none or visibility:hidden on parent)', async () => {
    render(
      <LocaleProvider defaultLocale="en">
        <div>
          <SafetyTaskTour
            taskId="monitor"
            tourVersion={MONITOR_TOUR_VERSION}
            userId="user-ancestor-test"
            scopeKey="scope-ancestor:site-1"
            isAuthorized={true}
            steps={MONITOR_TOUR_STEPS}
          />
          <section data-tour-anchor="monitor-scope" data-testid="anchor-scope">
            Scope selector
          </section>
          <div data-testid="setup-parent-wrapper" style={{ display: 'none' }}>
            <section data-tour-anchor="monitor-setup" data-testid="anchor-setup-nested">
              Nested setup anchor
            </section>
          </div>
          <div data-testid="evidence-parent-wrapper">
            <button
              type="button"
              data-tour-anchor="monitor-evidence"
              data-testid="anchor-evidence-nested"
            >
              Evidence
            </button>
          </div>
        </div>
      </LocaleProvider>,
    );

    const nestedSetup = screen.getByTestId('anchor-setup-nested');
    expect(isElementAvailable(nestedSetup)).toBe(false);

    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    // Only monitor-scope and monitor-evidence are available (setup is inside display:none parent)
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-evidence',
    );

    // Parent wrapper of active evidence anchor becomes visibility:hidden mid-step
    act(() => {
      screen.getByTestId('evidence-parent-wrapper').style.visibility = 'hidden';
    });

    await waitFor(() => {
      expect(isElementAvailable(screen.getByTestId('anchor-evidence-nested'))).toBe(false);
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'monitor-scope',
      );
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });
  });

  it('closes cleanly, restores trigger focus, and does not ghost-reopen when all step permissions are revoked via props, and keeps replacement step stable if a hidden anchor reappears', async () => {
    function AlertsTourHarness({
      hasQueueFilter,
      hasSelectedCase,
      canRecordReview,
      hideCaseSummary = false,
    }: {
      hasQueueFilter: boolean;
      hasSelectedCase: boolean;
      canRecordReview: boolean;
      hideCaseSummary?: boolean;
    }) {
      const steps = buildAlertsTourSteps({
        hasQueueFilter,
        hasSelectedCase,
        canRecordReview,
        hasFollowupContext: false,
      });
      return (
        <LocaleProvider defaultLocale="en">
          <div>
            <SafetyTaskTour
              taskId="alerts"
              tourVersion={ALERTS_TOUR_VERSION}
              userId="user-alerts-lifecycle"
              scopeKey="scope-alerts:site-1"
              isAuthorized={true}
              steps={steps}
            />
            <section data-tour-anchor="alerts-queue-filter">Queue filter</section>
            <section
              data-tour-anchor="alerts-case-summary"
              className={hideCaseSummary ? 'sr-only' : ''}
            >
              Case summary
            </section>
            <section data-tour-anchor="alerts-action-bar">Action bar</section>
          </div>
        </LocaleProvider>
      );
    }

    const { rerender } = render(
      <AlertsTourHarness hasQueueFilter={true} hasSelectedCase={true} canRecordReview={true} />,
    );

    const trigger = screen.getByTestId('safety-task-tour-trigger');
    fireEvent.click(trigger);
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-queue-filter',
    );

    // Advance to step 2 (alerts-case-summary)
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'alerts-case-summary',
    );

    // All open tour card buttons expose focus-visible outlines and overflow wrapping on heading/body
    for (const testId of [
      'safety-task-tour-close',
      'safety-task-tour-skip',
      'safety-task-tour-back',
      'safety-task-tour-next',
    ]) {
      expect(screen.getByTestId(testId).className).toContain('focus-visible:outline');
    }
    const tourCard = screen.getByTestId('safety-task-tour');
    expect(tourCard.querySelector('h2')?.className).toContain('break-words');
    expect(tourCard.querySelector('p[id]')?.className).toContain('break-words');

    // Hide alerts-case-summary -> falls forward to alerts-action-bar
    rerender(
      <AlertsTourHarness
        hasQueueFilter={true}
        hasSelectedCase={true}
        canRecordReview={true}
        hideCaseSummary={true}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'alerts-action-bar',
      );
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });

    // Unhide alerts-case-summary -> tour recomputes 3 steps and stays on alerts-action-bar rather than jumping back to stale activeStepId
    rerender(
      <AlertsTourHarness
        hasQueueFilter={true}
        hasSelectedCase={true}
        canRecordReview={true}
        hideCaseSummary={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Step 3 of 3')).toBeTruthy();
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'alerts-action-bar',
      );
    });

    // Revoke all step permissions via props without DOM removal -> tour closes and restores focus to trigger
    rerender(
      <AlertsTourHarness hasQueueFilter={false} hasSelectedCase={false} canRecordReview={false} />,
    );
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    // Re-enabling step permissions does not ghost-reopen the closed tour without user click
    rerender(
      <AlertsTourHarness hasQueueFilter={true} hasSelectedCase={true} canRecordReview={true} />,
    );
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  });

  it('reclaims focus to Next when the active step anchor is hidden in place while holding focus', async () => {
    renderMonitorFixture({ userId: 'user-focus-hidden-1', includeSetupAnchor: true });
    const viewModeAnchor = screen.getByTestId('anchor-view-mode');
    const innerControl = document.createElement('button');
    innerControl.type = 'button';
    viewModeAnchor.appendChild(innerControl);

    fireEvent.click(screen.getByTestId('safety-task-tour-trigger'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );

    innerControl.focus();
    expect(document.activeElement).toBe(innerControl);

    act(() => {
      viewModeAnchor.hidden = true;
    });

    await waitFor(() => {
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'monitor-enlarge',
      );
      expect(document.activeElement).toBe(screen.getByTestId('safety-task-tour-next'));
    });
  });

  it('shows a compact non-modal first-use invitation when progress is empty and permitted anchors exist, and Start guide opens step 1 without forced modal or auto-submit', async () => {
    const onPageAction = vi.fn();
    render(
      <LocaleProvider defaultLocale="en">
        <div>
          <SafetyTaskTour
            taskId="monitor"
            tourVersion={MONITOR_TOUR_VERSION}
            userId="user-first-use-1"
            scopeKey="scope-first-use:site-1"
            isAuthorized={true}
            steps={MONITOR_TOUR_STEPS}
          />
          <section data-tour-anchor="monitor-scope" data-testid="anchor-scope">
            Scope selector
          </section>
          <button
            type="button"
            data-tour-anchor="monitor-evidence"
            data-testid="anchor-evidence"
            onClick={onPageAction}
          >
            Inspect evidence
          </button>
        </div>
      </LocaleProvider>,
    );

    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();

    const invitation = await screen.findByTestId('safety-task-tour-invitation');
    expect(invitation.getAttribute('role')).not.toBe('dialog');
    expect(invitation.getAttribute('aria-modal')).toBeNull();

    const startBtn = screen.getByTestId('safety-task-tour-invitation-start');
    const skipBtn = screen.getByTestId('safety-task-tour-invitation-skip');
    expect(startBtn.textContent).toBe('Start guide');
    expect(skipBtn.textContent).toBe('Skip');

    fireEvent.click(startBtn);

    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
    const tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('monitor-scope');
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByTestId('safety-task-tour-next'));
    expect(onPageAction).not.toHaveBeenCalled();
    expect(readSafetyTourProgress('user-first-use-1', 'monitor', MONITOR_TOUR_VERSION)).toBeNull();
  });

  it('persists SKIPPED when dismissing the first-use invitation, suppresses future prompts, and keeps manual Replay guide available', async () => {
    const { unmount } = renderMonitorFixture({
      userId: 'user-first-use-skip-1',
      includeSetupAnchor: false,
      locale: 'vi',
    });

    const invitation = await screen.findByTestId('safety-task-tour-invitation');
    expect(invitation).toBeTruthy();
    const trigger = screen.getByTestId('safety-task-tour-trigger');
    expect(trigger.textContent).toBe('Hướng dẫn nhanh');

    const startBtn = screen.getByTestId('safety-task-tour-invitation-start');
    const skipBtn = screen.getByTestId('safety-task-tour-invitation-skip');
    expect(startBtn.textContent).toBe('Bắt đầu hướng dẫn');
    expect(skipBtn.textContent).toBe('Bỏ qua');

    fireEvent.click(skipBtn);

    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
    expect(readSafetyTourProgress('user-first-use-skip-1', 'monitor', MONITOR_TOUR_VERSION)).toBe(
      'SKIPPED',
    );
    expect(trigger.textContent).toBe('Xem lại hướng dẫn');
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });

    // Manual replay still opens the tour from step 1
    fireEvent.click(trigger);
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-scope',
    );
    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();

    unmount();

    // Remounting with prior SKIPPED progress never re-prompts the invitation
    renderMonitorFixture({
      userId: 'user-first-use-skip-1',
      includeSetupAnchor: false,
      locale: 'en',
    });
    expect(screen.getByTestId('safety-task-tour-trigger').textContent).toBe('Replay guide');
    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
  });

  it('never prompts when no authorized anchors exist or scope is unauthorized, and hides the invitation if anchors or permissions are revoked', async () => {
    function DynamicInvitationHarness({
      isAuthorized,
      allowFilter,
      hideFilterDom = false,
    }: {
      isAuthorized: boolean;
      allowFilter: boolean;
      hideFilterDom?: boolean;
    }) {
      const steps = buildAlertsTourSteps({
        hasQueueFilter: allowFilter,
        hasSelectedCase: false,
        canRecordReview: false,
        hasFollowupContext: false,
      });
      return (
        <LocaleProvider defaultLocale="en">
          <div>
            <SafetyTaskTour
              taskId="alerts"
              tourVersion={ALERTS_TOUR_VERSION}
              userId="user-invite-guard-1"
              scopeKey="scope-alerts:guard-1"
              isAuthorized={isAuthorized}
              steps={steps}
            />
            <section
              data-tour-anchor="alerts-queue-filter"
              className={hideFilterDom ? 'sr-only' : ''}
            >
              Queue filter
            </section>
          </div>
        </LocaleProvider>
      );
    }

    const { rerender } = render(
      <DynamicInvitationHarness isAuthorized={false} allowFilter={true} />,
    );
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();

    // Authorized scope, but no permitted steps (allowFilter=false) -> never prompts
    rerender(<DynamicInvitationHarness isAuthorized={true} allowFilter={false} />);
    expect(screen.getByTestId('safety-task-tour-trigger')).toBeTruthy();
    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();

    // Permitted step, but DOM anchor is hidden (.sr-only) -> observed via MutationObserver after commit
    rerender(
      <DynamicInvitationHarness isAuthorized={true} allowFilter={true} hideFilterDom={true} />,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
    });

    // Permitted step and visible DOM anchor -> prompts first-use invitation
    rerender(
      <DynamicInvitationHarness isAuthorized={true} allowFilter={true} hideFilterDom={false} />,
    );
    expect(await screen.findByTestId('safety-task-tour-invitation')).toBeTruthy();

    // Revoking step permission hides the invitation immediately without opening the tour
    rerender(
      <DynamicInvitationHarness isAuthorized={true} allowFilter={false} hideFilterDom={false} />,
    );
    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  });
});
