import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import QRCode from 'qrcode';
import { WorkerQrModal } from '../../components/worker/WorkerQrModal';

vi.hoisted(() => {
  Object.assign(globalThis, { window: {} });
});
vi.mock('./workspace-context', () => ({
  useWorkspace: () => ({
    client,
    token: 'worker-token',
    queryKey: ['worker-test', 'site-a'],
    scope: { siteId: 'site-a' },
  }),
}));
vi.mock('react-native-svg', () => ({ default: 'Svg', Path: 'Path' }));

const client = new SmartSiteManagementClient('https://api.example.test');
let root: ReactTestRenderer;
let cache: QueryClient;
const start = new Date('2026-10-17T12:00:00Z');
const pass = {
  token: 'WXYZ6789',
  expiresAt: new Date(start.getTime() + 300_000).toISOString(),
  direction: 'IN' as const,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  focusManager.setFocused(true);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache?.clear();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function mount(visible = true) {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <WorkerQrModal visible={visible} workerName="Synthetic Worker" onClose={() => {}} />
      </QueryClientProvider>,
    );
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}
async function press(label: string) {
  await act(async () => {
    root.root
      .findAll(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
      )[0]!
      .props.onPress();
    await vi.advanceTimersByTimeAsync(1);
  });
}
function tree() {
  return JSON.stringify(root.toJSON());
}

it('the home modal automatically gets its own code, without any Security session input', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockResolvedValue(pass);
  const encode = vi.spyOn(QRCode, 'create');
  await mount();
  expect(issue).toHaveBeenCalledWith(
    'worker-token',
    'site-a',
    { direction: 'IN' },
    { signal: expect.any(AbortSignal) },
  );
  expect(root.root.findAll((node) => String(node.type) === 'TextInput')).toHaveLength(0);
  expect(encode).toHaveBeenCalledWith('WXYZ6789', { errorCorrectionLevel: 'M' });
  expect(tree()).toContain('Mã vào/ra: WXYZ6789');
});

it('keeps one QR/code pair after 60 seconds and changes both only on explicit refresh', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockResolvedValue(pass);
  await mount();
  issue.mockResolvedValue({ ...pass, token: 'JKLM2345' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_010);
  });
  expect(issue).toHaveBeenCalledTimes(1);
  expect(tree()).toContain('Mã vào/ra: WXYZ6789');
  await press('Làm mới mã QR');
  expect(issue).toHaveBeenCalledTimes(2);
  expect(tree()).toContain('Mã vào/ra: JKLM2345');
  expect(tree()).not.toContain('WXYZ6789');
});

it('hides stale codes after a failed refresh and allows a manual retry', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockResolvedValue(pass);
  await mount();
  issue.mockRejectedValue(new ApiError('network', 'Offline'));
  await press('Làm mới mã QR');
  expect(tree()).not.toContain('WXYZ6789');
  expect(tree()).not.toContain('QR dự phòng do máy chủ cấp');
  issue.mockResolvedValue(pass);
  await press('Làm mới mã QR');
  expect(tree()).toContain('WXYZ6789');
});

it('does not issue or refresh while the modal is closed and cancels in-flight requests on close', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockImplementation(() => new Promise(() => {}));
  await mount(false);
  expect(issue).not.toHaveBeenCalled();
  await act(async () =>
    root.update(
      <QueryClientProvider client={cache}>
        <WorkerQrModal visible onClose={() => {}} />
      </QueryClientProvider>,
    ),
  );
  expect(issue).toHaveBeenCalledTimes(1);
  const signal = issue.mock.calls[0]![3]!.signal!;
  await act(async () =>
    root.update(
      <QueryClientProvider client={cache}>
        <WorkerQrModal visible={false} onClose={() => {}} />
      </QueryClientProvider>,
    ),
  );
  expect(signal.aborted).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(120_000);
  });
  expect(issue).toHaveBeenCalledTimes(1);
});

it('keeps the same QR/code pair when returning to the foreground', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockResolvedValue(pass);
  await mount();
  focusManager.setFocused(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_010);
  });
  expect(issue).toHaveBeenCalledTimes(1);
  await act(async () => {
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(issue).toHaveBeenCalledTimes(1);
  expect(tree()).toContain('Mã vào/ra: WXYZ6789');
});

it('requests an OUT code when Worker changes the intended passage', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockResolvedValue(pass);
  await mount();
  await press('Vào cổng ▾');
  await act(async () => {
    root.root
      .findAll(
        (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'radio',
      )[1]!
      .props.onPress();
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(issue.mock.calls.at(-1)![2]).toEqual({ direction: 'OUT' });
});

it('removes an expired QR even while the app is backgrounded', async () => {
  const issue = vi.spyOn(client, 'issueWorkerQr').mockResolvedValue(pass);
  await mount();
  focusManager.setFocused(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300_010);
  });
  expect(issue).toHaveBeenCalledTimes(1);
  expect(tree()).not.toContain('WXYZ6789');
  expect(tree()).not.toContain('QR dự phòng do máy chủ cấp');
  expect(tree()).toContain('Mã đã hết hạn');
});
