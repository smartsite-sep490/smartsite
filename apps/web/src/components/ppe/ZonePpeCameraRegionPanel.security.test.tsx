// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';

const camera: CameraResponse = {
  id: 'camera-a', siteId: 'site-a', externalId: 'camera-source-a', code: 'CAM-A',
  name: 'Camera A', status: 'ACTIVE', configurationVersion: 7, createdAt: '2026-10-07T00:00:00Z',
};
const zones: ZoneResponse[] = [{
  id: 'zone-a', siteId: 'site-a', code: 'HELMET', name: 'Helmet only', type: 'HAZARDOUS',
  restrictionPolicy: 'NONE', requiredPpe: ['HARD_HAT'], configurationLocked: false,
  createdAt: '2026-10-07T00:00:00Z',
}, {
  id: 'zone-b', siteId: 'site-a', code: 'VEST', name: 'Vest only', type: 'HAZARDOUS',
  restrictionPolicy: 'NONE', requiredPpe: ['SAFETY_VEST'], configurationLocked: false,
  createdAt: '2026-10-07T00:00:00Z',
}];
const state = vi.hoisted(() => ({ status: 'LIVE', externalId: 'camera-source-a' }));
vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    status: state.status, cameraExternalId: state.externalId,
    preview: {
      image: {} as HTMLImageElement,
      frame: {
        width: 640, height: 480, cameraExternalId: state.externalId,
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==', capturedAt: '2026-10-07T00:00:00Z',
        sessionId: 'session-a', sequenceNumber: '1', detections: [], zoneDetections: [], zonePolygons: [],
      },
    },
  }),
}));
let queries: QueryClient;
beforeEach(() => {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  state.status = 'LIVE'; state.externalId = camera.externalId;
  vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({ items: [camera], total: 1 });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue(camera);
  vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 50, y: 20, left: 50, top: 20, width: 320, height: 240, right: 370, bottom: 260,
    toJSON: () => ({}),
  });
});
afterEach(() => { cleanup(); queries.clear(); vi.restoreAllMocks(); });
function view(token = 'token-a', credentialId = 1) {
  return <QueryClientProvider client={queries}>
    <ZonePpeCameraRegionPanel apiUrl="http://localhost:3000" token={token}
      credentialId={credentialId} sessionScope="session-a" siteId="site-a" zones={zones} />
  </QueryClientProvider>;
}
async function draw(points = [[82, 44], [306, 44], [306, 212]]) {
  const start = await screen.findByRole('button', { name: /Start Drawing Region/i });
  await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(start);
  const surface = await screen.findByLabelText(/Camera Region Drawing Canvas/i);
  for (const [clientX, clientY] of points) fireEvent.click(surface, { clientX, clientY });
  return surface;
}

it('allows a matching REPLAY frame for the current demo instead of requiring a LIVE source', async () => {
  state.status = 'REPLAY'; render(view()); await draw();
  expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeDefined();
});

it('cancels old credential camera-detail read before any region POST after scope rotation', async () => {
  let resolveDetail: ((value: CameraResponse) => void) | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.getCamera).mockImplementationOnce(() =>
    new Promise(resolve => { resolveDetail = resolve; }));
  const post = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
  const { rerender } = render(view()); await draw();
  fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await waitFor(() => expect(resolveDetail).toBeDefined());
  rerender(view('token-b', 2));
  await act(async () => { resolveDetail?.(camera); });
  expect(post).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  expect(JSON.stringify(queries.getQueryCache().getAll().map(q => q.queryKey))).not.toContain('token-');
});

it('does not reuse frozen pixels or finish an old POST when token rotates with unchanged caller credential ID', async () => {
  let resolveDetail: ((value: CameraResponse) => void) | undefined;
  vi.mocked(SmartSiteManagementClient.prototype.getCamera).mockImplementationOnce(() =>
    new Promise(resolve => { resolveDetail = resolve; }));
  const post = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
  const { rerender } = render(view()); await draw();
  fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await waitFor(() => expect(resolveDetail).toBeDefined());
  rerender(view('token-b', 1));
  await act(async () => { resolveDetail?.(camera); });
  await screen.findByRole('option', { name: /CAM-A/i });
  expect(post).not.toHaveBeenCalled();
  expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
});

it('does not resurrect a frozen drawing when credentials rotate A to B and back to A', async () => {
  const { rerender } = render(view()); await draw();
  rerender(view('token-b', 1));
  await screen.findByRole('option', { name: /CAM-A/i });
  rerender(view('token-a', 1));
  await screen.findByRole('option', { name: /CAM-A/i });
  expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
});

it('clears success and scopes duplicate prevention to the selected Zone', async () => {
  const post = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockImplementation(
    async (_token, _site, _camera, input) => ({
      region: { id: 'created-region', cameraId: camera.id, zoneId: input.zoneId,
        polygon: input.polygon as { coordinates: [number, number][] },
        coordinateSpace: 'NORMALIZED_0_1', version: 1, isActive: true, createdAt: '2026-10-07T00:00:00Z' },
      configurationVersion: 8,
    }),
  );
  render(view()); await draw(); fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await screen.findByText(/Saved region/i);
  fireEvent.change(screen.getByLabelText(/Select Zone/i), { target: { value: 'zone-b' } });
  expect(screen.queryByText(/Saved region/i)).toBeNull();
  await draw(); fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
});

it('rejects wrong-site fresh camera metadata before POST even when initial list was valid', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getCamera).mockResolvedValueOnce({ ...camera, siteId: 'other-site' });
  const post = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
  render(view()); await draw(); fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await waitFor(() => expect(SmartSiteManagementClient.prototype.getCamera).toHaveBeenCalled());
  await act(async () => {});
  expect(post).not.toHaveBeenCalled();
  expect(screen.queryByText(/Saved configuration/i)).toBeNull();
});

it('uses the actual offset and scaled image surface to save normalized polygon coordinates', async () => {
  const post = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockResolvedValue({
    region: { id: 'new-region', cameraId: camera.id, zoneId: zones[0]!.id,
      polygon: { coordinates: [[.1,.1],[.8,.1],[.8,.8]] }, coordinateSpace: 'NORMALIZED_0_1',
      version: 1, isActive: true, createdAt: '2026-10-07T00:00:00Z' }, configurationVersion: 8,
  });
  render(view()); await draw(); fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(post).toHaveBeenCalledWith('token-a', 'site-a', 'camera-a', {
    zoneId: 'zone-a', polygon: { coordinates: [[.1,.1],[.8,.1],[.8,.8]] }, expectedConfigurationVersion: 7,
  });
});

it('rejects out-of-image clicks instead of silently clamping them into a boundary vertex', async () => {
  render(view()); const surface = await draw([[82,44],[306,44]]);
  fireEvent.click(surface, { clientX: 380, clientY: 270 });
  expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();
});

it.each(['private-service-canary', 'Polygon private-service-canary'])('does not expose arbitrary upstream exception text to the operator: %s', async (message) => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockRejectedValue(new Error(message));
  render(view()); await draw(); fireEvent.click(screen.getByRole('button', { name: /Save Region/i }));
  await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
  expect(screen.queryByText(/private-service-canary/)).toBeNull();
});
