// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';
import { SourceSetupError, type CameraSourceClient } from '@smartsite/api-client';

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
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const atVersion = (version: number) => (
    <QueryClientProvider client={cache}>
      <CameraSourceSetupPanel
        apiUrl="http://localhost"
        token="private-token"
        siteId="site-a"
        camera={{ id: 'cam-a', name: 'Gate camera', configurationVersion: version }}
        setupKey={['scope-a']}
        canWrite
        onUnauthorized={vi.fn()}
        client={client}
      />
    </QueryClientProvider>
  );
  const view = render(atVersion(12));
  return { ...view, setCameraVersion: (version: number) => view.rerender(atVersion(version)) };
}
describe('source-specific camera setup', () => {
  it('manually retries an uncertain result with the exact original command, never a new request', async () => {
    const resume = vi
      .fn()
      .mockRejectedValueOnce(new SourceSetupError(503))
      .mockResolvedValue({
        state: 'STARTED',
        sourceRevision: 2,
        configurationVersion: 12,
        currentGenerationId: 'new-owner',
        viewRevision: 7,
        bundleSha256: 'a'.repeat(64),
      });
    setup({
      hosts: async () => [
        {
          ...host,
          capabilities: {
            ...host.capabilities,
            configurationResumeSupported: true,
            sourceRevision: 2,
          },
        },
      ],
      probe: vi.fn(),
      resume,
    } as CameraSourceClient);
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'AI at Site A' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^(AI host|Máy AI)$/ }), 'edge');
    await user.click(
      await screen.findByRole('button', {
        name: /Apply saved configuration|Áp dụng cấu hình đã lưu/,
      }),
    );
    const retry = await screen.findByRole('button', {
      name: /Retry the same request|Thử lại cùng yêu cầu/,
    });
    expect(resume).toHaveBeenCalledTimes(1);
    await user.click(retry);
    await screen.findByText(/Check configuration status|Kiểm tra trạng thái cấu hình/);
    expect(resume).toHaveBeenCalledTimes(2);
    expect(resume.mock.calls[1]?.[5]).toEqual(resume.mock.calls[0]?.[5]);
  });
  it('resumes saved configuration without testing or replacing the source', async () => {
    const resume = vi.fn().mockResolvedValue({
      state: 'STARTED',
      commandId: 'resume',
      sourceRevision: 2,
      currentGenerationId: 'new-owner',
      configurationVersion: 12,
      viewRevision: 7,
      bundleSha256: 'a'.repeat(64),
    });
    const probe = vi.fn();
    const view = setup({
      hosts: async () => [
        {
          ...host,
          capabilities: {
            ...host.capabilities,
            configurationResumeSupported: true,
            sourceRevision: 2,
          },
        },
      ],
      probe,
      resume,
    } as CameraSourceClient);
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'AI at Site A' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^(AI host|Máy AI)$/ }), 'edge');
    await user.click(
      await screen.findByRole('button', {
        name: /Apply saved configuration|Áp dụng cấu hình đã lưu/,
      }),
    );
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(probe).not.toHaveBeenCalled();
    expect(resume.mock.calls[0]?.[5]).toMatchObject({
      expectedRevision: 2,
      expectedConfigurationVersion: 12,
    });
    expect(
      await screen.findByText(/Check configuration status|Kiểm tra trạng thái cấu hình/),
    ).toBeTruthy();
    view.setCameraVersion(13);
    const applyAgain = screen.getByRole('button', {
      name: /Apply saved configuration|Áp dụng cấu hình đã lưu/,
    });
    await waitFor(() => expect((applyAgain as HTMLButtonElement).disabled).toBe(false));
    await user.click(applyAgain);
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(2));
    expect(resume.mock.calls[1]?.[5]).toMatchObject({ expectedConfigurationVersion: 13 });
  });
  it('applies only a successful live receipt and reports running separately from geometry/PPE setup', async () => {
    const user = userEvent.setup();
    const apply = vi.fn().mockResolvedValue({
      state: 'RUNNING',
      commandId: 'command',
      sourceRevision: 1,
      sourceKind: 'LIVE',
      currentGenerationId: 'generation',
    });
    setup({
      hosts: async () => [
        {
          ...host,
          capabilities: { ...host.capabilities, applySupported: true, sourceRevision: 0 },
        },
      ],
      probe: async () => ({
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
      }),
      apply,
    });
    await screen.findByRole('option', { name: 'AI at Site A' });
    await user.selectOptions(screen.getByRole('combobox', { name: /^(AI host|Máy AI)$/ }), 'edge');
    await user.selectOptions(screen.getByLabelText(/Device|Thiết bị/), 'usb0');
    expect(screen.queryByRole('button', { name: /Save and activate|Lưu và kích hoạt/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    await user.click(
      await screen.findByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
    );
    await screen.findByText(/Source is running|Nguồn đang chạy/);
    expect(apply.mock.calls[0]?.[5]).toMatchObject({ receiptId: 'receipt', expectedRevision: 0 });
  });
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
