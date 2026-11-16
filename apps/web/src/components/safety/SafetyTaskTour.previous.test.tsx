// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { SafetyTaskTour } from './SafetyTaskTour';
import { SAFETY_TOUR_STORAGE_KEY, type SafetyTourStepSpec } from './safetyTaskTourModel';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const THREE_STEPS: readonly SafetyTourStepSpec[] = [
  {
    id: 'monitor-scope',
    anchorSelector: '[data-tour-anchor="monitor-scope"]',
    titleKey: 'tour.monitor.scope.title',
    bodyKey: 'tour.monitor.scope.body',
  },
  {
    id: 'monitor-view-mode',
    anchorSelector: '[data-tour-anchor="monitor-view-mode"]',
    titleKey: 'tour.monitor.viewMode.title',
    bodyKey: 'tour.monitor.viewMode.body',
  },
  {
    id: 'monitor-enlarge',
    anchorSelector: '[data-tour-anchor="monitor-enlarge"]',
    titleKey: 'tour.monitor.enlarge.title',
    bodyKey: 'tour.monitor.enlarge.body',
  },
];

describe('SafetyTaskTour previous step navigation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
  });

  it('hides Back on the first step, navigates forward then back with EN/VI labels, and never marks COMPLETED or SKIPPED on Back', async () => {
    render(
      <div>
        <div data-tour-anchor="monitor-scope">Scope Anchor</div>
        <div data-tour-anchor="monitor-view-mode">View Mode Anchor</div>
        <div data-tour-anchor="monitor-enlarge">Enlarge Anchor</div>
        <SafetyTaskTour
          taskId="monitor"
          tourVersion={1}
          userId="officer-1"
          scopeKey="site-a"
          steps={THREE_STEPS}
        />
      </div>,
    );

    fireEvent.click(await screen.findByTestId('safety-task-tour-invitation-start'));

    const tour = await screen.findByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('monitor-scope');
    expect(tour.textContent).toContain('Step 1 of 3');
    expect(screen.queryByTestId('safety-task-tour-back')).toBeNull();

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 2 of 3');
    expect(screen.getByTestId('safety-task-tour-back').textContent).toBe('Back');

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-enlarge',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 3 of 3');
    expect(screen.getByTestId('safety-task-tour-done').textContent).toBe('Done');
    expect(screen.getByTestId('safety-task-tour-back').textContent).toBe('Back');

    fireEvent.click(screen.getByTestId('safety-task-tour-back'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 2 of 3');
    expect(screen.getByTestId('safety-task-tour-next').textContent).toBe('Next');
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('safety-task-tour-back').textContent).toBe('Quay lại');
    expect(screen.getByTestId('safety-task-tour-next').textContent).toBe('Tiếp theo');

    fireEvent.click(screen.getByTestId('safety-task-tour-back'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-scope',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Bước 1 / 3');
    expect(screen.queryByTestId('safety-task-tour-back')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('safety-task-tour-next'));
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();
  });

  it('skips unavailable or unpermitted prior anchors when navigating back and hides Back when no earlier step remains', async () => {
    let allowFirst = false;
    const gatedSteps: readonly SafetyTourStepSpec[] = [
      { ...THREE_STEPS[0]!, isAllowed: () => allowFirst },
      THREE_STEPS[1]!,
      THREE_STEPS[2]!,
    ];

    const view = render(
      <div>
        <div data-testid="anchor-1" data-tour-anchor="monitor-scope">
          Scope Anchor
        </div>
        <div data-testid="anchor-2" data-tour-anchor="monitor-view-mode">
          View Mode Anchor
        </div>
        <div data-testid="anchor-3" data-tour-anchor="monitor-enlarge">
          Enlarge Anchor
        </div>
        <SafetyTaskTour
          taskId="monitor"
          tourVersion={1}
          userId="officer-1"
          scopeKey="site-a"
          steps={gatedSteps}
        />
      </div>,
    );

    // When the first defined step is not permitted, Step 2 is the first visible step and has no Back action
    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 2');
    expect(screen.queryByTestId('safety-task-tour-back')).toBeNull();
    fireEvent.click(screen.getByTestId('safety-task-tour-close'));

    // Re-render with all 3 steps allowed
    allowFirst = true;
    view.rerender(
      <div>
        <div data-testid="anchor-1" data-tour-anchor="monitor-scope">
          Scope Anchor
        </div>
        <div data-testid="anchor-2" data-tour-anchor="monitor-view-mode">
          View Mode Anchor
        </div>
        <div data-testid="anchor-3" data-tour-anchor="monitor-enlarge">
          Enlarge Anchor
        </div>
        <SafetyTaskTour
          taskId="monitor"
          tourVersion={1}
          userId="officer-1"
          scopeKey="site-b"
          steps={[...THREE_STEPS]}
        />
      </div>,
    );

    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-scope',
    );
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-enlarge',
    );

    // Hide middle anchor (Step 2) then click Back -> skips unavailable Step 2 and lands on Step 1
    screen.getByTestId('anchor-2').setAttribute('hidden', '');
    fireEvent.click(screen.getByTestId('safety-task-tour-back'));

    await waitFor(() =>
      expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
        'monitor-scope',
      ),
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 2');
    expect(screen.queryByTestId('safety-task-tour-back')).toBeNull();

    // Restore Step 2, advance to Step 2, then hide Step 1 -> Step 2 becomes first visible step and Back disappears
    screen.getByTestId('anchor-2').removeAttribute('hidden');
    await waitFor(() =>
      expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 3'),
    );
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );
    expect(screen.getByTestId('safety-task-tour-back')).toBeTruthy();

    screen.getByTestId('anchor-1').setAttribute('hidden', '');
    await waitFor(() => expect(screen.queryByTestId('safety-task-tour-back')).toBeNull());
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-view-mode',
    );
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Step 1 of 2');
    expect(document.activeElement).toBe(screen.getByTestId('safety-task-tour-next'));
  });

  it('preserves dismissal, skip, completion storage, and focus return after using Back', async () => {
    render(
      <div>
        <div data-tour-anchor="monitor-scope">Scope Anchor</div>
        <div data-tour-anchor="monitor-view-mode">View Mode Anchor</div>
        <SafetyTaskTour
          taskId="monitor"
          tourVersion={1}
          userId="officer-1"
          scopeKey="site-a"
          steps={THREE_STEPS.slice(0, 2)}
        />
      </div>,
    );

    const trigger = await screen.findByTestId('safety-task-tour-trigger');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-back'));
    fireEvent.click(screen.getByTestId('safety-task-tour-close'));

    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-back'));
    fireEvent.click(screen.getByTestId('safety-task-tour-skip'));

    expect(
      JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}')[
        'officer-1:monitor:v1'
      ],
    ).toEqual({
      status: 'SKIPPED',
      tourVersion: 1,
    });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-back'));
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    fireEvent.click(screen.getByTestId('safety-task-tour-done'));

    expect(
      JSON.parse(window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}')[
        'officer-1:monitor:v1'
      ],
    ).toEqual({
      status: 'COMPLETED',
      tourVersion: 1,
    });
  });
});
