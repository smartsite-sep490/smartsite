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
  it('applies only a successful live receipt after explicit replacement confirmation and reports running separately from geometry/PPE setup', async () => {
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
    await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
    expect(screen.queryByRole('button', { name: /Save and activate|Lưu và kích hoạt/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
    await user.click(
      await screen.findByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
    );
    expect(apply).not.toHaveBeenCalled();
    expect(screen.getByTestId('camera-source-apply-confirm')).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: /Confirm source replacement|Xác nhận đổi nguồn/ }),
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
    await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
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
    await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
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
    await screen.findByLabelText(/Device|Thiết bị/);
    const stageSummary = screen.getByTestId('camera-source-stage-summary');
    expect(stageSummary.textContent).toContain('Gate camera (metadata v12)');
    expect(stageSummary.textContent).toContain('Backend v12');
    expect(stageSummary.textContent).toContain('Not tested yet');

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
        within(gate).getByRole('heading', {
          name: /No camera connection is set up for this site/i,
        }),
      ).toBeTruthy();
      expect(gate.textContent).toMatch(/Registering a camera only saves its details/i);
      expect(gate.textContent).toMatch(/Ask your operator/i);

      // Must NOT render unusable host selector, source-type radio cards, or fake onboarding links
      expect(
        screen.queryByRole('combobox', {
          name: /^(AI host|Máy AI|Camera processing computer|Máy xử lý camera)$/,
        }),
      ).toBeNull();
      expect(screen.queryByRole('radio', { name: /USB camera connected at site/i })).toBeNull();
      expect(screen.queryByRole('radio', { name: /IP camera/i })).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();

      // Must NOT show conflicting "you can test a connection now" or "Test only" badge while no host exists
      expect(screen.getByTestId('camera-source-inactive-badge').textContent).not.toMatch(
        /Test only|Chỉ kiểm tra/i,
      );
      expect(screen.getByTestId('camera-source-inactive-notice').textContent).not.toMatch(
        /you can test a connection now/i,
      );

      // Keeps one honest recovery action: Check connection again
      const refreshBtn = within(gate).getByRole('button', { name: /Check connection again/i });
      await user.click(refreshBtn);
      await waitFor(() => expect(hostsFn).toHaveBeenCalledTimes(2));

      // Vietnamese copy parity
      await i18n.changeLanguage('vi');
      await waitFor(() => {
        const viGate = screen.getByTestId('camera-source-host-prerequisite');
        expect(
          within(viGate).getByRole('heading', {
            name: /Công trường này chưa có kết nối xử lý camera/i,
          }),
        ).toBeTruthy();
        expect(viGate.textContent).toMatch(/Đăng ký camera chỉ lưu thông tin/i);
        expect(viGate.textContent).toMatch(/người vận hành/i);
        expect(viGate.textContent).not.toMatch(/nguồn hình vật lý|do vận hành gắn|máy AI/i);
        expect(within(viGate).getByRole('button', { name: /Kiểm tra lại kết nối/i })).toBeTruthy();
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
      expect(loading.textContent).toMatch(/Checking camera connection/i);
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();
      expect(
        screen.queryByRole('combobox', {
          name: /^(AI host|Máy AI|Camera processing computer|Máy xử lý camera)$/,
        }),
      ).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();

      resolveHosts([host]);
      expect(await screen.findByLabelText(/Device|Thiết bị/)).toBeTruthy();
      expect(screen.queryByTestId('camera-source-host-loading')).toBeNull();
    });

    it('keeps request error with Retry distinct from empty and unavailable, hides unusable controls, reveals source controls once Retry succeeds with an available host, and explains browser camera vs site USB clearly', async () => {
      const user = userEvent.setup();
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockRejectedValueOnce(new SourceSetupError(503))
        .mockResolvedValueOnce([host]);

      setup({ hosts: hostsFn, probe: vi.fn() });

      const errorGate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(errorGate.getAttribute('role')).toBe('alert');
      expect(errorGate.getAttribute('data-host-state')).toBe('error');
      expect(errorGate.textContent).toMatch(/Could not check camera connection/i);
      expect(
        screen.queryByRole('combobox', {
          name: /^(AI host|Máy AI|Camera processing computer|Máy xử lý camera)$/,
        }),
      ).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();

      await user.click(within(errorGate).getByRole('button', { name: /Retry/i }));
      expect(await screen.findByLabelText(/Device|Thiết bị/)).toBeTruthy();
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();
      expect(screen.getByRole('radio', { name: /USB camera connected at site/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /IP camera \/ RTSP/i })).toBeTruthy();
      expect(screen.getByRole('radio', { name: /Recorded video/i })).toBeTruthy();

      // Browser camera option remains explicitly unsupported and explains webcam0 belongs to the connected site machine, not viewing computer
      await user.click(screen.getByRole('radio', { name: /This browser camera/i }));
      const browserStatus = screen.getByRole('status');
      expect(browserStatus.textContent).toMatch(/webcam0/i);
      expect(browserStatus.textContent).toMatch(/connected processing machine/i);
      expect(browserStatus.textContent).toMatch(/not the computer you are viewing/i);

      await i18n.changeLanguage('vi');
      await waitFor(() => {
        expect(screen.getByRole('radio', { name: /Camera USB đã kết nối/i })).toBeTruthy();
        expect(screen.getByRole('status').textContent).toMatch(/webcam0/i);
        expect(screen.getByRole('status').textContent).toMatch(/không phải máy bạn đang xem/i);
      });
    });

    it('keeps per-camera unavailable distinct from empty list, hides unusable controls, and preserves sibling unavailable inspection inside connection details when another host is usable', async () => {
      const user = userEvent.setup();
      const unavailableHost: SourceHost = {
        id: 'edge-off',
        label: 'Site A Edge Box',
        available: false,
      };
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockResolvedValueOnce([unavailableHost])
        .mockResolvedValueOnce([host, unavailableHost]);

      setup({ hosts: hostsFn, probe: vi.fn() });

      const unavailGate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(unavailGate.getAttribute('role')).toBe('status');
      expect(unavailGate.getAttribute('data-host-state')).toBe('unavailable');
      expect(
        within(unavailGate).getByRole('heading', {
          name: /Cannot connect this camera yet/i,
        }),
      ).toBeTruthy();
      expect(unavailGate.textContent).toMatch(/Site A Edge Box/);
      expect(unavailGate.textContent).not.toMatch(/\boffline\b/i);
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();

      // Refreshing to a mix of 1 usable + 1 unavailable sibling auto-binds the usable host in primary flow and allows inspecting the unavailable sibling inside Connection details
      await user.click(
        within(unavailGate).getByRole('button', { name: /Check connection again/i }),
      );
      expect(await screen.findByLabelText(/Device|Thiết bị/)).toBeTruthy();
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();
      const details = screen.getByTestId('camera-source-connection-details') as HTMLDetailsElement;
      expect(details.open).toBe(false);
      details.open = true;
      const hostSelect = within(details).getByRole('combobox', {
        name: 'Camera processing computer',
      });
      await user.selectOptions(hostSelect, 'edge-off');
      expect(
        screen.getByText(
          /Cannot connect this camera through the selected camera processing computer/i,
        ),
      ).toBeTruthy();
      expect(screen.getByText(/Cannot connect this camera through/i).textContent).not.toMatch(
        /\boffline\b/i,
      );
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
      await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
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
      await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
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
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('radio')).toBeNull();
      expect(screen.queryByTestId('camera-source-resume-card')).toBeNull();
      expect(screen.queryByText(/After connecting the source/i)).toBeNull();
      expect(applyFn).not.toHaveBeenCalled();

      // 3) Retry recovers hosts -> re-test LIVE receipt -> explicit confirmation -> apply rejects with uncertain 503
      await user.click(within(errorGate).getByRole('button', { name: /Retry|Thử lại/i }));
      await user.selectOptions(await screen.findByLabelText(/Device|Thiết bị/), 'usb0');
      await user.click(screen.getByRole('button', { name: /Test connection|Kiểm tra kết nối/ }));
      await user.click(
        await screen.findByRole('button', { name: /Save and activate|Lưu và kích hoạt/ }),
      );
      await user.click(
        await screen.findByRole('button', {
          name: /Confirm source replacement|Xác nhận đổi nguồn/,
        }),
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

    it('auto-binds a single usable host without a primary host selector, shows truthful connection status only when proved, avoids automatic mutations, and uses plain VI/EN copy', async () => {
      const user = userEvent.setup();
      const probe = vi.fn<CameraSourceClient['probe']>().mockResolvedValue({
        state: 'TESTED',
        receiptId: 'live-receipt-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        sourceKind: 'LIVE',
        frame: {
          width: 640,
          height: 360,
          capturedAt: new Date().toISOString(),
          imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        },
      });
      const apply = vi.fn<NonNullable<CameraSourceClient['apply']>>().mockResolvedValue({
        state: 'RUNNING',
        commandId: 'apply-cmd-1',
        sourceKind: 'LIVE',
        sourceRevision: 1,
        currentGenerationId: 'gen-live-1',
      });
      const resume = vi.fn<NonNullable<CameraSourceClient['resume']>>();
      const soleHost: SourceHost = {
        ...host,
        id: 'sole-edge',
        label: 'Site A Processing PC',
        capabilities: {
          ...host.capabilities,
          applySupported: true,
          configurationResumeSupported: true,
          sourceRevision: 0,
        },
      };

      setup({ hosts: async () => [soleHost], probe, apply, resume });

      // Primary form immediately exposes real device choice without any primary host selector
      const deviceSelect = await screen.findByLabelText(/Device|Thiết bị/);
      expect(deviceSelect).toBeTruthy();
      expect(
        screen.queryByRole('combobox', {
          name: /AI host|Máy AI|processing computer|Máy xử lý camera/i,
        }),
      ).toBeNull();
      expect(probe).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();

      // Connection details live in a collapsed <details> with bound host label and concise explanation
      const details = screen.getByTestId('camera-source-connection-details') as HTMLDetailsElement;
      expect(details.tagName).toBe('DETAILS');
      expect(details.open).toBe(false);
      expect(within(details).getByTestId('camera-source-bound-host').textContent).toContain(
        'Site A Processing PC',
      );
      expect(details.textContent).toMatch(/camera processing computer/i);
      expect(details.textContent).toMatch(/stay online/i);

      // Status is neutral Source not checked before running a test in this page session (never false-negative Not connected)
      const statusPill = screen.getByTestId('camera-source-connection-status');
      expect(statusPill.textContent).toBe('Source not checked');
      expect(statusPill.getAttribute('data-connection-status')).toBe('not-checked');
      expect(statusPill.textContent).not.toMatch(
        /Not connected|Chưa kết nối|Connected|Đã kết nối/i,
      );

      await user.selectOptions(deviceSelect, 'usb0');
      expect(probe).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Test connection' }));
      await screen.findByRole('img');
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe.mock.calls[0]?.[4]).toBe('sole-edge');
      expect(apply).not.toHaveBeenCalled();
      expect(screen.getByTestId('camera-source-connection-status').textContent).toBe(
        'Test preview ready',
      );
      expect(
        screen
          .getByTestId('camera-source-connection-status')
          .getAttribute('data-connection-status'),
      ).toBe('tested');

      // Only after explicit confirmation and activation acknowledgement does status update (still not persistent LIVE proof)
      expect(screen.getByTestId('camera-source-shared-notice').textContent).toMatch(
        /same saved physical source/i,
      );
      await user.click(screen.getByRole('button', { name: 'Save and activate source' }));
      expect(apply).not.toHaveBeenCalled();
      const confirmBox = screen.getByTestId('camera-source-apply-confirm');
      expect(confirmBox.textContent).toMatch(/fresh reference image/i);
      await user.click(within(confirmBox).getByRole('button', { name: 'Cancel' }));
      expect(apply).not.toHaveBeenCalled();
      expect(screen.getByTestId('camera-source-connection-status').textContent).toBe(
        'Test preview ready',
      );

      await user.click(screen.getByRole('button', { name: 'Save and activate source' }));
      await user.click(screen.getByRole('button', { name: 'Confirm source replacement' }));
      await waitFor(() =>
        expect(screen.getByTestId('camera-source-connection-status').textContent).toBe(
          'Activation acknowledged',
        ),
      );
      expect(
        screen
          .getByTestId('camera-source-connection-status')
          .getAttribute('data-connection-status'),
      ).toBe('activation-acknowledged');
      expect(screen.getByText(/does not prove ongoing live monitoring/i)).toBeTruthy();

      // Vietnamese copy parity: heading Kết nối camera, honest page-local activation acknowledgement (not persistent LIVE proof), no máy AI jargon
      await i18n.changeLanguage('vi');
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: 'Kết nối camera' })).toBeTruthy();
        expect(screen.getByTestId('camera-source-connection-status').textContent).toBe(
          'Đã ghi nhận kích hoạt',
        );
        expect(screen.getByRole('button', { name: 'Kiểm tra kết nối' })).toBeTruthy();
      });
      const panelText = screen.getByTestId('camera-source-setup-panel').textContent ?? '';
      expect(panelText).not.toMatch(/máy AI/i);
      expect(details.textContent).toMatch(/Máy xử lý camera/i);
      expect(details.textContent).toMatch(/duy trì trực tuyến/i);
    });

    it('puts multi-host selection inside collapsed connection details with an accessible actionable choice prompt, binds chosen host, cancels in-flight probe on host switch, and surfaces 409 busy honestly (EN/VI)', async () => {
      const user = userEvent.setup();
      let resolveProbeA!: (value: unknown) => void;
      let probeASignal: AbortSignal | undefined;
      const probe = vi
        .fn<CameraSourceClient['probe']>()
        .mockImplementationOnce((_api, _tok, _site, _cam, _hostId, _draft, signal) => {
          probeASignal = signal;
          return new Promise<never>((resolve) => {
            resolveProbeA = resolve as (value: unknown) => void;
          });
        })
        .mockRejectedValueOnce(new SourceSetupError(409));

      const hostA: SourceHost = {
        ...host,
        id: 'edge-a',
        label: 'North Processing PC',
        capabilities: {
          ...host.capabilities,
          webcams: [{ id: 'usb-a', label: 'North USB Cam' }],
        },
      };
      const hostB: SourceHost = {
        ...host,
        id: 'edge-b',
        label: 'South Processing PC',
        capabilities: {
          ...host.capabilities,
          webcams: [{ id: 'usb-b', label: 'South USB Cam' }],
        },
      };

      setup({ hosts: async () => [hostA, hostB], probe });

      // Connection details starts collapsed, and an accessible prompt guides the user instead of a blank blocker
      const prompt = await screen.findByTestId('camera-source-host-choice-required');
      expect(prompt.getAttribute('role')).toBe('status');
      const details = screen.getByTestId('camera-source-connection-details') as HTMLDetailsElement;
      expect(details.open).toBe(false);
      expect(probe).not.toHaveBeenCalled();

      // Clicking Choose connection opens connection details and focuses the host select
      await user.click(within(prompt).getByRole('button', { name: 'Choose connection' }));
      expect(details.open).toBe(true);
      const hostSelect = within(details).getByRole('combobox', {
        name: 'Camera processing computer',
      });
      expect(document.activeElement).toBe(hostSelect);

      // Select host A, start in-flight probe, then switch to host B -> aborts host A probe & ignores stale result
      await user.selectOptions(hostSelect, 'edge-a');
      expect(screen.queryByTestId('camera-source-host-choice-required')).toBeNull();
      await user.selectOptions(screen.getByLabelText('Device'), 'usb-a');
      await user.click(screen.getByRole('button', { name: 'Test connection' }));
      expect(probeASignal?.aborted).toBe(false);
      expect(probe.mock.calls[0]?.[4]).toBe('edge-a');

      await user.selectOptions(hostSelect, 'edge-b');
      expect(probeASignal?.aborted).toBe(true);
      resolveProbeA({
        state: 'TESTED',
        receiptId: 'stale-host-a',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        sourceKind: 'LIVE',
        frame: {
          width: 640,
          height: 360,
          capturedAt: new Date().toISOString(),
          imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        },
      });
      await waitFor(() => expect(screen.queryByRole('img')).toBeNull());

      // Testing host B with 409 busy surfaces explicit busy alert without taking over another camera's source
      await user.selectOptions(screen.getByLabelText('Device'), 'usb-b');
      await user.click(screen.getByRole('button', { name: 'Test connection' }));
      const busyAlert = await screen.findByRole('alert');
      expect(busyAlert.textContent).toMatch(/already testing|busy/i);
      expect(probe.mock.calls[1]?.[4]).toBe('edge-b');
    });

    it('distinguishes empty inventory, CAMERA_UNBOUND, AGENT_UNAVAILABLE, mixed, and legacy unavailable states cleanly in EN/VI with technical host details collapsed (no host name in main paragraph) and read-only retry', async () => {
      const user = userEvent.setup();
      const unboundHost: SourceHost = {
        id: 'edge-cam1-only',
        label: 'Site Main PC',
        available: false,
        reason: 'CAMERA_UNBOUND',
      };
      const unreachableHost: SourceHost = {
        id: 'edge-unreachable-2',
        label: 'Backup Processing PC',
        available: false,
        reason: 'AGENT_UNAVAILABLE',
      };
      const legacyHost: SourceHost = {
        id: 'edge-legacy-3',
        label: 'Legacy Site Box',
        available: false,
      };
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockResolvedValueOnce([unboundHost])
        .mockResolvedValueOnce([unreachableHost])
        .mockResolvedValueOnce([unboundHost, unreachableHost])
        .mockResolvedValueOnce([legacyHost])
        .mockResolvedValueOnce([]);
      const probe = vi.fn<CameraSourceClient['probe']>();
      const apply = vi.fn<NonNullable<CameraSourceClient['apply']>>();
      const resume = vi.fn<NonNullable<CameraSourceClient['resume']>>();

      setup({ hosts: hostsFn, probe, apply, resume });

      // 1) All CAMERA_UNBOUND (EN + VI)
      const unboundGate = await screen.findByTestId('camera-source-host-prerequisite');
      expect(unboundGate.getAttribute('role')).toBe('status');
      expect(unboundGate.getAttribute('data-host-state')).toBe('unbound');
      expect(
        within(unboundGate).getByRole('heading', {
          name: 'Camera is not connected to a video source yet',
        }),
      ).toBeTruthy();
      const unboundMsg = within(unboundGate).getByTestId('camera-source-prerequisite-message');
      expect(unboundMsg.textContent).not.toContain('Site Main PC');
      expect(unboundMsg.textContent).not.toContain('edge-cam1-only');
      expect(unboundMsg.textContent).not.toMatch(/\boffline\b|powered off|operational/i);
      const unboundDetails = within(unboundGate).getByTestId(
        'camera-source-unavailable-details',
      ) as HTMLDetailsElement;
      expect(unboundDetails.tagName).toBe('DETAILS');
      expect(unboundDetails.open).toBe(false);
      expect(unboundDetails.textContent).toContain('Site Main PC');
      expect(unboundDetails.textContent).toContain('edge-cam1-only');
      expect(unboundDetails.textContent).toContain('CAMERA_UNBOUND');
      // Only one read-only refresh action (no fake connect/provision button)
      expect(within(unboundGate).getAllByRole('button')).toHaveLength(1);
      expect(probe).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();

      await i18n.changeLanguage('vi');
      await waitFor(() => {
        expect(
          within(unboundGate).getByRole('heading', {
            name: 'Camera chưa được kết nối với nguồn hình',
          }),
        ).toBeTruthy();
      });
      expect(
        within(unboundGate).getByTestId('camera-source-prerequisite-message').textContent,
      ).not.toContain('Site Main PC');
      expect(
        within(unboundGate).getByTestId('camera-source-prerequisite-message').textContent,
      ).not.toMatch(/ngoại tuyến|tắt nguồn|máy AI/i);

      // 2) Refresh -> All AGENT_UNAVAILABLE (VI + EN)
      await user.click(within(unboundGate).getByRole('button', { name: /Kiểm tra lại kết nối/i }));
      await waitFor(() => {
        expect(
          screen.getByTestId('camera-source-host-prerequisite').getAttribute('data-host-state'),
        ).toBe('agent-unavailable');
      });
      const agentGate = screen.getByTestId('camera-source-host-prerequisite');
      expect(
        within(agentGate).getByRole('heading', {
          name: 'Hiện chưa truy cập được dịch vụ xử lý camera',
        }),
      ).toBeTruthy();
      const agentMsgVi = within(agentGate).getByTestId('camera-source-prerequisite-message');
      expect(agentMsgVi.textContent).not.toContain('Backup Processing PC');
      expect(agentMsgVi.textContent).not.toMatch(/ngoại tuyến|tắt nguồn|máy AI/i);
      const agentDetails = within(agentGate).getByTestId(
        'camera-source-unavailable-details',
      ) as HTMLDetailsElement;
      expect(agentDetails.open).toBe(false);
      expect(agentDetails.textContent).toContain('Backup Processing PC');
      expect(agentDetails.textContent).toContain('edge-unreachable-2');
      expect(agentDetails.textContent).toContain('AGENT_UNAVAILABLE');

      await i18n.changeLanguage('en');
      await waitFor(() => {
        expect(
          within(agentGate).getByRole('heading', {
            name: 'Camera processing service is currently unreachable',
          }),
        ).toBeTruthy();
      });
      expect(
        within(agentGate).getByTestId('camera-source-prerequisite-message').textContent,
      ).not.toContain('Backup Processing PC');
      expect(
        within(agentGate).getByTestId('camera-source-prerequisite-message').textContent,
      ).not.toMatch(/\boffline\b|powered off/i);

      // 3) Refresh -> Mixed CAMERA_UNBOUND + AGENT_UNAVAILABLE retains safe generic state with per-host details collapsed
      await user.click(within(agentGate).getByRole('button', { name: /Check connection again/i }));
      await waitFor(() => {
        expect(
          screen.getByTestId('camera-source-host-prerequisite').getAttribute('data-host-state'),
        ).toBe('unavailable');
      });
      const mixedGate = screen.getByTestId('camera-source-host-prerequisite');
      expect(
        within(mixedGate).getByRole('heading', { name: 'Cannot connect this camera yet' }),
      ).toBeTruthy();
      const mixedMsg = within(mixedGate).getByTestId('camera-source-prerequisite-message');
      expect(mixedMsg.textContent).not.toContain('Site Main PC');
      expect(mixedMsg.textContent).not.toContain('Backup Processing PC');
      expect(mixedMsg.textContent).not.toMatch(/\boffline\b/i);
      const mixedDetails = within(mixedGate).getByTestId(
        'camera-source-unavailable-details',
      ) as HTMLDetailsElement;
      expect(mixedDetails.open).toBe(false);
      expect(mixedDetails.textContent).toContain('Site Main PC');
      expect(mixedDetails.textContent).toContain('CAMERA_UNBOUND');
      expect(mixedDetails.textContent).toContain('Backup Processing PC');
      expect(mixedDetails.textContent).toContain('AGENT_UNAVAILABLE');

      // 4) Refresh -> Legacy unavailable (no reason field) stays distinct generic unavailable without claiming offline
      await user.click(within(mixedGate).getByRole('button', { name: /Check connection again/i }));
      await waitFor(() => {
        expect(
          within(screen.getByTestId('camera-source-host-prerequisite')).getByTestId(
            'camera-source-unavailable-details',
          ).textContent,
        ).toContain('Legacy Site Box');
      });
      const legacyGate = screen.getByTestId('camera-source-host-prerequisite');
      expect(legacyGate.getAttribute('data-host-state')).toBe('unavailable');
      expect(
        within(legacyGate).getByTestId('camera-source-prerequisite-message').textContent,
      ).not.toContain('Legacy Site Box');

      // 5) Refresh -> Empty site host inventory shows distinct empty gate (no technical host list)
      await user.click(within(legacyGate).getByRole('button', { name: /Check connection again/i }));
      await waitFor(() => {
        expect(
          screen.getByTestId('camera-source-host-prerequisite').getAttribute('data-host-state'),
        ).toBe('empty');
      });
      const emptyGate = screen.getByTestId('camera-source-host-prerequisite');
      expect(within(emptyGate).queryByTestId('camera-source-unavailable-details')).toBeNull();
      expect(probe).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();

      await i18n.changeLanguage('vi');
      await waitFor(() => {
        expect(emptyGate.textContent).toMatch(/chưa có kết nối xử lý camera/i);
      });
      expect(emptyGate.textContent).not.toMatch(/máy AI|ngoại tuyến/i);
    });

    it('preserves available-host auto-binding alongside a CAMERA_UNBOUND sibling and revokes cleanly on 403 denied without leaking host details', async () => {
      const user = userEvent.setup();
      const onUnauthorized = vi.fn();
      const unboundSibling: SourceHost = {
        id: 'edge-unbound-sib',
        label: 'Unbound Sibling PC',
        available: false,
        reason: 'CAMERA_UNBOUND',
      };
      const hostsFn = vi
        .fn<CameraSourceClient['hosts']>()
        .mockResolvedValueOnce([host, unboundSibling])
        .mockRejectedValueOnce(new SourceSetupError(403));

      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-a"
            camera={{ id: 'cam-a', name: 'Gate camera', configurationVersion: 2 }}
            setupKey={['avail-then-denied']}
            canWrite
            onUnauthorized={onUnauthorized}
            client={{ hosts: hostsFn, probe: vi.fn() }}
          />
        </QueryClientProvider>,
      );

      // Available host auto-binds cleanly without primary host selector even when an unbound sibling exists
      expect(await screen.findByLabelText('Device')).toBeTruthy();
      expect(screen.queryByTestId('camera-source-host-prerequisite')).toBeNull();

      // Inspecting unbound sibling in collapsed Connection details shows CAMERA_UNBOUND reason concisely
      const details = screen.getByTestId('camera-source-connection-details') as HTMLDetailsElement;
      expect(details.open).toBe(false);
      details.open = true;
      const select = within(details).getByRole('combobox', {
        name: 'Camera processing computer',
      });
      await user.selectOptions(select, 'edge-unbound-sib');
      expect(screen.getByRole('status').textContent).toMatch(
        /not connected to a video source yet/i,
      );
      expect(screen.getByRole('status').textContent).not.toMatch(/\boffline\b/i);

      // Refresh hitting 403 denied revokes cleanly, calls onUnauthorized once, and hides all host/source details
      await user.click(within(details).getByRole('button', { name: /Check connection again/i }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toMatch(/session no longer permits camera setup/i);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId('camera-source-connection-details')).toBeNull();
      expect(screen.queryByText(/Unbound Sibling PC/i)).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('clears multi-host selection and pending resume command on camera scope replacement and on 401 auth revocation', async () => {
      const user = userEvent.setup();
      const onUnauthorized = vi.fn();
      const resume = vi
        .fn<NonNullable<CameraSourceClient['resume']>>()
        .mockRejectedValueOnce(new SourceSetupError(503))
        .mockRejectedValueOnce(new SourceSetupError(401));
      const twoHosts: SourceHost[] = [
        {
          ...host,
          id: 'edge-1',
          label: 'Host One',
          capabilities: {
            ...host.capabilities,
            configurationResumeSupported: true,
            sourceRevision: 1,
          },
        },
        {
          ...host,
          id: 'edge-2',
          label: 'Host Two',
          capabilities: {
            ...host.capabilities,
            configurationResumeSupported: true,
            sourceRevision: 2,
          },
        },
      ];
      const hostsFn = vi.fn<CameraSourceClient['hosts']>().mockResolvedValue(twoHosts);
      const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const renderForCam = (camId: string) => (
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-a"
            camera={{ id: camId, name: `Camera ${camId}`, configurationVersion: 4 }}
            setupKey={['multi-scope-clear']}
            canWrite
            onUnauthorized={onUnauthorized}
            client={{ hosts: hostsFn, probe: vi.fn(), resume }}
          />
        </QueryClientProvider>
      );

      const view = render(renderForCam('cam-1'));
      const prompt1 = await screen.findByTestId('camera-source-host-choice-required');
      await user.click(within(prompt1).getByRole('button', { name: 'Choose connection' }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Camera processing computer' }),
        'edge-2',
      );
      await user.click(await screen.findByRole('button', { name: 'Apply saved configuration' }));
      await screen.findByRole('button', { name: 'Retry the same request' });
      expect(resume).toHaveBeenCalledTimes(1);

      // Scope replacement to cam-2 must clear host-2 selection and pending retryable command
      view.rerender(renderForCam('cam-2'));
      const prompt2 = await screen.findByTestId('camera-source-host-choice-required');
      expect(prompt2).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Retry the same request' })).toBeNull();

      // Selecting edge-1 on cam-2 and hitting 401 revokes & clears pending command without reusing cam-1 commandId
      await user.click(within(prompt2).getByRole('button', { name: 'Choose connection' }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Camera processing computer' }),
        'edge-1',
      );
      await user.click(await screen.findByRole('button', { name: 'Apply saved configuration' }));
      await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
      expect(resume.mock.calls[1]?.[5].commandId).not.toBe(resume.mock.calls[0]?.[5].commandId);
      expect(screen.queryByRole('button', { name: 'Apply saved configuration' })).toBeNull();
    });

    it('renders neutral Source not checked / Chưa kiểm tra nguồn when opening or remounting an existing camera without applying, never false-negative Not connected / Chưa kết nối', async () => {
      const existingLiveHost: SourceHost = {
        ...host,
        id: 'site-cam1-host',
        label: 'Site CAM1 PC',
        capabilities: {
          ...host.capabilities,
          applySupported: true,
          configurationResumeSupported: true,
          sourceRevision: 3,
        },
      };
      const hostsFn = vi.fn<CameraSourceClient['hosts']>().mockResolvedValue([existingLiveHost]);
      const probe = vi.fn<CameraSourceClient['probe']>();
      const apply = vi.fn<NonNullable<CameraSourceClient['apply']>>();

      const renderExistingCam = (cache: QueryClient) => (
        <QueryClientProvider client={cache}>
          <CameraSourceSetupPanel
            apiUrl="http://localhost"
            token="tok"
            siteId="site-a"
            camera={{
              id: 'cam-1-existing',
              name: 'CAM1',
              configurationVersion: 5,
              status: 'ACTIVE',
            }}
            setupKey={['existing-cam-remount']}
            canWrite
            onUnauthorized={vi.fn()}
            client={{ hosts: hostsFn, probe, apply }}
          />
        </QueryClientProvider>
      );

      // 1) Initial mount of existing CAM1 without running test or apply
      const firstMount = render(
        renderExistingCam(new QueryClient({ defaultOptions: { queries: { retry: false } } })),
      );
      await screen.findByLabelText('Device');
      const pillEn = screen.getByTestId('camera-source-connection-status');
      expect(pillEn.getAttribute('data-connection-status')).toBe('not-checked');
      expect(pillEn.textContent).toBe('Source not checked');
      expect(pillEn.textContent).not.toMatch(/Not connected|Offline|Connected/i);
      expect(probe).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();

      // Vietnamese parity on existing camera open
      await i18n.changeLanguage('vi');
      await waitFor(() => {
        expect(screen.getByTestId('camera-source-connection-status').textContent).toBe(
          'Chưa kiểm tra nguồn',
        );
      });
      expect(screen.getByTestId('camera-source-connection-status').textContent).not.toMatch(
        /Chưa kết nối|Ngoại tuyến|Đã kết nối/i,
      );

      // 2) Unmount & remount the same existing camera (simulates navigating back to CAM1)
      firstMount.unmount();
      render(renderExistingCam(new QueryClient({ defaultOptions: { queries: { retry: false } } })));
      await screen.findByLabelText('Thiết bị');
      const remountPillVi = screen.getByTestId('camera-source-connection-status');
      expect(remountPillVi.getAttribute('data-connection-status')).toBe('not-checked');
      expect(remountPillVi.textContent).toBe('Chưa kiểm tra nguồn');
      expect(remountPillVi.textContent).not.toMatch(/Chưa kết nối|Ngoại tuyến|Đã kết nối/i);
      expect(apply).not.toHaveBeenCalled();
    });
  });
});
