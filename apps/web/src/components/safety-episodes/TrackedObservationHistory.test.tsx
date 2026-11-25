// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackedEpisodeOriginalObservation } from '@smartsite/contracts/tracked-episode-frames';
import i18n from '../../i18n';
import {
  TrackedObservationHistory,
  type TrackedObservationHistoryProps,
} from './TrackedObservationHistory';

const SHARED_EVENT_FRAMES: TrackedEpisodeOriginalObservation['frames'] = [
  {
    evidenceIndex: 0,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  {
    evidenceIndex: 1,
    sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  },
];

const OBSERVATION_A_HELMET_FINDING: TrackedEpisodeOriginalObservation = {
  alertId: 'aaaa1111-1111-4111-8111-111111111111',
  eventId: '44444444-4444-4444-8444-444444444444',
  personObservationIndex: 0,
  payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  sourceSequence: '18446744073709551614',
  capturedAt: '2026-11-01T10:15:30.000Z',
  observationIndexes: [1, 3],
  frames: SHARED_EVENT_FRAMES,
};

// Legitimate repeated event row: the same immutable event and PERSON slot (0)
// supplies a second finding (e.g. missing safety vest) with identical event header/hash/frames.
const OBSERVATION_B_SAME_EVENT_VEST_FINDING: TrackedEpisodeOriginalObservation = {
  alertId: 'bbbb2222-2222-4222-8222-222222222222',
  eventId: '44444444-4444-4444-8444-444444444444',
  personObservationIndex: 0,
  payloadHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  sourceSequence: '18446744073709551614',
  capturedAt: '2026-11-01T10:15:30.000Z',
  observationIndexes: [2],
  frames: SHARED_EVENT_FRAMES,
};

// Separate event in the episode where the detector assigned original PERSON index 2
// and real PPE observation indexes [1, 4] (excluding personObservationIndex 2).
const OBSERVATION_C_SEPARATE_EVENT_OTHER_PERSON_SLOT: TrackedEpisodeOriginalObservation = {
  alertId: 'aaaa1111-1111-4111-8111-111111111111',
  eventId: '55555555-5555-4555-8555-555555555555',
  personObservationIndex: 2,
  payloadHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  sourceSequence: '18446744073709551615',
  capturedAt: '2026-11-01T10:16:00.000Z',
  observationIndexes: [1, 4],
  frames: [
    {
      evidenceIndex: 4,
      sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
  ],
};

function buildProps(
  overrides: Partial<TrackedObservationHistoryProps> = {},
): TrackedObservationHistoryProps {
  return {
    scopeKey: 'site-1:episode-1:all',
    items: [OBSERVATION_A_HELMET_FINDING, OBSERVATION_B_SAME_EVENT_VEST_FINDING],
    total: 2,
    hasMore: false,
    status: 'READY',
    isLoadingMore: false,
    loadMoreError: null,
    onLoadMore: vi.fn(),
    onRetry: vi.fn(),
    onOpenSource: vi.fn(),
    ...overrides,
  };
}

describe('TrackedObservationHistory', () => {
  beforeEach(() => {
    window.localStorage.clear();
    void i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('hides stale rows during LOADING, ERROR, and FORBIDDEN states and shows explicit non-all-clear READY empty state', async () => {
    const onRetry = vi.fn();
    const onOpenSource = vi.fn();
    const { rerender } = render(
      <TrackedObservationHistory {...buildProps({ onRetry, onOpenSource })} />,
    );

    expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);

    // Pending / LOADING must hide previously rendered rows even if stale items prop is still passed
    rerender(
      <TrackedObservationHistory {...buildProps({ status: 'LOADING', onRetry, onOpenSource })} />,
    );
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);
    expect(screen.getByTestId('tracked-history-loading').getAttribute('role')).toBe('status');

    // Initial ERROR must hide stale rows and trigger onRetry only on explicit click
    rerender(
      <TrackedObservationHistory {...buildProps({ status: 'ERROR', onRetry, onOpenSource })} />,
    );
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);
    const errorBox = screen.getByTestId('tracked-history-error');
    expect(errorBox.getAttribute('role')).toBe('alert');
    expect(onRetry).not.toHaveBeenCalled();
    fireEvent.click(within(errorBox).getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // FORBIDDEN must hide stale rows
    rerender(
      <TrackedObservationHistory {...buildProps({ status: 'FORBIDDEN', onRetry, onOpenSource })} />,
    );
    expect(screen.queryAllByTestId('tracked-history-item')).toHaveLength(0);
    expect(screen.getByTestId('tracked-history-forbidden').getAttribute('role')).toBe('alert');

    // READY empty must state no matching saved observations, never claiming "all clear" or "compliant"
    rerender(
      <TrackedObservationHistory
        {...buildProps({ status: 'READY', items: [], total: 0, onRetry, onOpenSource })}
      />,
    );
    const emptyBox = screen.getByTestId('tracked-history-empty');
    expect(emptyBox.textContent).toContain('No matching saved original observations');
    expect(emptyBox.textContent).not.toMatch(/all clear|compliant|no violations/i);

    await act(async () => {
      void i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('tracked-history-empty').textContent).toContain(
      'Chưa có quan sát gốc đã lưu nào khớp với phạm vi này.',
    );
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it('invokes onOpenSource with exact source and FRAME vs SUBJECT representation only on explicit user clicks', () => {
    const onOpenSource = vi.fn();
    const onLoadMore = vi.fn();
    const onRetry = vi.fn();

    render(
      <TrackedObservationHistory
        {...buildProps({
          items: [
            OBSERVATION_A_HELMET_FINDING,
            OBSERVATION_B_SAME_EVENT_VEST_FINDING,
            OBSERVATION_C_SEPARATE_EVENT_OTHER_PERSON_SLOT,
          ],
          total: 3,
          onOpenSource,
          onLoadMore,
          onRetry,
        })}
      />,
    );

    // Never auto-opens first item or fires callbacks on mount
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(onLoadMore).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();

    // Clarifies SHA-256 bound descriptors and mechanical PERSON crop disclaimer
    const section = screen.getByTestId('tracked-observation-history');
    expect(section.textContent).toContain('SHA-256 bound');
    expect(section.textContent).toContain('never a verified Worker identity');

    const rows = screen.getAllByTestId('tracked-history-item');
    const firstRow = rows[0]!;
    const secondRowSameEventOtherFinding = rows[1]!;
    const thirdRowSeparateEventOtherPerson = rows[2]!;

    const fullFrameBtn0 = within(firstRow).getByRole('button', { name: 'Full FRAME #0' });
    const personCropBtn1 = within(firstRow).getByRole('button', {
      name: 'Mechanical PERSON crop #1',
    });
    const secondRowVestCropBtn0 = within(secondRowSameEventOtherFinding).getByRole('button', {
      name: 'Mechanical PERSON crop #0',
    });
    const thirdRowCropBtn4 = within(thirdRowSeparateEventOtherPerson).getByRole('button', {
      name: 'Mechanical PERSON crop #4',
    });

    expect(fullFrameBtn0.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(fullFrameBtn0);

    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onOpenSource).toHaveBeenLastCalledWith(
      {
        alertId: 'aaaa1111-1111-4111-8111-111111111111',
        eventId: '44444444-4444-4444-8444-444444444444',
        personObservationIndex: 0,
        evidenceIndex: 0,
      },
      'FRAME',
    );
    expect(fullFrameBtn0.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(personCropBtn1);
    expect(onOpenSource).toHaveBeenCalledTimes(2);
    expect(onOpenSource).toHaveBeenLastCalledWith(
      {
        alertId: 'aaaa1111-1111-4111-8111-111111111111',
        eventId: '44444444-4444-4444-8444-444444444444',
        personObservationIndex: 0,
        evidenceIndex: 1,
      },
      'SUBJECT',
    );
    expect(fullFrameBtn0.getAttribute('aria-pressed')).toBe('false');
    expect(personCropBtn1.getAttribute('aria-pressed')).toBe('true');

    // Clicking the same eventId + personObservationIndex + evidenceIndex under the second finding (alertId bbbb2222...)
    fireEvent.click(secondRowVestCropBtn0);
    expect(onOpenSource).toHaveBeenCalledTimes(3);
    expect(onOpenSource).toHaveBeenLastCalledWith(
      {
        alertId: 'bbbb2222-2222-4222-8222-222222222222',
        eventId: '44444444-4444-4444-8444-444444444444',
        personObservationIndex: 0,
        evidenceIndex: 0,
      },
      'SUBJECT',
    );
    expect(personCropBtn1.getAttribute('aria-pressed')).toBe('false');
    expect(secondRowVestCropBtn0.getAttribute('aria-pressed')).toBe('true');

    // Clicking the separate eventId with personObservationIndex 2 and evidenceIndex 4
    fireEvent.click(thirdRowCropBtn4);
    expect(onOpenSource).toHaveBeenCalledTimes(4);
    expect(onOpenSource).toHaveBeenLastCalledWith(
      {
        alertId: 'aaaa1111-1111-4111-8111-111111111111',
        eventId: '55555555-5555-4555-8555-555555555555',
        personObservationIndex: 2,
        evidenceIndex: 4,
      },
      'SUBJECT',
    );
  });

  it('resets local selection and technical disclosure state when scopeKey changes without firing callbacks', () => {
    const onOpenSource = vi.fn();
    const { rerender } = render(
      <TrackedObservationHistory
        {...buildProps({ scopeKey: 'site-1:episode-1:finding-a', onOpenSource })}
      />,
    );

    const firstRow = screen.getAllByTestId('tracked-history-item')[0]!;
    const toggleBtn = within(firstRow).getByRole('button', { name: /show technical details/i });
    const cropBtn = within(firstRow).getByRole('button', { name: 'Mechanical PERSON crop #0' });

    fireEvent.click(toggleBtn);
    fireEvent.click(cropBtn);

    expect(screen.getByTestId('tracked-history-technical')).toBeTruthy();
    expect(screen.getByTestId('tracked-history-selected-source')).toBeTruthy();
    expect(cropBtn.getAttribute('aria-pressed')).toBe('true');
    expect(onOpenSource).toHaveBeenCalledTimes(1);

    // Changing scopeKey must clear local disclosure and selection state without triggering callbacks
    rerender(
      <TrackedObservationHistory
        {...buildProps({ scopeKey: 'site-1:episode-1:finding-b', onOpenSource })}
      />,
    );

    expect(screen.queryByTestId('tracked-history-technical')).toBeNull();
    expect(screen.queryByTestId('tracked-history-selected-source')).toBeNull();
    const updatedFirstRow = screen.getAllByTestId('tracked-history-item')[0]!;
    expect(
      within(updatedFirstRow)
        .getByRole('button', { name: 'Mechanical PERSON crop #0' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    expect(
      within(updatedFirstRow)
        .getByRole('button', { name: /show technical details/i })
        .getAttribute('aria-expanded'),
    ).toBe('false');
    expect(onOpenSource).toHaveBeenCalledTimes(1);
  });

  it('retains authorized rows on next-page error, truthfully preserves latest server total even when lower than loaded rows (loaded 2, total 1), and disables duplicate calls while isLoadingMore is true', async () => {
    const onLoadMore = vi.fn();
    const onRetry = vi.fn();

    const { rerender } = render(
      <TrackedObservationHistory
        {...buildProps({
          total: 5,
          hasMore: true,
          isLoadingMore: false,
          loadMoreError: 'Upstream timeout',
          onLoadMore,
          onRetry,
        })}
      />,
    );

    // Authorized rows remain visible and no empty-state claim is shown
    expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);
    expect(screen.queryByTestId('tracked-history-empty')).toBeNull();
    expect(screen.getByTestId('tracked-history-count').textContent).toBe(
      'Loaded rows: 2 · Latest server total: 5',
    );

    // Regression: when accumulated loaded rows (2) exceed latest server total (1),
    // preserve both loaded rows and report Latest server total: 1 truthfully without raising it to 2.
    rerender(
      <TrackedObservationHistory
        {...buildProps({
          total: 1,
          hasMore: true,
          isLoadingMore: false,
          loadMoreError: 'Upstream timeout',
          onLoadMore,
          onRetry,
        })}
      />,
    );
    expect(screen.getAllByTestId('tracked-history-item')).toHaveLength(2);
    expect(screen.getByTestId('tracked-history-count').textContent).toBe(
      'Loaded rows: 2 · Latest server total: 1',
    );

    await act(async () => {
      void i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('tracked-history-count').textContent).toBe(
      'Số dòng đã tải: 2 · Tổng máy chủ mới nhất: 1',
    );
    await act(async () => {
      void i18n.changeLanguage('en');
    });

    const loadMoreErrorAlert = screen.getByTestId('tracked-history-load-more-error');
    expect(loadMoreErrorAlert.getAttribute('role')).toBe('alert');
    expect(loadMoreErrorAlert.textContent).toContain('Upstream timeout');

    const retryNextBtn = within(loadMoreErrorAlert).getByRole('button', {
      name: /retry loading more/i,
    });
    fireEvent.click(retryNextBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);

    const loadMoreBtn = screen.getByTestId('tracked-history-load-more');
    fireEvent.click(loadMoreBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // While isLoadingMore is true, both Load More and Retry Loading More are disabled
    rerender(
      <TrackedObservationHistory
        {...buildProps({
          total: 1,
          hasMore: true,
          isLoadingMore: true,
          loadMoreError: 'Upstream timeout',
          onLoadMore,
          onRetry,
        })}
      />,
    );

    const disabledLoadMore = screen.getByTestId('tracked-history-load-more') as HTMLButtonElement;
    const disabledRetry = within(screen.getByTestId('tracked-history-load-more-error')).getByRole(
      'button',
      { name: /retry loading more/i },
    ) as HTMLButtonElement;

    expect(disabledLoadMore.disabled).toBe(true);
    expect(disabledRetry.disabled).toBe(true);

    fireEvent.click(disabledLoadMore);
    fireEvent.click(disabledRetry);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('preserves legitimate repeated event rows across findings without event-only deduplication, separates distinct event/PERSON observations, and wraps technical hashes and uint64 sequences', () => {
    render(
      <TrackedObservationHistory
        {...buildProps({
          items: [
            OBSERVATION_A_HELMET_FINDING,
            OBSERVATION_B_SAME_EVENT_VEST_FINDING,
            OBSERVATION_C_SEPARATE_EVENT_OTHER_PERSON_SLOT,
          ],
          total: 3,
        })}
      />,
    );

    const rows = screen.getAllByTestId('tracked-history-item');
    expect(rows).toHaveLength(3);
    // Rows 0 and 1 are the same immutable event (44444444) and PERSON #0 for two different findings
    expect(rows[0]!.textContent).toContain('Original PERSON #0');
    expect(rows[0]!.textContent).toContain('Event 44444444');
    expect(rows[0]!.textContent).toContain('Finding aaaa1111');
    expect(rows[1]!.textContent).toContain('Original PERSON #0');
    expect(rows[1]!.textContent).toContain('Event 44444444');
    expect(rows[1]!.textContent).toContain('Finding bbbb2222');
    // Row 2 is a separate event (55555555) where the original PERSON slot is #2
    expect(rows[2]!.textContent).toContain('Original PERSON #2');
    expect(rows[2]!.textContent).toContain('Event 55555555');
    expect(rows[2]!.textContent).toContain('Finding aaaa1111');

    // Disclose technical details on row 0 and verify wrapping markup, real PPE observationIndexes [1, 3], and exact uint64 sequence
    fireEvent.click(within(rows[0]!).getByRole('button', { name: /show technical details/i }));

    const techPanel = within(rows[0]!).getByTestId('tracked-history-technical');
    expect(techPanel.textContent).toContain('Original PPE observations (2)');
    expect(techPanel.textContent).toContain('1, 3');
    expect(techPanel.textContent).toContain('18446744073709551614');
    expect(techPanel.textContent).toContain(OBSERVATION_A_HELMET_FINDING.alertId);
    expect(techPanel.textContent).toContain(OBSERVATION_A_HELMET_FINDING.eventId);
    expect(techPanel.textContent).toContain(OBSERVATION_A_HELMET_FINDING.payloadHash);
    expect(techPanel.textContent).toContain(OBSERVATION_A_HELMET_FINDING.frames[0]!.sha256);

    const descriptions = techPanel.querySelectorAll('dd');
    expect(descriptions.length).toBeGreaterThanOrEqual(7);
    for (const dd of descriptions) {
      expect(dd.className).toContain('break-all');
      expect(dd.className).toContain('font-mono');
    }
  });

  it('omits observed PPE section gracefully when absent or empty, renders all 8 catalog labels concisely with non-compliance boundary note for Harness/Hook PRESENT, and collapses contradictory same-family states to Unclear/Không rõ', async () => {
    const legacyAbsentItem: TrackedEpisodeOriginalObservation = {
      ...OBSERVATION_A_HELMET_FINDING,
    };
    const emptyObservedItem: TrackedEpisodeOriginalObservation = {
      ...OBSERVATION_B_SAME_EVENT_VEST_FINDING,
      observedPpe: [],
    };
    const allEightItems: TrackedEpisodeOriginalObservation = {
      ...OBSERVATION_C_SEPARATE_EVENT_OTHER_PERSON_SLOT,
      observedPpe: [
        { ppeItem: 'LANYARD_HOOK', status: 'PRESENT' },
        { ppeItem: 'HARD_HAT', status: 'MISSING' },
        { ppeItem: 'FULL_BODY_HARNESS', status: 'PRESENT' },
        { ppeItem: 'MASK', status: 'PRESENT' },
        { ppeItem: 'SAFETY_VEST', status: 'PRESENT' },
        { ppeItem: 'GLOVES', status: 'MISSING' },
        { ppeItem: 'BOOTS', status: 'PRESENT' },
        { ppeItem: 'GOGGLES', status: 'PRESENT' },
      ],
    };
    const contradictoryItem: TrackedEpisodeOriginalObservation = {
      alertId: 'cccc3333-3333-4333-8333-333333333333',
      eventId: '66666666-6666-4666-8666-666666666666',
      personObservationIndex: 1,
      payloadHash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      sourceSequence: '18446744073709551613',
      capturedAt: '2026-11-01T10:16:30.000Z',
      observationIndexes: [2],
      frames: SHARED_EVENT_FRAMES,
      observedPpe: [
        { ppeItem: 'HARD_HAT', status: 'PRESENT' },
        { ppeItem: 'HARD_HAT', status: 'MISSING' },
        { ppeItem: 'SAFETY_VEST', status: 'PRESENT' },
      ],
    };

    render(
      <TrackedObservationHistory
        {...buildProps({
          items: [legacyAbsentItem, emptyObservedItem, allEightItems, contradictoryItem],
          total: 4,
        })}
      />,
    );

    const rows = screen.getAllByTestId('tracked-history-item');
    expect(rows).toHaveLength(4);

    // 1. Legacy absent and empty observedPpe omit the section cleanly
    expect(within(rows[0]!).queryByTestId('tracked-history-observed-ppe')).toBeNull();
    expect(within(rows[1]!).queryByTestId('tracked-history-observed-ppe')).toBeNull();

    // 2. All 8 catalog labels rendered in deterministic PPE_FAMILY_CATALOG order with Harness/Hook non-compliance note
    const allEightBox = within(rows[2]!).getByTestId('tracked-history-observed-ppe');
    const chips = within(allEightBox).getAllByTestId(/^tracked-history-observed-ppe-chip-/);
    expect(chips.map((el) => el.getAttribute('data-testid'))).toEqual([
      'tracked-history-observed-ppe-chip-HARD_HAT',
      'tracked-history-observed-ppe-chip-SAFETY_VEST',
      'tracked-history-observed-ppe-chip-GLOVES',
      'tracked-history-observed-ppe-chip-BOOTS',
      'tracked-history-observed-ppe-chip-GOGGLES',
      'tracked-history-observed-ppe-chip-MASK',
      'tracked-history-observed-ppe-chip-FULL_BODY_HARNESS',
      'tracked-history-observed-ppe-chip-LANYARD_HOOK',
    ]);
    expect(chips[0]!.textContent).toContain('Hard Hat / Helmet');
    expect(chips[0]!.textContent).toContain('Missing');
    expect(chips[1]!.textContent).toContain('Safety Vest');
    expect(chips[1]!.textContent).toContain('Observed');
    expect(chips[2]!.textContent).toContain('Gloves');
    expect(chips[2]!.textContent).toContain('Missing');
    expect(chips[3]!.textContent).toContain('Boots');
    expect(chips[4]!.textContent).toContain('Goggles');
    expect(chips[5]!.textContent).toContain('Mask');
    expect(chips[6]!.textContent).toContain('Full-body harness');
    expect(chips[6]!.textContent).toContain('Observed');
    expect(chips[7]!.textContent).toContain('Lanyard hook');
    expect(chips[7]!.textContent).toContain('Observed');
    const harnessNote = within(allEightBox).getByTestId('tracked-history-observed-ppe-note');
    expect(harnessNote.textContent).toMatch(/frame visibility only|does not confirm/i);
    expect(allEightBox.textContent).not.toMatch(/\b(compliant|safe to work|all clear)\b/i);

    // 3. Contradictory same-family (PRESENT + MISSING) collapses to a single Unclear badge; no Harness note when Harness/Hook absent
    const contradictoryBox = within(rows[3]!).getByTestId('tracked-history-observed-ppe');
    const hardHatChips = within(contradictoryBox).getAllByTestId(
      'tracked-history-observed-ppe-chip-HARD_HAT',
    );
    expect(hardHatChips).toHaveLength(1);
    expect(hardHatChips[0]!.textContent).toContain('Hard Hat / Helmet');
    expect(hardHatChips[0]!.textContent).toContain('Unclear');
    expect(hardHatChips[0]!.textContent).not.toContain('Observed');
    expect(hardHatChips[0]!.textContent).not.toContain('Missing');
    expect(within(contradictoryBox).queryByTestId('tracked-history-observed-ppe-note')).toBeNull();

    // 4. Vietnamese labels + Không rõ for contradictory family
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(
      within(allEightBox).getByTestId('tracked-history-observed-ppe-chip-FULL_BODY_HARNESS')
        .textContent,
    ).toContain('Dây đai an toàn toàn thân');
    expect(
      within(allEightBox).getByTestId('tracked-history-observed-ppe-chip-LANYARD_HOOK').textContent,
    ).toContain('Móc dây an toàn');
    expect(
      within(allEightBox).getByTestId('tracked-history-observed-ppe-chip-MASK').textContent,
    ).toContain('Khẩu trang');
    expect(
      within(contradictoryBox).getByTestId('tracked-history-observed-ppe-chip-HARD_HAT')
        .textContent,
    ).toContain('Không rõ');
  });
});
