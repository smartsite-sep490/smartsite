// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import { setSharedRuntimeLocale } from '../../i18n/locale-context';
import {
  CameraRegionCandidateReviewPanel,
  CameraRegionReferenceStatusCard,
} from './CameraRegionReferenceControls';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

function buildReference(
  overrides: Partial<Omit<CameraConfigurationReference, 'frame' | 'image'>> = {},
  frameOverrides: Partial<CameraConfigurationReference['frame']> = {},
): CameraConfigurationReference {
  return {
    schemaVersion: 1,
    siteId: 'site-alpha',
    cameraId: 'cam-1',
    purpose: 'REGION_CONFIGURATION',
    configurationVersion: 3,
    sourceKind: 'LIVE',
    referenceExpiresAt: '2026-10-25T09:05:00.000Z',
    ...overrides,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-EXT-01',
      capturedAt: '2026-10-25T09:00:00.000Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      imageSha256: 'a'.repeat(64),
      ...frameOverrides,
    },
    image: {} as HTMLImageElement,
  };
}

describe('CameraRegionReferenceControls', () => {
  beforeEach(() => {
    setSharedRuntimeLocale('en');
  });

  afterEach(() => {
    cleanup();
    setSharedRuntimeLocale('en');
    vi.restoreAllMocks();
  });

  it('renders concise active reference status and action while tucking purpose note and timestamps behind an accessible details disclosure in EN and VI', () => {
    const onRequestReference = vi.fn();
    const reference = buildReference({
      sourceKind: 'LIVE',
      configurationVersion: 3,
    });

    const { container, rerender } = render(
      <CameraRegionReferenceStatusCard
        reference={reference}
        isExpired={false}
        expectedConfigurationVersion={3}
        isLoading={false}
        error={null}
        canRequest
        isDrawingActive={false}
        onRequestReference={onRequestReference}
      />,
    );

    expect(screen.getByText('Authoring Reference Image')).toBeTruthy();
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(screen.getByText('Config v3')).toBeTruthy();

    const getBtn = screen.getByRole('button', { name: 'Get configuration image' });
    expect((getBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(getBtn);
    expect(onRequestReference).toHaveBeenCalledTimes(1);

    const details = screen.getByTestId('reference-status-details') as HTMLDetailsElement;
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.className).toContain('group/ref-details');

    const summary = within(details).getByText('Reference details & timestamps').closest('summary');
    expect(summary).toBeTruthy();
    fireEvent.click(summary!);
    expect(details.open).toBe(true);

    expect(
      within(details).getByText(
        /Obtains a frozen camera frame for region authoring only\. Does not run AI inference/i,
      ),
    ).toBeTruthy();
    const capturedEl = within(details).getByText('Captured: 2026-10-25T09:00:00.000Z');
    const expiresEl = within(details).getByText('Expires: 2026-10-25T09:05:00.000Z');
    expect(capturedEl.className).toContain('break-all');
    expect(expiresEl.className).toContain('break-all');

    expect(container.textContent).not.toMatch(/worker applied|camera moved/i);

    // Switch to drawing active + loading state and verify button labels and disabled guards
    rerender(
      <CameraRegionReferenceStatusCard
        reference={reference}
        isExpired={false}
        expectedConfigurationVersion={3}
        isLoading
        error={null}
        canRequest
        isDrawingActive
        onRequestReference={onRequestReference}
      />,
    );

    const loadingCandidateBtn = screen.getByRole('button', { name: 'Review new reference' });
    expect((loadingCandidateBtn as HTMLButtonElement).disabled).toBe(true);
    expect(loadingCandidateBtn.textContent).toBe('Loading new reference…');

    // Switch to Vietnamese and verify localized labels
    act(() => {
      setSharedRuntimeLocale('vi');
    });

    rerender(
      <CameraRegionReferenceStatusCard
        reference={buildReference({ sourceKind: 'REPLAY', configurationVersion: 5 })}
        isExpired={false}
        expectedConfigurationVersion={5}
        isLoading={false}
        error={null}
        canRequest={false}
        isDrawingActive={false}
        onRequestReference={onRequestReference}
      />,
    );

    expect(screen.getByText('Ảnh tham chiếu cấu hình vùng quan sát')).toBeTruthy();
    expect(screen.getByText('REPLAY')).toBeTruthy();
    expect(screen.getByText('Cấu hình v5')).toBeTruthy();
    expect(within(details).getByText('Chi tiết & thời gian ảnh tham chiếu')).toBeTruthy();
    const viGetBtn = screen.getByRole('button', { name: 'Lấy ảnh cấu hình' });
    expect((viGetBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps noneLoadedHint, EXPIRED badge/hint, revisionChangedHint, and safe ApiError alerts immediately visible outside details', () => {
    const onRequestReference = vi.fn();

    // 1. None loaded hint
    const { rerender } = render(
      <CameraRegionReferenceStatusCard
        reference={null}
        isExpired={false}
        expectedConfigurationVersion={3}
        isLoading={false}
        error={null}
        canRequest
        isDrawingActive={false}
        onRequestReference={onRequestReference}
      />,
    );

    const details = screen.getByTestId('reference-status-details') as HTMLDetailsElement;
    expect(details.open).toBe(false);

    const noneHint = screen.getByText(
      'Request a configuration image for the selected active camera before drawing or editing a region.',
    );
    expect(details.contains(noneHint)).toBe(false);

    // 2. Expired reference: Expired badge + expiredHint immediately visible outside details
    rerender(
      <CameraRegionReferenceStatusCard
        reference={buildReference({ configurationVersion: 3 })}
        isExpired
        expectedConfigurationVersion={3}
        isLoading={false}
        error={null}
        canRequest
        isDrawingActive={false}
        onRequestReference={onRequestReference}
      />,
    );

    const expiredBadge = screen.getByText('Expired');
    const expiredHint = screen.getByText(
      'The configuration reference image has expired. Request a fresh configuration image to continue.',
    );
    expect(details.contains(expiredBadge)).toBe(false);
    expect(details.contains(expiredHint)).toBe(false);

    // 3. Revision mismatch: revisionChangedHint immediately visible outside details
    rerender(
      <CameraRegionReferenceStatusCard
        reference={buildReference({ configurationVersion: 3 })}
        isExpired={false}
        expectedConfigurationVersion={4}
        isLoading={false}
        error={null}
        canRequest
        isDrawingActive={false}
        onRequestReference={onRequestReference}
      />,
    );

    const revisionHint = screen.getByText(
      'Camera configuration changed (now v4). Request a fresh configuration image to continue.',
    );
    expect(details.contains(revisionHint)).toBe(false);

    // 4. Safe ApiError alert (503) immediately visible outside details and never leaks raw token/trace
    rerender(
      <CameraRegionReferenceStatusCard
        reference={null}
        isExpired={false}
        expectedConfigurationVersion={4}
        isLoading={false}
        error={new ApiError('http', 'Internal trace secret-token-xyz', 503)}
        canRequest
        isDrawingActive={false}
        onRequestReference={onRequestReference}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(details.contains(alert)).toBe(false);
    expect(alert.textContent).toContain(
      'Camera configuration image source is currently unavailable. Verify that the capture observer is active and try again.',
    );
    expect(alert.textContent).not.toContain('secret-token-xyz');
  });

  it('renders candidate review SVG geometry, handles candidate expiry, and prioritizes accept over cancel with exact disabled guards', () => {
    const onAcceptCandidate = vi.fn();
    const onCancelReview = vi.fn();
    const candidateReference = buildReference({
      sourceKind: 'REPLAY',
      configurationVersion: 4,
    });

    const { rerender } = render(
      <CameraRegionCandidateReviewPanel
        candidateReference={candidateReference}
        isCandidateExpired={false}
        draftPoints={[
          [0.1, 0.1],
          [0.5, 0.1],
        ]}
        isSaving={false}
        onAcceptCandidate={onAcceptCandidate}
        onCancelReview={onCancelReview}
      />,
    );

    const region = screen.getByRole('region', { name: 'Review Candidate Reference Image' });
    expect(region).toBeTruthy();
    expect(within(region).getByText('REPLAY')).toBeTruthy();
    expect(within(region).getByText('v4')).toBeTruthy();

    const candidateDetails = screen.getByTestId(
      'candidate-reference-details',
    ) as HTMLDetailsElement;
    expect(candidateDetails.open).toBe(false);
    expect(candidateDetails.className).toContain('group/candidate-details');
    expect(within(candidateDetails).getByText('Captured: 2026-10-25T09:00:00.000Z')).toBeTruthy();
    expect(within(candidateDetails).getByText('Expires: 2026-10-25T09:05:00.000Z')).toBeTruthy();

    // 2-point draft renders dashed open polyline + 2 circles
    const svg = screen.getByLabelText('Candidate Reference Preview Canvas');
    expect(svg.getAttribute('viewBox')).toBe('0 0 640 480');
    const image = svg.querySelector('image');
    expect(image?.getAttribute('href')).toBe('data:image/jpeg;base64,/9j/2Q==');
    const polyline2 = svg.querySelector('polyline');
    expect(polyline2?.getAttribute('points')).toBe('64,48 320,48');
    expect(polyline2?.getAttribute('fill')).toBe('none');
    expect(polyline2?.getAttribute('stroke-dasharray')).toBe('4 2');
    expect(svg.querySelectorAll('circle')).toHaveLength(2);

    // 3-point draft renders filled closed polyline + 3 circles
    rerender(
      <CameraRegionCandidateReviewPanel
        candidateReference={candidateReference}
        isCandidateExpired={false}
        draftPoints={[
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ]}
        isSaving={false}
        onAcceptCandidate={onAcceptCandidate}
        onCancelReview={onCancelReview}
      />,
    );

    const polyline3 = screen
      .getByLabelText('Candidate Reference Preview Canvas')
      .querySelector('polyline');
    expect(polyline3?.getAttribute('fill')).toBe('rgba(59, 130, 246, 0.25)');
    expect(polyline3?.getAttribute('stroke-dasharray')).toBe('none');

    // Action button priority and callbacks
    const acceptBtn = screen.getByRole('button', { name: 'Use new reference' });
    const cancelBtn = screen.getByRole('button', { name: 'Keep current reference' });
    expect(acceptBtn.getAttribute('data-control-priority')).toBe('primary');
    expect(cancelBtn.getAttribute('data-control-priority')).toBe('subordinate');
    expect(acceptBtn.className).toContain('bg-[#0F172A]');
    expect(cancelBtn.className).toContain('bg-white');

    fireEvent.click(acceptBtn);
    expect(onAcceptCandidate).toHaveBeenCalledTimes(1);
    fireEvent.click(cancelBtn);
    expect(onCancelReview).toHaveBeenCalledTimes(1);

    // Candidate expired: hides SVG/image, shows expired notice & badge, disables accept while keeping cancel enabled
    rerender(
      <CameraRegionCandidateReviewPanel
        candidateReference={candidateReference}
        isCandidateExpired
        draftPoints={[
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ]}
        isSaving={false}
        onAcceptCandidate={onAcceptCandidate}
        onCancelReview={onCancelReview}
      />,
    );

    expect(screen.queryByLabelText('Candidate Reference Preview Canvas')).toBeNull();
    expect(
      screen.getByText(
        'Candidate reference image has expired. Request another reference image to review.',
      ),
    ).toBeTruthy();
    expect(within(region).getByText('Expired')).toBeTruthy();
    expect((acceptBtn as HTMLButtonElement).disabled).toBe(true);
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(false);

    // Saving state disables both accept and cancel buttons
    rerender(
      <CameraRegionCandidateReviewPanel
        candidateReference={candidateReference}
        isCandidateExpired={false}
        draftPoints={[
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ]}
        isSaving
        onAcceptCandidate={onAcceptCandidate}
        onCancelReview={onCancelReview}
      />,
    );

    expect((acceptBtn as HTMLButtonElement).disabled).toBe(true);
    expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
