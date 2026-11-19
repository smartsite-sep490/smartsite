// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import i18n from '../../i18n';
import { SAFETY_TOUR_STORAGE_KEY } from '../safety/safetyTaskTourModel';
import { CameraRegionSelectionControls } from './CameraRegionSelectionControls';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';
import { ZonePpeCameraRegionDrawer } from './ZonePpeCameraRegionDrawer';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const API_URL = 'https://api.smartsite.local';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_1: CameraResponse = {
  type: 'ZONE' as const,
  gateId: null,
  id: '22222222-2222-4222-8222-222222222201',
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Gate Camera',
  externalId: 'prov-source-north-01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-03-01T00:00:00.000Z',
};
const ZONE_1: ZoneResponse = {
  id: '33333333-3333-4333-8333-333333333301',
  siteId: SITE_ID,
  code: 'ZONE-01',
  name: 'Crane Bay',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  configurationLocked: false,
  createdAt: '2026-03-01T00:00:00.000Z',
};

function makeFrozenReference(
  overrides: Partial<{ expiresAt: string; siteId: string; cameraId: string }> = {},
): CameraConfigurationReference {
  const expiresAt = overrides.expiresAt ?? new Date(Date.now() + 240_000).toISOString();
  const capturedIso = new Date(Date.parse(expiresAt) - 300_000).toISOString();
  const siteId = overrides.siteId ?? SITE_ID;
  const cameraId = overrides.cameraId ?? CAM_1.id;
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const imageSha256 = 'a'.repeat(64);
  const mockImage = new Image();
  Object.defineProperty(mockImage, 'naturalWidth', { value: 640 });
  Object.defineProperty(mockImage, 'naturalHeight', { value: 360 });
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    sourceKind: 'LIVE',
    cameraId,
    siteId,
    configurationVersion: CAM_1.configurationVersion,
    referenceExpiresAt: expiresAt,
    frame: {
      cameraExternalId: CAM_1.externalId,
      sessionId,
      sequenceNumber: '1',
      capturedAt: capturedIso,
      width: 640,
      height: 360,
      imageDataUrl:
        'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
      imageSha256,
    },
    issuedReference: {
      schemaVersion: '1.0.0',
      purpose: 'REGION_CONFIGURATION',
      sourceKind: 'LIVE',
      referenceId: '55555555-5555-4555-8555-555555555555',
      siteId,
      cameraId,
      sessionId,
      imageSha256,
      width: 640,
      height: 360,
      capturedAt: capturedIso,
      issuedAt: capturedIso,
      expiresAt,
      configurationVersion: CAM_1.configurationVersion,
      viewRevision: 1,
    },
    image: mockImage,
  };
}

describe('RegionPolygonTaskTour (P8-S3 camera-side polygon guided tour)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('guides Site Manager through camera/zone selection, current reference, inherited/override/disabled PPE, drawing a small region, and save vs worker-applied receipt without altering drafts', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mockClient = {
      readSavedPpePolicy: vi.fn().mockResolvedValue({
        cameraId: CAM_1.id,
        regionId: null,
        configurationVersion: CAM_1.configurationVersion,
        savedRevision: CAM_1.configurationVersion,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
      }),
    } as unknown as SmartSiteManagementClient;

    render(
      <QueryClientProvider client={queryClient}>
        <div>
          <CameraRegionSelectionControls
            zones={[ZONE_1]}
            selectedZoneId={ZONE_1.id}
            onZoneChange={vi.fn()}
            selectedCameraId={CAM_1.id}
            onCameraChange={vi.fn()}
            allFetchedCameras={[CAM_1]}
            visibleActiveCameras={[CAM_1]}
            cameraServerTotal={1}
            isCamerasInitialLoading={false}
            cameraError={null}
            isCameraBaseError={false}
            isTransientNextCameraError={false}
            isFetchingCameras={false}
            hasNextCameraPage={false}
            onRetryInitialCameras={vi.fn()}
            onFetchNextCameras={vi.fn()}
          />
          <ZonePpeCameraRegionDrawer
            apiUrl={API_URL}
            client={mockClient}
            token="secret-mgr-token"
            sessionScope="mgr-scope"
            credentialId={1}
            internalNonce={1}
            siteId={SITE_ID}
            selectedCamera={CAM_1}
            selectedZone={ZONE_1}
            frozenReference={makeFrozenReference()}
            candidateReference={null}
            tourUserId="manager-alpha"
            lastSavedDraft={null}
            onAcceptCandidateReference={vi.fn()}
            onCancelCandidateReview={vi.fn()}
            onScopeRevoked={vi.fn()}
            onSaveSuccess={vi.fn()}
            onClose={vi.fn()}
          />
        </div>
      </QueryClientProvider>,
    );

    const policySelect = (await screen.findByLabelText('Policy mode')) as HTMLSelectElement;
    fireEvent.change(policySelect, { target: { value: 'INHERIT' } });
    expect(policySelect.value).toBe('INHERIT');

    expect(await screen.findByTestId('safety-task-tour-invitation')).toBeTruthy();
    fireEvent.click(screen.getByTestId('safety-task-tour-invitation-start'));

    // Step 1: Selecting / verifying camera & zone
    const step1 = await screen.findByTestId('safety-task-tour');
    expect(step1.getAttribute('data-tour-step')).toBe('polygon-camera-scope');
    expect(step1.textContent).toContain('Step 1 of 6');
    expect(step1.textContent).toMatch(/Camera & Zone/i);
    expect(
      document.querySelector('select#select-camera-link')?.getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    // Step 2: Capturing / confirming current 5-minute reference image
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step2 = screen.getByTestId('safety-task-tour');
    expect(step2.getAttribute('data-tour-step')).toBe('polygon-frozen-reference');
    expect(step2.textContent).toMatch(/Current Reference Image/i);
    expect(step2.textContent).toMatch(/5-minute|Review new reference/i);

    // Step 3: Choosing Inherited / Override / Disabled PPE on v2 camera
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step3 = screen.getByTestId('safety-task-tour');
    expect(step3.getAttribute('data-tour-step')).toBe('polygon-ppe-policy');
    expect(step3.textContent).toMatch(/Use camera default|Inherited/i);
    expect(step3.textContent).toMatch(/Custom|Override/i);
    expect(step3.textContent).toMatch(/Disabled/i);
    expect(
      document
        .querySelector('[data-tour-anchor="polygon-frozen-reference"] > fieldset')
        ?.getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    // Step 4: Drawing a small non-crossing region on canvas
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step4 = screen.getByTestId('safety-task-tour');
    expect(step4.getAttribute('data-tour-step')).toBe('polygon-canvas');
    expect(step4.textContent).toMatch(/small/i);
    expect(step4.textContent).toMatch(/non-crossing|crossing/i);

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('safety-task-tour').textContent).toContain('Bước 4 / 6');
    expect(screen.getByTestId('safety-task-tour').textContent).toMatch(/vùng.*gọn|không tự cắt/i);
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // Step 5: Adjusting points & view
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'polygon-edit-controls',
    );

    // Step 6: Save config vs worker-applied receipt
    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    const step6 = screen.getByTestId('safety-task-tour');
    expect(step6.getAttribute('data-tour-step')).toBe('polygon-save-footer');
    expect(step6.textContent).toMatch(/Save Config vs Worker-Applied Receipt/i);
    expect(step6.textContent).toMatch(/worker-applied receipt/i);

    fireEvent.click(screen.getByTestId('safety-task-tour-done'));
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
    expect(policySelect.value).toBe('INHERIT');

    const storedRaw = window.localStorage.getItem(SAFETY_TOUR_STORAGE_KEY) ?? '{}';
    expect(storedRaw).not.toContain('secret-mgr-token');
  });

  it('omits unavailable controls on PPE policy fetch error, expired reference, edit mode, and mismatched scope', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const failingClient = {
      readSavedPpePolicy: vi
        .fn()
        .mockRejectedValue(new ApiError('http', 'Policy service unavailable', 500)),
    } as unknown as SmartSiteManagementClient;

    // 1. Expired reference + failed policy query: omits PPE fieldset, canvas, and point controls
    const expiredIso = new Date(Date.now() - 10_000).toISOString();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionDrawer
          apiUrl={API_URL}
          client={failingClient}
          token="secret-mgr-token"
          sessionScope="mgr-scope"
          credentialId={1}
          internalNonce={1}
          siteId={SITE_ID}
          selectedCamera={CAM_1}
          selectedZone={ZONE_1}
          frozenReference={makeFrozenReference({ expiresAt: expiredIso })}
          candidateReference={null}
          tourUserId="manager-alpha"
          lastSavedDraft={null}
          onAcceptCandidateReference={vi.fn()}
          onCancelCandidateReview={vi.fn()}
          onScopeRevoked={vi.fn()}
          onSaveSuccess={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await screen.findByRole('alert');
    fireEvent.click(await screen.findByTestId('safety-task-tour-trigger'));
    const expiredStep1 = await screen.findByTestId('safety-task-tour');
    expect(expiredStep1.getAttribute('data-tour-step')).toBe('polygon-frozen-reference');
    expect(expiredStep1.textContent).toContain('Step 1 of 2');
    expect(expiredStep1.textContent).toMatch(/Expired/i);
    expect(expiredStep1.textContent).toMatch(/Review new reference/i);

    fireEvent.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'polygon-save-footer',
    );
    expect(screen.getByTestId('safety-task-tour-done')).toBeTruthy();

    // 2. Scope mismatch fails closed (renders no tour trigger)
    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionDrawer
          apiUrl={API_URL}
          client={failingClient}
          token="secret-mgr-token"
          sessionScope="mgr-scope"
          credentialId={1}
          internalNonce={1}
          siteId={SITE_ID}
          selectedCamera={CAM_1}
          selectedZone={ZONE_1}
          frozenReference={makeFrozenReference({ siteId: '99999999-9999-4999-8999-999999999999' })}
          candidateReference={null}
          tourUserId="manager-alpha"
          lastSavedDraft={null}
          onAcceptCandidateReference={vi.fn()}
          onCancelCandidateReview={vi.fn()}
          onScopeRevoked={vi.fn()}
          onSaveSuccess={vi.fn()}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('safety-task-tour-trigger')).toBeNull();
  });
});
