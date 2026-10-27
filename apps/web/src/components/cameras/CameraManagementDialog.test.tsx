// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import { CameraManagementDialog, type CameraManagementDialogProps } from './CameraManagementDialog';

const SITE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAMERA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const camera: CameraResponse = {
  id: CAMERA,
  siteId: SITE,
  code: 'CAM-01',
  name: 'Entrance',
  externalId: 'opaque-source-01',
  status: 'ACTIVE',
  configurationVersion: 3,
  createdAt: '2026-10-13T00:00:00Z',
};
const queries: QueryClient[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function mount(overrides: Partial<CameraManagementDialogProps> = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  queries.push(client);
  const props: CameraManagementDialogProps = {
    open: true,
    onClose: vi.fn(),
    apiUrl: 'https://backend.invalid',
    token: 'private-token',
    sessionScope: 'session-current',
    credentialId: 1,
    siteId: SITE,
    siteName: 'Site A',
    camera: { ...camera },
    canManageCamera: true,
    onUpdated: vi.fn(),
    onUnauthorized: vi.fn(),
    ...overrides,
  };
  const ui = (changes: Partial<CameraManagementDialogProps> = {}) => (
    <QueryClientProvider client={client}>
      <CameraManagementDialog {...props} {...changes} />
    </QueryClientProvider>
  );
  return { ...render(ui()), props, ui, client };
}
function fill(name = 'New entrance') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Camera name' }), {
    target: { value: name },
  });
}
function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Manage camera' }));
}
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  queries.splice(0).forEach((query) => query.clear());
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});

it('sends only the trimmed name to the scoped shared-client PATCH and announces metadata success', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...camera, name: 'New entrance' }));
  vi.stubGlobal('fetch', fetcher);
  const view = mount();
  fill(' New entrance ');
  submit();
  await waitFor(() =>
    expect(view.props.onUpdated).toHaveBeenCalledWith({ ...camera, name: 'New entrance' }),
  );
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(`https://backend.invalid/api/v1/sites/${SITE}/cameras/${CAMERA}`);
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body)).toEqual({ name: 'New entrance' });
  expect(screen.getByRole('status').textContent).not.toMatch(/stream connected|camera online/i);
  expect((screen.getByLabelText('Camera code') as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText('Source ID') as HTMLInputElement).readOnly).toBe(true);
});

it('prevents synchronous double submit before a render and sends only one request', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetcher);
  mount();
  fill();
  act(() => {
    submit();
    submit();
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  await act(async () => pending.resolve(Response.json({ ...camera, name: 'New entrance' })));
});

it.each([' ', 'name\u0000bad', 'a'.repeat(256), '\ud800'])(
  'rejects invalid names %j locally with linked field error and focus',
  async (name) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    mount();
    fill(name);
    submit();
    const field = screen.getByRole('textbox', { name: 'Camera name' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(document.getElementById(field.getAttribute('aria-describedby')!)?.textContent).toMatch(
      /name/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  },
);

it('accepts a 255-codepoint supplementary Unicode name without HTML maxlength truncation', async () => {
  const name = '𐐀'.repeat(255);
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...camera, name }));
  vi.stubGlobal('fetch', fetcher);
  const view = mount();
  fill(name);
  submit();
  await waitFor(() => expect(view.props.onUpdated).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ name });
});

it.each([{ name: 'Unexpected name' }, { configurationVersion: 2 }, { createdAt: 'not-a-date' }])(
  'refuses malformed or nonmatching rename response %j',
  async (patch) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...camera, name: 'New entrance', ...patch })),
    );
    const view = mount();
    fill();
    submit();
    await screen.findByRole('alert');
    expect(view.props.onUpdated).not.toHaveBeenCalled();
  },
);

it('permits a legitimate concurrent status update in the rename response', async () => {
  const row = {
    ...camera,
    name: 'New entrance',
    status: 'INACTIVE' as const,
    configurationVersion: 4,
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(row)));
  const view = mount();
  fill();
  submit();
  await waitFor(() => expect(view.props.onUpdated).toHaveBeenCalledWith(row));
});

it('requires a fresh read before retrying an uncertain rename and never leaks transport detail', async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('rtsp://secret:password@internal'));
  vi.stubGlobal('fetch', fetcher);
  mount();
  fill();
  submit();
  expect((await screen.findByRole('alert')).textContent).not.toMatch(/rtsp|password|internal/);
  expect((screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole('button', { name: 'Refresh camera' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Camera name' }) as HTMLInputElement).value).toBe(
    'New entrance',
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('does not let reused credentialId and sessionScope accept a late old-token success', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending.promise),
  );
  const view = mount();
  fill();
  submit();
  await act(async () => {});
  view.rerender(view.ui({ token: 'replacement-token' }));
  fill('New token draft');
  await act(async () => pending.resolve(Response.json({ ...camera, name: 'New entrance' })));
  expect(view.props.onUpdated).not.toHaveBeenCalled();
  expect((screen.getByRole('textbox', { name: 'Camera name' }) as HTMLInputElement).value).toBe(
    'New token draft',
  );
});

it.each([
  { token: null },
  { sessionScope: null },
  { canManageCamera: false },
  { siteId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
])('does not offer mutation controls for an invalid authorized scope %j', (patch) => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  mount(patch);
  expect(screen.queryByRole('form', { name: 'Manage camera' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('does not restore stale local status if refresh returns an older configuration version', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ ...camera, status: 'INACTIVE', configurationVersion: 4 }),
    )
    .mockRejectedValueOnce(new TypeError('network'))
    .mockResolvedValueOnce(Response.json({ ...camera, configurationVersion: 3 }));
  vi.stubGlobal('fetch', fetcher);
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Deactivate camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));
  await screen.findByRole('button', { name: 'Activate camera' });
  fill();
  submit();
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh camera' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await screen.findByRole('alert');
  expect(
    (screen.getByRole('button', { name: 'Activate camera' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.queryByRole('button', { name: 'Deactivate camera' })).toBeNull();
});

it('switches EN -> VI -> EN while preserving dirty drafts, discard confirmation, pending status locks, known 409 error, and machine status payload', async () => {
  const pendingStatus = deferred<Response>();
  const fetcher = vi.fn<(url: string, init: RequestInit & { body: string }) => Promise<Response>>(
    () => pendingStatus.promise,
  );
  vi.stubGlobal('fetch', fetcher);

  mount();
  fill('Cổng phía Bắc');

  // Open discard confirmation in EN
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Discard unsaved camera changes?')).toBeTruthy();

  // Switch EN -> VI and verify dialog title, status display, discard confirmation, and dirty draft
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('dialog', { name: 'Quản lý camera' })).toBeTruthy();
  expect(screen.getByText(/Đang hoạt động \(ACTIVE\) · v3/)).toBeTruthy();
  expect(screen.getByText('Hủy các thay đổi camera chưa lưu?')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Tên camera' }) as HTMLInputElement).value).toBe(
    'Cổng phía Bắc',
  );

  // Keep editing in VI, then open status deactivation confirmation and submit in VI
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ngừng kích hoạt camera' }));
  fireEvent.click(screen.getByRole('button', { name: 'Xác nhận ngừng kích hoạt' }));

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole('button', { name: 'Đang cập nhật…' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole('button', { name: 'Đóng hộp thoại' }) as HTMLButtonElement).disabled,
  ).toBe(true);

  // Switch VI -> EN while pending and verify dismissal and buttons stay locked
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect((screen.getByRole('button', { name: 'Updating…' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  // Resolve with 409 conflict and verify EN -> VI -> EN translation of error and conflict banner
  await act(async () =>
    pendingStatus.resolve(
      Response.json({ message: 'SQL rtsp://secret:password@internal' }, { status: 409 }),
    ),
  );
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Camera metadata conflict. Refresh camera metadata before retrying.',
  );
  expect(screen.getByRole('button', { name: 'Refresh camera' })).toBeTruthy();

  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'Xung đột siêu dữ liệu camera. Vui lòng làm mới siêu dữ liệu camera trước khi thử lại.',
  );
  expect(screen.getByRole('button', { name: 'Làm mới camera' })).toBeTruthy();
  expect((screen.getByRole('textbox', { name: 'Tên camera' }) as HTMLInputElement).value).toBe(
    'Cổng phía Bắc',
  );

  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'Camera metadata conflict. Refresh camera metadata before retrying.',
  );

  // Machine API payload must always send exact machine enum INACTIVE and version 3
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    status: 'INACTIVE',
    expectedConfigurationVersion: 3,
  });
});

it('cancels inline status confirmation and discard confirmation on Escape or Keep editing while preserving the dialog, dirty draft, and trigger focus', () => {
  const view = mount();
  const nameInput = screen.getByRole('textbox', { name: 'Camera name' }) as HTMLInputElement;
  fill('North gate draft');

  const deactivateBtn = screen.getByRole('button', { name: 'Deactivate camera' });
  deactivateBtn.focus();
  fireEvent.click(deactivateBtn);
  expect(screen.getByRole('button', { name: 'Confirm deactivation' })).toBeTruthy();

  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Confirm deactivation' })).toBeNull();
  expect(screen.queryByText('Discard unsaved camera changes?')).toBeNull();
  expect(view.props.onClose).not.toHaveBeenCalled();
  expect(nameInput.value).toBe('North gate draft');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Deactivate camera' }));

  const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
  fireEvent.click(cancelBtn);
  expect(screen.getByText('Discard unsaved camera changes?')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));

  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.queryByText('Discard unsaved camera changes?')).toBeNull();
  expect(view.props.onClose).not.toHaveBeenCalled();
  expect(nameInput.value).toBe('North gate draft');
  expect(document.activeElement).toBe(cancelBtn);

  nameInput.focus();
  fireEvent.keyDown(nameInput, { key: 'Escape' });
  expect(screen.getByText('Discard unsaved camera changes?')).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }));

  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByText('Discard unsaved camera changes?')).toBeNull();
  expect(view.props.onClose).not.toHaveBeenCalled();
  expect(nameInput.value).toBe('North gate draft');
  expect(document.activeElement).toBe(nameInput);
});
