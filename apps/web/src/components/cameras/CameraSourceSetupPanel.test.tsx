// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';
import type { CameraSourceClient } from '@smartsite/api-client';

afterEach(cleanup);
const host = {
  id: 'edge',
  label: 'AI at Site A',
  available: true,
  capabilities: {
    sourceKinds: ['WEBCAM', 'RTSP', 'VIDEO'] as ('WEBCAM' | 'RTSP' | 'VIDEO')[],
    webcams: [{ id: 'usb0', label: 'USB Camera' }],
    videos: [{ id: 'clip', label: 'Demo clip' }],
    browserCameraSupported: false,
    applySupported: false,
  },
};
function setup(client: CameraSourceClient) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <CameraSourceSetupPanel
        apiUrl="http://localhost"
        token="private-token"
        siteId="site-a"
        camera={{ id: 'cam-a', name: 'Gate camera' }}
        setupKey={['scope-a']}
        canWrite
        onUnauthorized={vi.fn()}
        client={client}
      />
    </QueryClientProvider>,
  );
}
describe('source-specific camera setup', () => {
  it('selects host webcam without RTSP and displays a real test result separately from applying AI', async () => {
    const user = userEvent.setup(),
      probe = vi.fn().mockResolvedValue({
        state: 'TESTED',
        receiptId: 'receipt',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        sourceKind: 'LIVE',
        frame: {
          width: 640,
          height: 480,
          capturedAt: new Date().toISOString(),
          imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        },
      });
    setup({ hosts: async () => [host], probe });
    await screen.findByRole('option', { name: 'AI at Site A' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^(AI host|Máy AI)$/ }), 'edge');
    await user.selectOptions(screen.getByLabelText(/Device|Thiết bị/), 'usb0');
    expect(screen.queryByLabelText(/RTSP URL|Địa chỉ RTSP/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    await screen.findByRole('img');
    expect(probe.mock.calls[0]?.[5]).toEqual({ kind: 'WEBCAM', deviceId: 'usb0' });
    expect(screen.getByText(/no source changes|not.*applied|chưa.*áp dụng/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start AI|Bật AI/ })).toBeNull();
  });
  it('source change cancels an in-flight test and rejects the stale response', async () => {
    let resolve!: (value: unknown) => void;
    const probe = vi.fn<CameraSourceClient['probe']>(
      () =>
        new Promise<never>((r) => {
          resolve = r as (value: unknown) => void;
        }),
    );
    setup({ hosts: async () => [host], probe: probe as CameraSourceClient['probe'] });
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'AI at Site A' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^(AI host|Máy AI)$/ }), 'edge');
    await user.selectOptions(screen.getByLabelText(/Device|Thiết bị/), 'usb0');
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    await user.click(screen.getByRole('radio', { name: /IP camera|Camera IP/ }));
    expect(probe.mock.calls[0]?.[6].aborted).toBe(true);
    resolve({
      state: 'TESTED',
      receiptId: 'stale',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      frame: { imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
    });
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
  });
});
