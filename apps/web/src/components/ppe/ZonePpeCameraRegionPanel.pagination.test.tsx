// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import type { DecodedPreview } from '../cameras/useRealtimePreview';

const preview = vi.hoisted(() => vi.fn((options: { enabled: boolean }): { status: string; preview: DecodedPreview | null; cameraExternalId: string | null } => {
  void options;
  return { status: 'UNAVAILABLE', preview: null, cameraExternalId: null };
}));
vi.mock('../cameras/useScopedCameraPreview', () => ({ useScopedCameraPreview: preview }));
const zone: ZoneResponse = { id: 'zone-a', siteId: 'site-a', code: 'GROUND', name: 'Ground', type: 'HAZARDOUS', restrictionPolicy: 'NONE', requiredPpe: ['GLOVES'], configurationLocked: false, createdAt: '2026-10-08T00:00:00Z' };
const camera = (n: number): CameraResponse => ({ id: `cam-${n}`, siteId: 'site-a', externalId: `source-${n}`, code: `CAM-${n}`, name: `Camera ${n}`, status: 'ACTIVE', configurationVersion: 3, createdAt: '2026-10-08T00:00:00Z' });
const region = (n: number, cameraId = 'cam-1', zoneId = 'zone-a'): RegionResponse => ({ id: `region-${n}`, cameraId, zoneId, version: 1, isActive: true, coordinateSpace: 'NORMALIZED_0_1', polygon: { coordinates: [[0, 0], [1, 0], [1, 1]] }, createdAt: '2026-10-08T00:00:00Z' });
const cameras = Array.from({ length: 20 }, (_, n) => camera(n + 1));
const regions = Array.from({ length: 20 }, (_, n) => region(n + 1));
let queries: QueryClient;
const props = { apiUrl: 'http://localhost:3000', token: 'token-a', credentialId: 1, sessionScope: 'session-a', siteId: 'site-a', zones: [zone] };
function mount() {
  const element = (next = {}) => <QueryClientProvider client={queries}><ZonePpeCameraRegionPanel {...props} {...next} /></QueryClientProvider>;
  const view = render(element());
  return { ...view, change: (next: Partial<typeof props>) => view.rerender(element(next)) };
}
beforeEach(() => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
  queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({ items: [camera(1)], total: 1 });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({ items: [], total: 0 });
  preview.mockClear();
  preview.mockReturnValue({ status: 'UNAVAILABLE', preview: null, cameraExternalId: null });
});
afterEach(() => { cleanup(); queries.clear(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('explicitly appends camera pages and keeps the selected camera while AI stays paused', async () => {
  const list = vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  mount(); const more = await screen.findByRole('button', { name: 'Load more cameras' });
  expect(list).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Select Camera' }), { target: { value: 'cam-12' } });
  fireEvent.click(more); await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect((screen.getByRole('combobox', { name: 'Select Camera' }) as HTMLSelectElement).value).toBe('cam-12');
  expect(list).toHaveBeenLastCalledWith('token-a', 'site-a', { offset: 20, limit: 20 }, { signal: expect.any(AbortSignal) });
  expect(screen.queryByRole('button', { name: 'Load more cameras' })).toBeNull();
  expect(preview.mock.calls.every(call => (call[0] as { enabled: boolean }).enabled === false)).toBe(true);
});

it('can load beyond a first page consisting only of inactive cameras', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras.map(c => ({ ...c, status: 'INACTIVE' })), total: 21 }).mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect((screen.getByRole('combobox', { name: 'Select Camera' }) as HTMLSelectElement).value).toBe('cam-21');
});

it('appends scoped region pages using fetched row offsets and deduplicates overlapping IDs', async () => {
  const first = regions.map((r, i) => i === 0 ? { ...r, zoneId: 'other-zone' } : r);
  const list = vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: first, total: 22 }).mockResolvedValueOnce({ items: [region(20), region(21)], total: 22 });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByText('region-21');
  expect(screen.getAllByText('region-20')).toHaveLength(1); expect(screen.queryByText('region-1')).toBeNull();
  expect(list).toHaveBeenLastCalledWith('token-a', 'site-a', 'cam-1', { offset: 20, limit: 20 }, { signal: expect.any(AbortSignal) });
  expect(screen.queryByRole('button', { name: 'Load more regions' })).toBeNull();
});

it.each(['cameras', 'regions'])('qualifies loaded %s using the latest page total rather than the first page total', async kind => {
  if (kind === 'cameras') {
    vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockResolvedValueOnce({ items: [camera(21)], total: 22 });
  } else {
    vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockResolvedValueOnce({ items: [region(21)], total: 22 });
  }
  mount(); fireEvent.click(await screen.findByRole('button', { name: `Load more ${kind}` }));
  await screen.findByText(kind === 'cameras' ? '21 active (21 loaded of 22 on site)' : '21 linked (21 loaded of 22 on camera)');
});

it('does not claim an empty region list while the first page is still loading', async () => {
  let resolve!: (value: { items: RegionResponse[]; total: number }) => void;
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); await screen.findByText('Loading regions…');
  expect(screen.queryByText(/No observation regions linked/)).toBeNull();
  await act(async () => resolve({ items: [], total: 0 }));
  await screen.findByText(/No observation regions linked/);
});

it('does not claim there are no linked regions while later camera-wide pages remain', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions.map(r => ({ ...r, zoneId: 'other-zone' })), total: 21 }).mockResolvedValueOnce({ items: [region(21)], total: 21 });
  mount(); const more = await screen.findByRole('button', { name: 'Load more regions' });
  expect(screen.queryByText(/No observation regions linked/)).toBeNull();
  fireEvent.click(more); await screen.findByText('region-21');
});

it('rejects a non-progressing next region page and keeps the already authorized list', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockResolvedValueOnce({ items: [], total: 21 });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByRole('button', { name: 'Retry loading more regions' });
  expect(screen.getByText('region-1')).toBeTruthy();
});

it('offers safe retry for a failed first camera page without claiming a region list is empty', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockRejectedValueOnce(new ApiError('http', 'SECRET_TRACE', 503));
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Retry loading cameras' }));
  await screen.findByRole('option', { name: 'CAM-1 · Camera 1' });
  expect(screen.queryByText('SECRET_TRACE')).toBeNull();
});

it('offers safe retry for a failed first region page instead of showing a false empty state', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockRejectedValueOnce(new ApiError('http', 'SECRET_TRACE', 503));
  mount(); const retry = await screen.findByRole('button', { name: 'Retry loading regions' });
  expect(screen.queryByText(/No observation regions linked/)).toBeNull();
  fireEvent.click(retry); await screen.findByText(/No observation regions linked/);
  expect(screen.queryByText('SECRET_TRACE')).toBeNull();
});

it('retains camera selection on transient next-page failure and retries the same offset', async () => {
  const list = vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'PRIVATE', 503)).mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  mount(); await screen.findByRole('option', { name: 'CAM-12 · Camera 12' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Select Camera' }), { target: { value: 'cam-12' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  const retry = await screen.findByRole('button', { name: 'Retry loading more cameras' });
  expect((screen.getByRole('combobox', { name: 'Select Camera' }) as HTMLSelectElement).value).toBe('cam-12');
  fireEvent.click(retry); await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect(list.mock.calls.map(call => call[2]?.offset)).toEqual([0, 20, 20]);
});

it('retains authorized region metadata on transient next-page failure and retries that page', async () => {
  const list = vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'PRIVATE', 503)).mockResolvedValueOnce({ items: [region(21)], total: 21 });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  const retry = await screen.findByRole('button', { name: 'Retry loading more regions' });
  expect(screen.getByText('region-1')).toBeTruthy(); fireEvent.click(retry); await screen.findByText('region-21');
  expect(list.mock.calls.map(call => call[3]?.offset)).toEqual([0, 20, 20]);
});

it.each([401, 403, 404])('hides old camera and region metadata after next camera page revocation %i', async status => {
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'SECRET', status));
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValue({ items: [region(1)], total: 1 });
  mount(); await screen.findByText('region-1'); fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('button', { name: 'Retry loading cameras' });
  expect(screen.queryByRole('option', { name: /CAM-1 ·/ })).toBeNull(); expect(screen.queryByText('region-1')).toBeNull();
});

it.each([401, 403, 404])('hides old region metadata after next region page revocation %i', async status => {
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'SECRET', status));
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByRole('button', { name: 'Retry loading regions' });
  expect(screen.queryByText('region-1')).toBeNull(); expect(screen.queryByRole('button', { name: 'Load more regions' })).toBeNull();
});

it('hides old metadata on a failed base refetch rather than treating it as next-page failure', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'SECRET', 503));
  mount(); await screen.findByRole('button', { name: 'Load more cameras' });
  await act(async () => { await queries.invalidateQueries({ predicate: q => q.queryKey.includes('cameras-for-region') }); });
  await screen.findByRole('button', { name: 'Retry loading cameras' });
  expect(screen.queryByRole('option', { name: /CAM-1 ·/ })).toBeNull(); expect(screen.queryByRole('button', { name: 'Retry loading more cameras' })).toBeNull();
});

it.each(['cameras', 'regions'])('hides cached %s when a later page of a base refetch fails', async kind => {
  if (kind === 'cameras') {
    vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockResolvedValueOnce({ items: [camera(21)], total: 21 }).mockResolvedValueOnce({ items: cameras, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'SECRET', 503));
  } else {
    vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockResolvedValueOnce({ items: [region(21)], total: 21 }).mockResolvedValueOnce({ items: regions, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'SECRET', 503));
  }
  mount(); fireEvent.click(await screen.findByRole('button', { name: `Load more ${kind}` }));
  if (kind === 'cameras') await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  else await screen.findByText('region-21');
  await act(async () => { await queries.invalidateQueries({ predicate: q => kind === 'cameras' ? q.queryKey.includes('cameras-for-region') : q.queryKey.includes('regions') }); });
  await screen.findByRole('button', { name: `Retry loading ${kind}` });
  if (kind === 'cameras') expect(screen.queryByRole('option', { name: 'CAM-21 · Camera 21' })).toBeNull();
  else expect(screen.queryByText('region-21')).toBeNull();
  expect(screen.queryByRole('button', { name: `Retry loading more ${kind}` })).toBeNull();
});

it.each([{ items: [], total: 21 }, { items: [camera(21)], total: 21.5 }, { items: Array.from({ length: 21 }, (_, n) => camera(n + 21)), total: 41 }])('rejects malformed or non-progressing camera pages without appending data', async badPage => {
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockResolvedValueOnce(badPage);
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('button', { name: 'Retry loading more cameras' });
  expect(screen.queryByRole('option', { name: 'CAM-21 · Camera 21' })).toBeNull();
});

it('does not issue duplicate next-page camera requests while one is pending', async () => {
  let resolve!: (value: { items: CameraResponse[]; total: number }) => void;
  const list = vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); const more = await screen.findByRole('button', { name: 'Load more cameras' });
  act(() => { fireEvent.click(more); fireEvent.click(more); });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  await act(async () => resolve({ items: [camera(21)], total: 21 }));
});

it('cancels late camera pages and isolates cached metadata on token rotation with reused credential ID', async () => {
  let resolve!: (value: { items: CameraResponse[]; total: number }) => void;
  let pageSignal: AbortSignal | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockImplementationOnce((_t, _s, _o, request) => { pageSignal = request?.signal; return new Promise(done => { resolve = done; }); }).mockRejectedValueOnce(new ApiError('http', 'DENIED', 403));
  const view = mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await waitFor(() => expect(resolve).toBeDefined()); view.change({ token: 'token-b' });
  expect(screen.queryByRole('option', { name: /CAM-1 ·/ })).toBeNull();
  expect(pageSignal?.aborted).toBe(true);
  await act(async () => resolve({ items: [camera(21)], total: 21 }));
  await screen.findByRole('button', { name: 'Retry loading cameras' });
  expect(screen.queryByRole('option', { name: /CAM-21/ })).toBeNull();
  expect(JSON.stringify(queries.getQueryCache().getAll().map(q => q.queryKey))).not.toContain('token-');
});

async function drawFixture() {
  // Mock pixels only: this never starts capture, loads a model, or contacts an AI service.
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
  preview.mockReturnValue({ status: 'LIVE', cameraExternalId: 'source-1', preview: {
    image: {} as HTMLImageElement,
    frame: { width: 640, height: 480, cameraExternalId: 'source-1', sessionId: 'frame-session', sequenceNumber: '1', capturedAt: new Date().toISOString(), imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==', detections: [], zoneDetections: [], zonePolygons: [] },
  } });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, toJSON: () => ({}) });
  mount(); const start = await screen.findByRole('button', { name: 'Start Drawing Region' });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(start);
  const canvas = screen.getByLabelText('Camera Region Drawing Canvas');
  for (const [clientX, clientY] of [[64, 48], [512, 48], [512, 384]]) fireEvent.click(canvas, { clientX, clientY });
  expect(screen.getByText('Points: 3 / 32')).toBeTruthy();
}

it('preserves the current polygon draft and selection while appending cameras', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValueOnce({ items: cameras, total: 21 }).mockResolvedValueOnce({ items: [camera(21)], total: 21 });
  await drawFixture(); fireEvent.click(await screen.findByRole('button', { name: 'Load more cameras' }));
  await screen.findByRole('option', { name: 'CAM-21 · Camera 21' });
  expect(screen.getByText('Points: 3 / 32')).toBeTruthy();
  expect((screen.getByRole('combobox', { name: 'Select Camera' }) as HTMLSelectElement).value).toBe('cam-1');
});

it('revokes frozen drawing and region rows on a hard next-region-page denial', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockRejectedValueOnce(new ApiError('http', 'SECRET', 403));
  await drawFixture(); fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await screen.findByRole('button', { name: 'Retry loading regions' });
  expect(screen.queryByLabelText('Camera Region Drawing Canvas')).toBeNull();
  expect(screen.queryByText('region-1')).toBeNull();
  expect((screen.getByRole('button', { name: 'Start Drawing Region' }) as HTMLButtonElement).disabled).toBe(true);
});

it('cancels late region pages when the selected camera changes', async () => {
  let resolve!: (value: { items: RegionResponse[]; total: number }) => void;
  let pageSignal: AbortSignal | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.listCameras).mockResolvedValue({ items: [camera(1), camera(2)], total: 2 });
  const list = vi.mocked(SmartSiteManagementClient.prototype.listRegions).mockResolvedValueOnce({ items: regions, total: 21 }).mockImplementationOnce((_t, _s, _c, _o, request) => { pageSignal = request?.signal; return new Promise(done => { resolve = done; }); }).mockResolvedValueOnce({ items: [region(99, 'cam-2')], total: 1 });
  mount(); fireEvent.click(await screen.findByRole('button', { name: 'Load more regions' }));
  await waitFor(() => expect(resolve).toBeDefined()); fireEvent.change(screen.getByRole('combobox', { name: 'Select Camera' }), { target: { value: 'cam-2' } });
  expect(screen.queryByText('region-1')).toBeNull(); expect(pageSignal?.aborted).toBe(true);
  await act(async () => resolve({ items: [region(21)], total: 21 }));
  await screen.findByText('region-99'); expect(screen.queryByText('region-21')).toBeNull();
  expect(list.mock.calls.at(-1)?.[2]).toBe('cam-2');
});
