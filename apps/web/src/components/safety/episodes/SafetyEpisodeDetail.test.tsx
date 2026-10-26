// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  ObservationIdentityDecisionResponse,
  SafetyEpisode,
  SafetyEpisodeEvidenceRef,
} from '@smartsite/contracts';
import i18n from '../../../i18n';
import { SafetyEpisodeDetail } from './SafetyEpisodeDetail';

const baseEvidenceAvailable: SafetyEpisodeEvidenceRef = {
  eventId: '30000000-0000-4000-8000-000000000010',
  personObservationIndex: 3,
  evidenceIndex: 0,
  sha256: 'a'.repeat(64),
  available: true,
};

const baseEvidenceUnavailable: SafetyEpisodeEvidenceRef = {
  eventId: '30000000-0000-4000-8000-000000000010',
  personObservationIndex: 3,
  evidenceIndex: 1,
  sha256: 'b'.repeat(64),
  available: false,
};

const mismatchedPersonEvidenceAvailable: SafetyEpisodeEvidenceRef = {
  eventId: '30000000-0000-4000-8000-000000000010',
  personObservationIndex: 7,
  evidenceIndex: 2,
  sha256: 'd'.repeat(64),
  available: true,
};

function makeEpisode(overrides: Partial<SafetyEpisode> = {}): SafetyEpisode {
  return {
    id: '40000000-0000-4000-8000-000000000003',
    siteId: '10000000-0000-4000-8000-000000000001',
    cameraId: '20000000-0000-4000-8000-000000000001',
    subject: {
      kind: 'EVENT_LOCAL',
      eventId: '30000000-0000-4000-8000-000000000010',
      personObservationIndex: 3,
    },
    configurationBundleId: '60000000-0000-4000-8000-000000000001',
    firstObservedAt: '2026-10-26T01:10:00.000Z',
    lastObservedAt: '2026-10-26T01:12:30.000Z',
    contentRevision: 2,
    collectionState: 'SEALED',
    findingCount: 2,
    identityDecision: null,
    findings: [
      {
        alertId: '50000000-0000-4000-8000-000000000001',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        status: 'CONFIRMED',
        alertRevision: 2,
        zoneId: '80000000-0000-4000-8000-000000000001',
        evidenceRefs: [
          baseEvidenceAvailable,
          baseEvidenceUnavailable,
          mismatchedPersonEvidenceAvailable,
        ],
      },
      {
        alertId: '50000000-0000-4000-8000-000000000002',
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_SAFETY_VEST_MISSING',
        status: 'NEEDS_MORE_EVIDENCE',
        alertRevision: 1,
        zoneId: null,
        evidenceRefs: [],
      },
    ],
    workflowLinks: [
      {
        incidentId: '90000000-0000-4000-8000-000000000001',
        status: 'OPEN',
        actions: [{ actionId: '95000000-0000-4000-8000-000000000001', status: 'IN_PROGRESS' }],
      },
    ],
    ...overrides,
  };
}

function makeIdentityDecision(
  overrides: Partial<ObservationIdentityDecisionResponse> = {},
): ObservationIdentityDecisionResponse {
  return {
    id: '71000000-0000-4000-8000-000000000001',
    revision: 2,
    action: 'CLEAR',
    workerId: null,
    actorUserId: '72000000-0000-4000-8000-000000000001',
    reason: 'Cleared prior manual assignment after frame review',
    scope: 'EXACT_OBSERVATION',
    verificationMethod: 'MANUAL',
    recordedAt: '2026-10-26T01:15:00.000Z',
    subjectRef: {
      eventId: '30000000-0000-4000-8000-000000000010',
      personObservationIndex: 3,
      payloadHash: 'c'.repeat(64),
      cameraId: '20000000-0000-4000-8000-000000000001',
      cameraExternalId: 'CAM-EAST-01',
      streamSessionId: '73000000-0000-4000-8000-000000000001',
      capturedAt: '2026-10-26T01:10:00.000Z',
      trackId: 12,
      personBoundingBox: {
        x1: 0.1,
        y1: 0.1,
        x2: 0.4,
        y2: 0.8,
        coordinateSpace: 'NORMALIZED_0_1',
      },
    },
    evidenceIndex: null,
    evidenceSha256: null,
    ...overrides,
  };
}

describe('SafetyEpisodeDetail (F02 operator-first SafetyEpisode detail)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows operator-first Person in this image header, short SEALED note without amber banner, supplied or fallback contextLabels, and hides array index & UUIDs inside TechnicalDetails', () => {
    const onSelectFinding = vi.fn();
    const episode = makeEpisode();

    const { rerender } = render(
      <SafetyEpisodeDetail
        episode={episode}
        contextLabels={{ site: 'Alpha Construction Site', camera: 'East Gate Camera 01' }}
        onSelectFinding={onSelectFinding}
      />,
    );

    const heading = screen.getByTestId('safety-episode-subject-heading');
    expect(heading.textContent).toBe('Person in this image');

    const collectionNote = screen.getByTestId('safety-episode-collection-note');
    expect(collectionNote.textContent).toBe(
      'Collection stopped; findings still need individual review',
    );
    expect(collectionNote.className).not.toContain('amber');

    expect(screen.getByTestId('safety-episode-site-display').textContent).toBe(
      'Alpha Construction Site',
    );
    expect(screen.getByTestId('safety-episode-camera-display').textContent).toBe(
      'East Gate Camera 01',
    );

    rerender(<SafetyEpisodeDetail episode={episode} onSelectFinding={onSelectFinding} />);
    const context = screen.getByTestId('safety-episode-context');
    expect(screen.getByTestId('safety-episode-site-display').textContent).toBe('Linked site');
    expect(screen.getByTestId('safety-episode-camera-display').textContent).toBe('Linked camera');
    expect(context.textContent).not.toContain(episode.siteId);
    expect(context.textContent).not.toContain(episode.cameraId);
    expect(heading.textContent).not.toContain('3');

    const detailsEl = screen.getByTestId('safety-episode-detail').querySelector('details');
    expect(detailsEl).toBeTruthy();
    expect(detailsEl?.open).toBe(false);
    expect(detailsEl?.textContent).toContain('observations[3]');
    expect(detailsEl?.textContent).toContain(episode.siteId);
    expect(detailsEl?.textContent).toContain(episode.cameraId);
    expect(detailsEl?.textContent).toContain(episode.subject.eventId);

    const findingsPanel = screen.getByTestId('safety-episode-findings-panel');
    expect(within(findingsPanel).getByText('Findings to review (2)')).toBeTruthy();
    expect(within(findingsPanel).getByText('Missing Hard Hat')).toBeTruthy();
    expect(within(findingsPanel).getByText('Missing Safety Vest')).toBeTruthy();

    const hatItem = screen.getByTestId(
      'episode-finding-item-50000000-0000-4000-8000-000000000001',
    );
    const vestItem = screen.getByTestId(
      'episode-finding-item-50000000-0000-4000-8000-000000000002',
    );
    expect(hatItem.textContent).toContain('Confirmed');
    expect(hatItem.textContent).toContain('Linked zone');
    expect(hatItem.textContent).not.toContain('80000000-0000-4000-8000-000000000001');
    expect(vestItem.textContent).toContain('Needs more evidence');
    expect(vestItem.textContent).toContain('No resolved zone');
    expect(screen.queryByRole('button', { name: /confirm all/i })).toBeNull();

    fireEvent.click(
      screen.getByTestId('episode-finding-review-50000000-0000-4000-8000-000000000001'),
    );
    expect(onSelectFinding).toHaveBeenCalledWith('50000000-0000-4000-8000-000000000001');
    fireEvent.click(
      screen.getByTestId('episode-finding-review-50000000-0000-4000-8000-000000000002'),
    );
    expect(onSelectFinding).toHaveBeenCalledWith('50000000-0000-4000-8000-000000000002');
  });

  it('allows clicking only available subject-matching evidence refs, blocks mismatched eventId/personObservationIndex or unavailable refs, and degrades when onRequestEvidence is omitted', () => {
    const onSelectFinding = vi.fn();
    const onRequestEvidence = vi.fn();
    const episode = makeEpisode();

    const { rerender } = render(
      <SafetyEpisodeDetail
        episode={episode}
        onSelectFinding={onSelectFinding}
        onRequestEvidence={onRequestEvidence}
      />,
    );

    const availableBtn = screen.getByTestId(
      'episode-evidence-btn-50000000-0000-4000-8000-000000000001-0',
    );
    expect(availableBtn.textContent).toContain('View evidence #0 · Available');
    fireEvent.click(availableBtn);
    expect(onRequestEvidence).toHaveBeenCalledWith(baseEvidenceAvailable);

    expect(
      screen.queryByTestId('episode-evidence-btn-50000000-0000-4000-8000-000000000001-1'),
    ).toBeNull();
    expect(
      screen.getByTestId('episode-evidence-status-50000000-0000-4000-8000-000000000001-1')
        .textContent,
    ).toContain('Evidence #1 · Unavailable');

    expect(
      screen.queryByTestId('episode-evidence-btn-50000000-0000-4000-8000-000000000001-2'),
    ).toBeNull();
    const unboundSpan = screen.getByTestId(
      'episode-evidence-status-50000000-0000-4000-8000-000000000001-2',
    );
    expect(unboundSpan.tagName).toBe('SPAN');
    expect(unboundSpan.textContent).toContain('Evidence #2 · Unbound subject');

    const vestItem = screen.getByTestId(
      'episode-finding-item-50000000-0000-4000-8000-000000000002',
    );
    expect(vestItem.textContent).toContain('No evidence references recorded for this finding.');

    rerender(<SafetyEpisodeDetail episode={episode} onSelectFinding={onSelectFinding} />);
    expect(
      screen.queryByTestId('episode-evidence-btn-50000000-0000-4000-8000-000000000001-0'),
    ).toBeNull();
    expect(
      screen.getByTestId('episode-evidence-status-50000000-0000-4000-8000-000000000001-0')
        .textContent,
    ).toContain('Evidence #0 · Available');
  });

  it('handles null, CLEAR, mismatched subjectRef, and matching RESOLVE identity decisions cleanly while keeping raw workerId inside TechnicalDetails', () => {
    const onSelectFinding = vi.fn();

    const { rerender } = render(
      <SafetyEpisodeDetail
        episode={makeEpisode({ identityDecision: null })}
        onSelectFinding={onSelectFinding}
      />,
    );
    const identityBadge = screen.getByTestId('safety-episode-identity-badge');
    const identityPanel = screen.getByTestId('safety-episode-identity-panel');
    expect(identityBadge.textContent).toContain('Unknown identity');
    expect(identityPanel.textContent).toContain('Identity not verified — no worker assigned');

    rerender(
      <SafetyEpisodeDetail
        episode={makeEpisode({
          identityDecision: makeIdentityDecision({ action: 'CLEAR', workerId: null, revision: 4 }),
        })}
        onSelectFinding={onSelectFinding}
      />,
    );
    expect(identityBadge.textContent).toContain('Identity cleared');
    expect(identityPanel.textContent).toContain(
      'Prior identity assignment cleared — no worker assigned',
    );

    const mismatchedDecision = makeIdentityDecision({
      action: 'RESOLVE',
      workerId: '70000000-0000-4000-8000-000000000088',
      revision: 5,
      evidenceIndex: 0,
      evidenceSha256: 'a'.repeat(64),
    });
    mismatchedDecision.subjectRef = {
      ...mismatchedDecision.subjectRef,
      personObservationIndex: 9,
    };
    rerender(
      <SafetyEpisodeDetail
        episode={makeEpisode({ identityDecision: mismatchedDecision })}
        onSelectFinding={onSelectFinding}
      />,
    );
    expect(identityBadge.textContent).toContain('Unknown identity');
    expect(screen.getByTestId('safety-episode-detail').textContent).not.toContain(
      '70000000-0000-4000-8000-000000000088',
    );

    rerender(
      <SafetyEpisodeDetail
        episode={makeEpisode({
          identityDecision: makeIdentityDecision({
            action: 'RESOLVE',
            workerId: '70000000-0000-4000-8000-000000000099',
            revision: 3,
            evidenceIndex: 0,
            evidenceSha256: 'a'.repeat(64),
          }),
        })}
        onSelectFinding={onSelectFinding}
      />,
    );
    expect(identityBadge.textContent).toContain('Identity verified');
    expect(identityPanel.textContent).toContain('Verified by manual exact-observation review');
    expect(identityPanel.textContent).not.toContain('70000000-0000-4000-8000-000000000099');
    const detailsEl = screen.getByTestId('safety-episode-detail').querySelector('details');
    expect(detailsEl?.textContent).toContain('Worker ID 70000000-0000-4000-8000-000000000099');
  });

  it('renders Vietnamese localization, wraps long context labels without truncate, and discloses null configurationBundleId in TechnicalDetails', async () => {
    await i18n.changeLanguage('vi');
    const episode = makeEpisode({ configurationBundleId: null });

    render(
      <SafetyEpisodeDetail
        episode={episode}
        contextLabels={{
          site: 'Công trường Tổ hợp Cao tầng Khu Đô thị Phía Đông Phân khu A',
          camera: 'Camera Giám sát Cổng Chính Khu Vực Thi Công Kết Cấu Thép Số 01',
        }}
        onSelectFinding={vi.fn()}
      />,
    );

    const subjectHeading = screen.getByTestId('safety-episode-subject-heading');
    expect(subjectHeading.textContent).toBe('Người trong ảnh này');
    expect(subjectHeading.className).toContain('break-words');
    expect(subjectHeading.className).not.toContain('truncate');
    expect(screen.getByTestId('safety-episode-collection-note').textContent).toBe(
      'Đã dừng thu thập; từng phát hiện vẫn cần duyệt riêng',
    );
    expect(screen.getByText('Thiếu mũ bảo hộ')).toBeTruthy();
    expect(screen.getByText('Thiếu áo phản quang')).toBeTruthy();

    const detailsEl = screen.getByTestId('safety-episode-detail').querySelector('details');
    expect(detailsEl?.textContent).toContain(
      'Gói cấu hình: Ngữ cảnh cũ chưa gắn gói cấu hình (null)',
    );
  });
});
