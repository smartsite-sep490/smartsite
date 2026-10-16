// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import { LocaleProvider, LocaleSwitcher, useLocale, type Locale } from '../../i18n/locale';
import { PpeMonitoringView } from './PpeMonitoringView';
import type { SharedSession } from '../../types/shared-session';
import type { DecodedPreview } from '../cameras/useRealtimePreview';

const fixture = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  previewEnabled: [] as boolean[],
  mediaEnabled: [] as boolean[],
  recordedEnabled: [] as boolean[],
  mediaError: null as string | null,
}));
vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (input: { enabled: boolean }) => {
    fixture.previewEnabled.push(input.enabled);
    return {
      preview: fixture.preview,
      status: fixture.preview ? 'LIVE' : 'UNAVAILABLE',
      sourceKind: fixture.preview ? 'LIVE' : null,
      error: null,
      errorStatus: null,
      isError: false,
      isLoading: false,
      isPolling: false,
      retry: vi.fn(),
      cameraExternalId: fixture.preview?.frame.cameraExternalId ?? null,
      capturedAt: fixture.preview?.frame.capturedAt ?? null,
    };
  },
}));
vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: (input: { enabled: boolean }) => {
    fixture.mediaEnabled.push(input.enabled);
    return {
      image: null,
      frame: null,
      status: 'UNAVAILABLE',
      error: fixture.mediaError,
      errorStatus: null,
      isStreaming: false,
      retry: vi.fn(),
    };
  },
}));
vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: (input: { enabled: boolean }) => {
    fixture.recordedEnabled.push(input.enabled);
    return {
      videoUrl: null,
      status: 'UNAVAILABLE',
      error: null,
      errorStatus: null,
      isLoading: false,
      retry: vi.fn(),
    };
  },
}));
// DOM semantics only: these synthetic fixtures do not decode images or start media/model workers.
vi.mock('../cameras/RealtimePreviewCanvas', () => ({ RealtimePreviewCanvas: () => <div /> }));
vi.mock('../cameras/RawCameraMediaCanvas', () => ({ RawCameraMediaCanvas: () => <div /> }));
vi.mock('./Mf05DemoControlPanel', () => ({ Mf05DemoControlPanel: () => <div /> }));

const session: SharedSession = {
  accessToken: 'synthetic-test-token',
  sessionScope: 'synthetic-locale-scope',
  user: {
    id: 'synthetic-officer',
    displayName: 'Synthetic Officer',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
  },
  onSignOut: vi.fn(),
};
const cameras = [
  {
    id: 'cam-laptop',
    siteId: 'site-alpha',
    externalId: 'laptop-webcam-live',
    code: 'CAM-A',
    name: 'Synthetic Camera A',
    status: 'ACTIVE' as const,
    configurationVersion: 1,
    createdAt: '2026-10-01T00:00:00Z',
  },
  {
    id: 'cam-second',
    siteId: 'site-alpha',
    externalId: 'synthetic-camera-b',
    code: 'CAM-B',
    name: 'Synthetic Camera B',
    status: 'ACTIVE' as const,
    configurationVersion: 1,
    createdAt: '2026-10-01T00:00:00Z',
  },
];
let queryClient: QueryClient;
let changeLocale: ((locale: Locale) => void) | undefined;

function LocaleControlFixture() {
  const { setLocale } = useLocale();
  React.useEffect(() => {
    changeLocale = setLocale;
    return () => {
      changeLocale = undefined;
    };
  }, [setLocale]);
  return null;
}

async function switchToEnglishViaPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
  await user.click(screen.getByRole('button', { name: 'English' }));
}

function preview(confirmed: boolean): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      sequenceNumber: '1',
      cameraExternalId: 'laptop-webcam-live',
      capturedAt: new Date().toISOString(),
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      zoneDetections: [],
      detections: [
        {
          active: true,
          alertState: 'CONFIRMED',
          confirmedMissingItems: confirmed ? ['GLOVES'] : [],
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
          confidence: 0.92,
          eventId: '00000000-0000-4000-8000-000000000001',
          label: 'Synthetic Track',
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT', GLOVES: 'UNKNOWN' },
          timecode: '00:15',
          trackId: 7,
          cameraExternalId: 'laptop-webcam-live',
        },
      ],
    },
  };
}
function View() {
  return (
    <LocaleProvider>
      <LocaleControlFixture />
      <LocaleSwitcher />
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={session} />
      </QueryClientProvider>
    </LocaleProvider>
  );
}
beforeEach(async () => {
  await i18n.changeLanguage('vi');
  localStorage.clear();
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
  fixture.preview = null;
  fixture.previewEnabled = [];
  fixture.mediaEnabled = [];
  fixture.recordedEnabled = [];
  fixture.mediaError = null;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      {
        id: 'site-alpha',
        code: 'SITE-A',
        name: 'Synthetic Site Alpha',
        createdAt: '2026-10-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
    items: cameras,
    total: cameras.length,
  });
});
afterEach(async () => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await i18n.changeLanguage('vi');
  localStorage.clear();
});

describe('localized PPE presentation keeps evidence and authority boundaries', () => {
  it('keeps a selected camera and unchanged metadata names across locale changes', async () => {
    const user = userEvent.setup();
    render(<View />);
    const camera = (await screen.findByRole('combobox', { name: 'Camera' })) as HTMLSelectElement;
    await screen.findByRole('option', { name: /Synthetic Camera B/ });
    await user.selectOptions(camera, 'cam-second');
    const siteCalls = vi.mocked(SmartSiteManagementClient.prototype.listSites).mock.calls.length;
    const cameraCalls = vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mock.calls
      .length;
    await switchToEnglishViaPopover(user);
    expect(camera.value).toBe('cam-second');
    expect(screen.getByRole('option', { name: /Synthetic Camera B/ })).toBeDefined();
    expect(vi.mocked(SmartSiteManagementClient.prototype.listSites).mock.calls.length).toBe(
      siteCalls,
    );
    expect(
      vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mock.calls.length,
    ).toBe(cameraCalls);
  });

  it('shows current unknown and a separately confirmed missing-PPE episode in both languages', async () => {
    fixture.preview = preview(true);
    const user = userEvent.setup();
    render(<View />);
    await screen.findByText('Găng tay · Chưa xác định');
    const episode = await screen.findByTestId('confirmed-episode-warning-7-GLOVES');
    expect(episode.textContent).toContain('Đợt thiếu PPE đã xác nhận đang mở');
    expect(episode.textContent).toContain('Ảnh chụp hiện tại: Chưa xác định');
    await switchToEnglishViaPopover(user);
    await screen.findByText('Gloves · Unknown');
    expect(episode.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(episode.textContent).toContain('Current snapshot: Unknown');
  });

  it('does not turn unknown into missing when the explicit confirmed item list is empty', async () => {
    fixture.preview = preview(false);
    render(<View />);
    await screen.findByText('Găng tay · Chưa xác định');
    expect(screen.queryByTestId('confirmed-episode-warning-7-GLOVES')).toBeNull();
  });

  it('keeps all preview/media hooks disabled under the human pause in either language', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    fixture.preview = preview(true);
    const user = userEvent.setup();
    render(<View />);
    await screen.findByText('Đã tạm dừng xem trước camera');
    expect(screen.queryByTestId('confirmed-episode-warning-7-GLOVES')).toBeNull();
    await switchToEnglishViaPopover(user);
    await screen.findByText('Camera preview paused');
    expect(fixture.previewEnabled.length).toBeGreaterThan(0);
    expect(
      [...fixture.previewEnabled, ...fixture.mediaEnabled, ...fixture.recordedEnabled].every(
        (enabled) => !enabled,
      ),
    ).toBe(true);
  });

  it('presents a denied metadata response safely in either language without raw server error text', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
      new ApiError('http', 'private-driver-diagnostic', 403),
    );
    const user = userEvent.setup();
    render(<View />);
    await screen.findByText('Bạn không có quyền truy cập tài nguyên này.');
    expect(screen.queryByText('private-driver-diagnostic')).toBeNull();
    await switchToEnglishViaPopover(user);
    await screen.findByText('You do not have permission to access this resource.');
    expect(screen.queryByText('private-driver-diagnostic')).toBeNull();
  });

  it('retranslates generated review subject and fallback issue without replacing the selected observation', async () => {
    fixture.preview = preview(true);
    const detection = fixture.preview.frame.detections[0];
    if (!detection) throw new Error('Synthetic detection missing');
    detection.trackId = null;
    detection.label = '';
    const user = userEvent.setup();
    render(<View />);
    const review = await screen.findByRole('button', { name: 'Xác minh cảnh báo' });
    await user.click(review);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Chưa xác định track')).toBeDefined();
    // A newer frame must not replace the observation already being reviewed.
    fixture.preview = preview(true);
    const newerDetection = fixture.preview.frame.detections[0];
    if (!newerDetection) throw new Error('Newer synthetic detection missing');
    newerDetection.trackId = 99;
    newerDetection.eventId = '00000000-0000-4000-8000-000000000002';
    if (!changeLocale) throw new Error('Locale setter fixture missing');
    act(() => changeLocale?.('en'));
    await waitFor(() => expect(within(dialog).getByText('Unknown track')).toBeDefined());
    expect(within(dialog).getByText('PPE Inspection Issue')).toBeDefined();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(within(dialog).queryByText('Chưa xác định track')).toBeNull();
    expect(within(dialog).queryByText('Track #99')).toBeNull();
    expect(within(dialog).getByText(/Synthetic Camera A/)).toBeDefined();
  });

  it('shows a safe localized fallback for an unclassified media error instead of arbitrary transport text', async () => {
    fixture.mediaError = 'private-transport-detail';
    const user = userEvent.setup();
    render(<View />);
    await screen.findByText('Không có luồng video gốc đang hoạt động cho camera đã chọn.');
    expect(screen.queryByText('private-transport-detail')).toBeNull();
    await switchToEnglishViaPopover(user);
    await screen.findByText('No active raw video stream available for the selected camera.');
    expect(screen.queryByText('private-transport-detail')).toBeNull();
  });

  it('shows the original snapshot capture time in the evidence card instead of the viewer clock', async () => {
    fixture.preview = preview(true);
    // The UTC wire value represents a fixed local display time, independent of host timezone.
    fixture.preview.frame.capturedAt = new Date(2026, 9, 14, 10, 11, 12).toISOString();
    render(<View />);
    const label = await screen.findByText('Thời điểm ghi nhận');
    if (!label.parentElement) throw new Error('Captured-time field missing');
    expect(within(label.parentElement).getByText('10:11:12')).toBeDefined();
  });

  it('retains the original capture time in a card-opened review after newer frames and locale changes', async () => {
    fixture.preview = preview(true);
    fixture.preview.frame.capturedAt = new Date(2026, 9, 14, 10, 11, 12).toISOString();
    const user = userEvent.setup();
    render(<View />);
    const buttons = await screen.findAllByRole('button', { name: 'Xác minh cảnh báo' });
    const cardReview = buttons.find((button) => !button.closest('table'));
    if (!cardReview) throw new Error('Evidence-card review action missing');
    await user.click(cardReview);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('10:11:12')).toBeDefined();
    fixture.preview = preview(true);
    fixture.preview.frame.capturedAt = new Date(2026, 9, 14, 11, 12, 13).toISOString();
    if (!changeLocale) throw new Error('Locale setter fixture missing');
    act(() => changeLocale?.('en'));
    expect(within(dialog).getByText('10:11:12')).toBeDefined();
    expect(within(dialog).queryByText('11:12:13')).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('does not invent a capture time when a synthetic snapshot has no capture timestamp', async () => {
    fixture.preview = preview(true);
    fixture.preview.frame.capturedAt = '';
    render(<View />);
    const label = await screen.findByText('Thời điểm ghi nhận');
    if (!label.parentElement) throw new Error('Captured-time field missing');
    expect(within(label.parentElement).getByText('—')).toBeDefined();
  });

  it.each(['2026-02-30T10:11:12Z', '2026-10-14T24:00:00Z'])(
    'does not normalize an invalid RFC3339 calendar/clock value into displayed evidence time: %s',
    async (capturedAt) => {
      fixture.preview = preview(true);
      fixture.preview.frame.capturedAt = capturedAt;
      render(<View />);
      const label = await screen.findByText('Thời điểm ghi nhận');
      if (!label.parentElement) throw new Error('Captured-time field missing');
      expect(within(label.parentElement).getByText('—')).toBeDefined();
    },
  );

  it('keeps missing capture time explicit in evidence after switching to AI snapshots', async () => {
    fixture.preview = preview(true);
    fixture.preview.frame.capturedAt = '';
    const user = userEvent.setup();
    render(<View />);
    await user.click(await screen.findByRole('button', { name: /Bằng chứng AI/ }));
    const panel = screen.getByTestId('ai-detection-panel');
    const label = within(panel).getByText('Thời điểm ghi nhận');
    if (!label.parentElement) throw new Error('Captured-time field missing');
    expect(within(label.parentElement).getByText('—')).toBeDefined();
    expect(label.parentElement.textContent).not.toContain('NaN');
  });
});
