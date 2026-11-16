// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import { FocusedCameraMedia } from './FocusedCameraMedia';
const hooks = vi.hoisted(() => ({ snapshot: vi.fn(), raw: vi.fn(), recorded: vi.fn() }));
vi.mock('../cameras/useScopedCameraPreview', () => ({ useScopedCameraPreview: hooks.snapshot }));
vi.mock('../cameras/useScopedCameraMedia', () => ({ useScopedCameraMedia: hooks.raw }));
vi.mock('../cameras/useScopedRecordedVideo', () => ({ useScopedRecordedVideo: hooks.recorded }));
vi.mock('../cameras/ScopedRealtimePreviewCanvas', () => ({
  ScopedRealtimePreviewCanvas: () => <div data-testid="ai-overlay" />,
}));
vi.mock('../cameras/RawCameraMediaCanvas', () => ({
  RawCameraMediaCanvas: () => <div data-testid="raw-media" />,
}));
const props = {
  apiUrl: 'https://backend.example',
  client: {} as SmartSiteManagementClient,
  token: 'private',
  sessionScope: 'scope',
  siteId: 'site',
  aiPaused: false,
  camera: { id: 'camera', externalId: 'camera-source', name: 'Camera' } as CameraResponse,
};
beforeEach(() => {
  hooks.snapshot
    .mockReset()
    .mockReturnValue({ preview: {}, isLoading: false, errorStatus: null, retry: vi.fn() });
  hooks.raw
    .mockReset()
    .mockReturnValue({ image: {}, frame: {}, status: 'LIVE', errorStatus: null, retry: vi.fn() });
  hooks.recorded.mockReset().mockReturnValue({
    videoUrl: 'blob:recorded',
    isLoading: false,
    errorStatus: null,
    retry: vi.fn(),
  });
});
afterEach(cleanup);
it('activates exactly the selected transport and never overlays AI on raw video', () => {
  render(<FocusedCameraMedia {...props} />);
  expect(screen.getByTestId('ai-overlay')).toBeTruthy();
  expect(hooks.snapshot.mock.lastCall?.[0].enabled).toBe(true);
  expect(hooks.raw.mock.lastCall?.[0].enabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));
  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByTestId('raw-media')).toBeTruthy();
  expect(hooks.snapshot.mock.lastCall?.[0].enabled).toBe(false);
  expect(hooks.raw.mock.lastCall?.[0].enabled).toBe(true);
  expect(hooks.recorded.mock.lastCall?.[0].enabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded source video' }));
  expect(screen.queryByTestId('raw-media')).toBeNull();
  expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:recorded');
  expect(document.querySelector('video')?.hasAttribute('controls')).toBe(true);
  expect(hooks.raw.mock.lastCall?.[0].enabled).toBe(false);
  expect(hooks.recorded.mock.lastCall?.[0].enabled).toBe(true);
});
it('paused state disables every transport and suppresses even previously decoded media', () => {
  render(<FocusedCameraMedia {...props} aiPaused />);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded source video' }));
  for (const hook of Object.values(hooks)) expect(hook.mock.lastCall?.[0].enabled).toBe(false);
  expect(document.querySelector('video')).toBeNull();
  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('disabled');
});
it('a forbidden selected source shows unavailable without replaying the last AI snapshot', () => {
  hooks.raw.mockReturnValue({
    image: null,
    frame: null,
    status: 'HALTED',
    errorStatus: 403,
    retry: vi.fn(),
  });
  render(<FocusedCameraMedia {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));
  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('unavailable');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});
