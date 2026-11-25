// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import { CameraSourceSetupPanel } from './CameraSourceSetupPanel';
import { SourceSetupError, type CameraSourceClient, type SourceHost } from '@smartsite/api-client';

beforeEach(async () => {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  await i18n.changeLanguage('en');
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
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
  it('separates registered camera, tested REPLAY receipt, saved backend vN, and applied worker stages without offering live activation for REPLAY or leaking RTSP passwords', async () => {
    const user = userEvent.setup();
    const probe = vi.fn().mockResolvedValue({
      state: 'TESTED',
      receiptId: 'replay-receipt',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      sourceKind: 'REPLAY',
      frame: {
        width: 640,
        height: 480,
        capturedAt: new Date().toISOString(),
        imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      },
    });
    setup({
      hosts: async () => [
        {
          ...host,
          capabilities: { ...host.capabilities, applySupported: true, sourceRevision: 1 },
        },
      ],
      probe,
      apply: vi.fn(),
    });
    await screen.findByRole('option', { name: 'AI at Site A' });
    const stageSummary = screen.getByTestId('camera-source-stage-summary');
    expect(stageSummary.textContent).toContain('Gate camera (metadata v12)');
    expect(stageSummary.textContent).toContain('Backend v12');
    expect(stageSummary.textContent).toContain('Not tested yet');

    await user.selectOptions(screen.getByRole('combobox', { name: /^(AI host|Máy AI)$/ }), 'edge');
    await user.click(screen.getByRole('radio', { name: /IP camera|Camera IP/ }));
    const pwInput = screen.getByLabelText(/Camera password|Mật khẩu camera/) as HTMLInputElement;
    await user.type(pwInput, 'secret-pass-1');
    expect(pwInput.value).toBe('secret-pass-1');

    // Switching to Recorded video clears transient RTSP password cleanly
    await user.click(screen.getByRole('radio', { name: /Recorded video|Video đã ghi/ }));
    await user.selectOptions(screen.getByLabelText(/Video/), 'clip');
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    await screen.findByRole('img');
    expect(screen.getByText(/RECORDED VIDEO · REPLAY/i)).toBeTruthy();
    expect(screen.getByText(/cannot be activated as a live AI source/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Save and activate|Lưu và kích hoạt/ })).toBeNull();
    expect(screen.getByTestId('camera-source-stage-summary').textContent).toContain(
      'REPLAY clip verified',
    );
  });

  describe('host prerequisite progressive disclosure and distinct states', () => {
    it('shows a clear no-host prerequisite gate for empty host lists, hides unusable source/host inputs, keeps Refresh hosts, and avoids conflicting disabled-camera test copy (EN/VI)', async () => {
      const user = userEvent.setup();
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="private-token"
            siteId="site-empty"
            camera={{
              id: 'cam-inactive',
              name: 'Yard Cam 1',
              configurationVersion: 1,
              status: 'INACTIVE',
            }}
            setupKey={['prereq-empty']}
            canWrite
            onUnauthorized={vi.fn()}
            client={{ hosts: hostsFn, probe: vi.fn() }}
          />
        </QueryClientProvider>,
      );

      const gate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(gate.getAttribute('role')).toBe('status');
      expect(gate.getAttribute('data-host-state')).toBe('empty');
      expect(
        within(gate).getByRole('heading', { name: /No AI machine is assigned to this Site/i }),
      ).toBeTruthy();
      expect(gate.textContent).toMatch(/Registering a camera only saves its details/i);
      expect(gate.textContent).toMatch(/Contact the AI operator/i);

      // Must NOT render unusable host selector, source-type radio cards, or fake onboarding links
      expect(screen.queryByRole('combobox', { name: /^(AI host|Máy AI)$/ })).toBeNull();
      expect(screen.queryByRole('radio', { name: /USB \/ host webcam/i })).toBeNull();
      expect(screen.queryByRole('radio', { name: /IP camera/i })).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();

      // Must NOT show conflicting "you can test a connection now" or "Test only" badge while no host exists
      expect(screen.getByTestId('camera-source-inactive-badge').textContent).not.toMatch(
        /Test only|Chỉ kiểm tra/i,
      );
      expect(screen.getByTestId('camera-source-inactive-notice').textContent).not.toMatch(
        /you can test a connection now/i,
      );

      // Keeps one honest recovery action: Refresh hosts
      const refreshBtn = within(gate).getByRole('button', { name: /Refresh hosts/i });
      await user.click(refreshBtn);
      await waitFor(() => expect(hostsFn).toHaveBeenCalledTimes(2));

      // Vietnamese copy parity
      await i18n.changeLanguage('vi');
      await waitFor(() => {
        const viGate = screen.getByTestId('camera-source-host-prerequisite');
        expect(
          within(viGate).getByRole('heading', { name: /Công trường này chưa có máy AI/i }),
        ).toBeTruthy();
        expect(viGate.textContent).toMatch(/Đăng ký camera chỉ lưu thông tin/i);
        expect(viGate.textContent).toMatch(/người vận hành/i);
        expect(viGate.textContent).not.toMatch(/nguồn hình vật lý|do vận hành gắn/i);
        expect(within(viGate).getByRole('button', { name: /Kiểm tra lại máy AI/i })).toBeTruthy();
      });
    });

    it('renders a distinct loading state without blank host selector or source radio cards while checking hosts', async () => {
      let resolveHosts!: (value: SourceHost[]) => void;
      const hostsFn = vi.fn<CameraSourceClient['hosts']>(
        () =>
          new Promise<SourceHost[]>((resolve) => {
            resolveHosts = resolve;
          }),
      );

      setup({ hosts: hostsFn, probe: vi.fn() });

      const loading = await screen.findByTestId('camera-source-host-loading');
      expect(loading.getAttribute('role')).toBe('status');
      expect(loading.textContent).toMatch(/Checking available AI hosts/i);
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();
      expect(screen.queryByRole('combobox', { name: /^(AI host|Máy AI)$/ })).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();

      resolveHosts([host]);
      expect(await screen.findByRole('option', { name: 'AI at Site A' })).toBeTruthy();
      expect(screen.queryByTestId('camera-source-host-loading')).toBeNull();
    });

    it('keeps request error with Retry distinct from empty and offline, hides unusable controls, and reveals source controls once Retry succeeds with an available host', async () => {
      const user = userEvent.setup();
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockRejectedValueOnce(new SourceSetupError(503))
        .mockResolvedValueOnce([host]);

      setup({ hosts: hostsFn, probe: vi.fn() });

      const errorGate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(errorGate.getAttribute('role')).toBe('alert');
      expect(errorGate.getAttribute('data-host-state')).toBe('error');
      expect(errorGate.textContent).toMatch(/Could not check AI hosts/i);
      expect(screen.queryByRole('combobox', { name: /^(AI host|Máy AI)$/ })).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();

      await user.click(within(errorGate).getByRole('button', { name: /Retry/i }));
      expect(await screen.findByRole('option', { name: 'AI at Site A' })).toBeTruthy();
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();
      expect(screen.getByRole('radio', { name: /USB \/ host webcam/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /IP camera \/ RTSP/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /Recorded video/i })).toBeTruthy();

      // Browser camera option remains explicitly unsupported when an available host exists
      await user.click(screen.getByRole('radio', { name: /This browser camera/i }));
      expect(screen.getByRole('status').textContent).toMatch(
        /Browser camera transport to AI is not available/i,
      );
    });

    it('keeps all-hosts-offline distinct from empty list, hides unusable controls, and preserves sibling offline selection when another host is online', async () => {
      const user = userEvent.setup();
      const offlineHost: SourceHost = {
        id: 'edge-off',
        label: 'Site A Edge Box',
        available: false,
      };
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockResolvedValueOnce([offlineHost])
        .mockResolvedValueOnce([host, offlineHost]);

      setup({ hosts: hostsFn, probe: vi.fn() });

      const offlineGate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(offlineGate.getAttribute('role')).toBe('status');
      expect(offlineGate.getAttribute('data-host-state')).toBe('offline');
      expect(
        within(offlineGate).getByRole('heading', {
          name: /Assigned AI host is currently unavailable/i,
        }),
      ).toBeTruthy();
      expect(offlineGate.textContent).toMatch(/Site A Edge Box/);
      expect(screen.queryByRole('combobox', { name: /^(AI host|Máy AI)$/ })).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();

      // Refreshing to a mix of online + offline hosts reveals source controls and still allows inspecting offline sibling status
      await user.click(within(offlineGate).getByRole('button', { name: /Refresh hosts/i }));
      const hostSelect = await screen.findByRole('combobox', { name: /^(AI host|Máy AI)$/ });
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();
      await user.selectOptions(hostSelect, 'edge-off');
      expect(
        screen.getByText(/The selected AI host is offline or does not support source setup/i),
      ).toBeTruthy();
    });

    it('keeps forbidden (403) distinct from error/empty/offline and invokes onUnauthorized', async () => {
      const onUnauthorized = vi.fn();
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="expired-token"
            siteId="site-a"
            camera={{ id: 'cam-a', name: 'Gate camera', configurationVersion: 1 }}
            setupKey={['prereq-forbidden']}
            canWrite
            onUnauthorized={onUnauthorized}
            client={{
              hosts: vi.fn().mockRejectedValue(new SourceSetupError(403)),
              probe: vi.fn(),
            }}
          />
        </QueryClientProvider>,
      );

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/session no longer permits camera setup/i);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
    });

    it('scope replacement aborts in-flight host check and in-flight source probe while ignoring stale responses', async () => {
      const user = userEvent.setup();
      let resolveHostsA!: (value: SourceHost[]) => void;
      let hostsASignal: AbortSignal | undefined;
      let probeASignal: AbortSignal | undefined;
      let resolveProbeA!: (value: unknown) => void;

      const hostsFn = vi.fn<CameraSourceClient['hosts']>((_api, _tok, siteId, _camId, signal) => {
        if (siteId === 'site-pending') {
          hostsASignal = signal;
          return new Promise<SourceHost[]>((resolve) => {
            resolveHostsA = resolve;
          });
        }
        return Promise.resolve([host]);
      });

      const probeFn = vi.fn<CameraSourceClient['probe']>(
        (_api, _tok, _siteId, _camId, _hostId, _draft, signal) => {
          probeASignal = signal;
          return new Promise<never>((resolve) => {
            resolveProbeA = resolve as (value: unknown) => void;
          });
        },
      );

      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const view = render(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-pending"
            camera={{ id: 'cam-1', name: 'Cam 1', configurationVersion: 1 }}
            setupKey={['scope-1']}
            canWrite
            onUnauthorized={vi.fn()}
            client={{ hosts: hostsFn, probe: probeFn }}
          />
        </QueryClientProvider>,
      );

      await screen.findByTestId('camera-source-host-loading');
      expect(hostsASignal?.aborted).toBe(false);

      // Replace scope to site-b -> previous hosts() AbortSignal is aborted
      view.rerender(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-b"
            camera={{ id: 'cam-2', name: 'Cam 2', configurationVersion: 1 }}
            setupKey={['scope-2']}
            canWrite
            onUnauthorized={vi.fn()}
            client={{ hosts: hostsFn, probe: probeFn }}
          />
        </QueryClientProvider>,
      );

      await waitFor(() => expect(hostsASignal?.aborted).toBe(true));
      resolveHostsA([]);

      // Start an in-flight probe on site-b, then replace camera scope -> probe AbortSignal aborts and stale image is ignored
      await screen.findByRole('option', { name: 'AI at Site A' });
      await user.selectOptions(screen.getByLabelText(/Device|Thiết bị/), 'usb0');
      await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
      expect(probeASignal?.aborted).toBe(false);

      view.rerender(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-b"
            camera={{ id: 'cam-3', name: 'Cam 3', configurationVersion: 1 }}
            setupKey={['scope-3']}
            canWrite
            onUnauthorized={vi.fn()}
            client={{ hosts: hostsFn, probe: probeFn }}
          />
        </QueryClientProvider>,
      );

      expect(probeASignal?.aborted).toBe(true);
      resolveProbeA({
        state: 'TESTED',
        receiptId: 'stale-scope-receipt',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        sourceKind: 'LIVE',
        frame: {
          width: 640,
          height: 480,
          capturedAt: new Date().toISOString(),
          imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        },
      });
      await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    });

    it('blocks new apply/resume and hides stale source/footer controls on retained-data hosts.isError after a LIVE probe, while preserving uncertain committed apply reconciliation status', async () => {
      const user = userEvent.setup();
      const applyHost: SourceHost = {
        ...host,
        capabilities: {
          ...host.capabilities,
          applySupported: true,
          configurationResumeSupported: true,
          sourceRevision: 2,
        },
      };
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockResolvedValueOnce([applyHost])
        .mockRejectedValueOnce(new SourceSetupError(503))
        .mockResolvedValueOnce([applyHost])
        .mockRejectedValueOnce(new SourceSetupError(503));

      const probeFn = vi.fn<CameraSourceClient['probe']>().mockResolvedValue({
        state: 'TESTED',
        receiptId: 'live-receipt-retained',
        expiresAt: new Date(Date.now() + 60000).toISOString(),
        sourceKind: 'LIVE',
        frame: {
          width: 640,
          height: 480,
          capturedAt: new Date().toISOString(),
          imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        },
      });
      const applyFn = vi
        .fn<NonNullable<CameraSourceClient['apply']>>()
        .mockRejectedValueOnce(new SourceSetupError(503));
      const resumeFn = vi.fn<NonNullable<CameraSourceClient['resume']>>();

      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-a"
            camera={{ id: 'cam-a', name: 'Gate camera', configurationVersion: 12 }}
            setupKey={['retained-error-scope']}
            canWrite
            onUnauthorized={vi.fn()}
            client={{ hosts: hostsFn, probe: probeFn, apply: applyFn, resume: resumeFn }}
          />
        </QueryClientProvider>,
      );

      // 1) Initial load succeeds and user gets a valid LIVE probe receipt
      await screen.findByRole('option', { name: 'AI at Site A' });
      await user.selectOptions(screen.getByLabelText(/Device|Thiết bị/), 'usb0');
      await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
      expect(
        await screen.findByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
      ).toBeTruthy();

      // 2) Background hosts refetch rejects while retaining previous hosts.data (NO reset click)
      await cache.refetchQueries({
        queryKey: ['retained-error-scope', 'camera-source-hosts', 'site-a', 'cam-a'],
      });

      const errorGate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(errorGate.getAttribute('role')).toBe('alert');
      expect(errorGate.getAttribute('data-host-state')).toBe('error');
      expect(
        screen.queryByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
      ).toBeNull();
      expect(screen.queryByRole('combobox', { name: /^(AI host|Máy AI)$/ })).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByTestId('camera-source-resume-card')).toBeNull();
      expect(screen.queryByText(/After connecting the source/i)).toBeNull();
      expect(applyFn).not.toHaveBeenCalled();

      // 3) Retry recovers hosts -> re-test LIVE receipt -> apply rejects with uncertain 503
      await user.click(within(errorGate).getByRole('button', { name: /Retry|Thử lại/i }));
      await screen.findByRole('option', { name: 'AI at Site A' });
      await user.selectOptions(screen.getByLabelText(/Device|Thiết bị/), 'usb0');
      await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
      await user.click(
        await screen.findByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
      );
      await screen.findByText(/Activation was not confirmed/i);
      expect(applyFn).toHaveBeenCalledTimes(1);

      // 4) Subsequent background hosts refetch fails with retained data -> uncertain apply reconciliation alert MUST stay visible while new apply stays blocked
      await cache.refetchQueries({
        queryKey: ['retained-error-scope', 'camera-source-hosts', 'site-a', 'cam-a'],
      });
      await screen.findByTestId('camera-source-host-prerequisite');
      expect(screen.getByText(/Activation was not confirmed/i)).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
      ).toBeNull();
      expect(applyFn).toHaveBeenCalledTimes(1);
    });
  });
});
