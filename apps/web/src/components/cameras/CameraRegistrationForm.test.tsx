// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import i18n from '../../i18n';
import { CameraRegistrationForm, type CameraRegistrationFormProps } from './CameraRegistrationForm';

const siteA = '33333333-3333-4333-8333-333333333333';
const siteB = '44444444-4444-4444-8444-444444444444';
const camera: CameraResponse = {
  id: '55555555-5555-4555-8555-555555555555',
  siteId: siteA,
  externalId: 'source-a',
  code: 'CAM-01',
  name: 'Gate camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-12T12:00:00Z',
};
const clients: QueryClient[] = [];
beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.unstubAllGlobals();
  await i18n.changeLanguage('en');
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function mount(overrides: Partial<CameraRegistrationFormProps> = {}) {
  const queries = new QueryClient({ defaultOptions: { mutations: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  const props: CameraRegistrationFormProps = {
    apiUrl: 'https://backend.invalid',
    token: 'token-a-private',
    sessionScope: 'session-a',
    credentialId: 1,
    siteId: siteA,
    siteName: 'Site A',
    canManageCamera: true,
    onCreated: vi.fn(),
    onUnauthorized: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  const ui = (changes: Partial<CameraRegistrationFormProps> = {}) => (
    <QueryClientProvider client={queries}>
      <CameraRegistrationForm {...props} {...changes} />
    </QueryClientProvider>
  );
  return { ...render(ui()), props, queries, ui };
}
function fill(code = 'CAM-01', name = 'Gate camera', source = 'source-a') {
  fireEvent.change(screen.getByLabelText('Camera code'), { target: { value: code } });
  fireEvent.change(screen.getByLabelText('Camera name'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Source ID'), { target: { value: source } });
}
function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Register camera' }));
}
function errorResponse(status: number) {
  return Response.json({ message: 'SQL rtsp://secret:password@internal/token' }, { status });
}

it('registers metadata in the chosen Site and reports success without claiming connected video', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(camera));
  vi.stubGlobal('fetch', fetcher);
  const view = mount();
  fill(' CAM-01 ', ' Gate camera ');
  submit();
  await waitFor(() => expect(view.props.onCreated).toHaveBeenCalledWith(camera));
  expect(fetcher.mock.calls[0]?.[0]).toBe(`https://backend.invalid/api/v1/sites/${siteA}/cameras`);
  expect(fetcher.mock.calls[0]?.[1].method).toBe('POST');
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body)).toEqual({
    code: 'CAM-01',
    name: 'Gate camera',
    externalId: 'source-a',
  });
  expect(screen.getByRole('status').textContent).toMatch(/registered/i);
  expect(screen.getByRole('status').textContent).not.toMatch(/stream connected|camera online/i);
  expect((screen.getByLabelText('Camera name') as HTMLInputElement).value).toBe('');
  expect(
    JSON.stringify(
      view.queries
        .getMutationCache()
        .getAll()
        .map((m) => m.options.mutationKey),
    ),
  ).not.toContain('token-a-private');
});

it('blocks double submit synchronously while the first command is pending', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn(() => pending.promise);
  vi.stubGlobal('fetch', fetcher);
  mount();
  fill();
  submit();
  submit();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect((screen.getByRole('button', { name: /registering/i }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  await act(async () => pending.resolve(Response.json(camera)));
});

it.each([400, 409, 503])(
  'preserves the draft on HTTP %s and never renders raw Backend details or auto-retries',
  async (status) => {
    const fetcher = vi.fn().mockResolvedValue(errorResponse(status));
    vi.stubGlobal('fetch', fetcher);
    mount();
    fill();
    submit();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Camera name') as HTMLInputElement).value).toBe('Gate camera');
    expect(screen.getByRole('alert').textContent).not.toMatch(/SQL|password|internal/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('treats lost response as uncertain and asks for list verification before another create', async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError('rtsp://secret:password@internal'));
  vi.stubGlobal('fetch', fetcher);
  mount();
  fill();
  submit();
  expect((await screen.findByRole('alert')).textContent).toMatch(/verify.*camera list/i);
  expect(screen.getByRole('alert').textContent).not.toMatch(/secret|password|internal|rtsp:\/\//);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('reports current 401 once and blocks resubmission until the credential scope changes', async () => {
  const fetcher = vi.fn().mockResolvedValue(errorResponse(401));
  vi.stubGlobal('fetch', fetcher);
  const view = mount();
  fill();
  submit();
  await waitFor(() => expect(view.props.onUnauthorized).toHaveBeenCalledTimes(1));
  submit();
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole('button', { name: 'Register camera' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('blocks another command after current 403 without signing out the user', async () => {
  const fetcher = vi.fn().mockResolvedValue(errorResponse(403));
  vi.stubGlobal('fetch', fetcher);
  const view = mount();
  fill();
  submit();
  await screen.findByRole('alert');
  submit();
  await act(async () => {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(view.props.onUnauthorized).not.toHaveBeenCalled();
});

it('does not accept old Site success or overwrite the new Site draft', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending.promise),
  );
  const view = mount();
  fill();
  submit();
  await act(async () => {});
  view.rerender(view.ui({ siteId: siteB, siteName: 'Site B' }));
  fill('B-01', 'Camera B', 'source-b');
  await act(async () => pending.resolve(Response.json(camera)));
  expect(view.props.onCreated).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Camera name') as HTMLInputElement).value).toBe('Camera B');
  expect(screen.queryByRole('status')).toBeNull();
});

it('does not sign out a new token from a late old-token 401 even when credentialId is reused', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending.promise),
  );
  const view = mount();
  fill();
  submit();
  await act(async () => {});
  view.rerender(view.ui({ token: 'new-token-private' }));
  fill('NEW-01', 'New camera', 'new-source');
  await act(async () => pending.resolve(errorResponse(401)));
  expect(view.props.onUnauthorized).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect((screen.getByLabelText('Camera name') as HTMLInputElement).value).toBe('New camera');
});

it.each([{ credentialId: 2 }, { sessionScope: 'session-b' }, { apiUrl: 'https://other.invalid' }])(
  'fences pending callbacks when scope changes: %j',
  async (change) => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => pending.promise),
    );
    const view = mount();
    fill();
    submit();
    await act(async () => {});
    view.rerender(view.ui(change));
    await act(async () => pending.resolve(Response.json(camera)));
    expect(view.props.onCreated).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  },
);

it('clears the form on logout and ignores late success', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending.promise),
  );
  const view = mount();
  fill();
  submit();
  await act(async () => {});
  view.rerender(view.ui({ token: null }));
  expect(screen.queryByLabelText('Camera name')).toBeNull();
  await act(async () => pending.resolve(Response.json(camera)));
  expect(view.props.onCreated).not.toHaveBeenCalled();
});

it('does not expose registration without write capability or a Site', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const view = mount({ canManageCamera: false });
  expect(screen.queryByRole('form')).toBeNull();
  view.rerender(view.ui({ canManageCamera: true, siteId: null }));
  expect(screen.queryByRole('form')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('rejects a response from another Site instead of calling the creation callback', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...camera, siteId: siteB })));
  const view = mount();
  fill();
  submit();
  await screen.findByRole('alert');
  expect(view.props.onCreated).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Camera code') as HTMLInputElement).value).toBe('CAM-01');
});

it('keeps draft when cancelling and asks before discarding it', () => {
  const view = mount();
  fill();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(view.props.onCancel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect((screen.getByLabelText('Camera name') as HTMLInputElement).value).toBe('Gate camera');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(view.props.onCancel).toHaveBeenCalledTimes(1);
});

it('publishes dirty and saving state for the parent dialog close guard', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending.promise),
  );
  const changed = vi.fn();
  mount({ onDraftStateChange: changed });
  fill();
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ dirty: true, saving: false }));
  submit();
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ dirty: true, saving: true }));
  await act(async () => pending.resolve(Response.json(camera)));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith({ dirty: false, saving: false }));
});

it('validates required fields and refuses camera URLs in the opaque Source ID field', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  mount();
  submit();
  expect(screen.getByLabelText('Camera code').getAttribute('aria-invalid')).toBe('true');
  fill('CAM-01', 'Camera', 'rtsp://secret:password@internal');
  submit();
  expect(screen.getByLabelText('Source ID').getAttribute('aria-invalid')).toBe('true');
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  { id: '' },
  { externalId: 'source-b' },
  { code: 'CAM-02' },
  { name: 'Wrong name' },
  { configurationVersion: 0 },
  { createdAt: 'invalid' },
  { status: 'UNKNOWN' },
])('does not accept malformed or mismatched registration metadata: %j', async (change) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...camera, ...change })));
  const view = mount();
  fill();
  submit();
  await screen.findByRole('alert');
  expect(view.props.onCreated).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});

it('fences old callbacks when the supplied transport changes and uses the new transport', async () => {
  const pending = deferred<Response>();
  const fetcher = vi
    .fn()
    .mockImplementationOnce(() => pending.promise)
    .mockResolvedValue(Response.json(camera));
  vi.stubGlobal('fetch', fetcher);
  const view = mount({ client: new SmartSiteManagementClient('https://first.invalid') });
  fill();
  submit();
  await act(async () => {});
  view.rerender(view.ui({ client: new SmartSiteManagementClient('https://second.invalid') }));
  await act(async () => pending.resolve(Response.json(camera)));
  expect(view.props.onCreated).not.toHaveBeenCalled();
  fill();
  submit();
  await waitFor(() => expect(view.props.onCreated).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[1]?.[0]).toBe(`https://second.invalid/api/v1/sites/${siteA}/cameras`);
});

it('links recognized DTO issues to fields without rendering their raw messages', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json(
        {
          success: false,
          statusCode: 400,
          code: 'BAD_REQUEST',
          message: 'Invalid input',
          requestId: 'request-fixture',
          timestamp: '2026-10-12T12:00:00Z',
          path: '/api/v1/sites/site/cameras',
          issues: [
            { code: 'MAX_LENGTH', path: '/code', message: 'SQL rtsp://secret:password@internal' },
          ],
        },
        { status: 400 },
      ),
    ),
  );
  mount();
  fill();
  submit();
  await screen.findByRole('alert');
  const code = screen.getByLabelText('Camera code');
  expect(code.getAttribute('aria-invalid')).toBe('true');
  const errorId = code.getAttribute('aria-describedby');
  expect(errorId).toBeTruthy();
  expect(document.getElementById(errorId!)?.textContent).toMatch(/camera code/i);
  expect(screen.getByRole('alert').textContent).not.toMatch(/SQL|secret|internal/);
});

it('clears revoked-role drafts and ignores an in-flight success after camera-write access is lost', async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pending.promise),
  );
  const view = mount();
  fill();
  submit();
  await act(async () => {});
  view.rerender(view.ui({ canManageCamera: false }));
  expect(screen.queryByRole('form')).toBeNull();
  await act(async () => pending.resolve(Response.json(camera)));
  expect(view.props.onCreated).not.toHaveBeenCalled();
});

it('validates Unicode limits without changing the opaque Source ID bytes', async () => {
  const name = 'Camera mặt cổng';
  const code = '😀'.repeat(64);
  const externalId = ' source-a ';
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...camera, code, name, externalId }));
  vi.stubGlobal('fetch', fetcher);
  const view = mount();
  fill(code, name, externalId);
  submit();
  await waitFor(() => expect(view.props.onCreated).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0]?.[1].body).externalId).toBe(' source-a ');
});

it('projects only public camera fields into the callback even if the server adds private source fields', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...camera, rtspUrl: 'rtsp://private:secret@internal', password: 'secret' }),
      ),
  );
  const view = mount();
  fill();
  submit();
  await waitFor(() => expect(view.props.onCreated).toHaveBeenCalledWith(camera));
  expect(document.body.textContent).not.toContain('private:secret');
});

it('rejects a parseable non-contract timestamp instead of accepting malformed metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ...camera, createdAt: '123' })));
  const view = mount();
  fill();
  submit();
  await screen.findByRole('alert');
  expect(view.props.onCreated).not.toHaveBeenCalled();
});

it('switches EN -> VI -> EN while preserving dirty drafts, discard confirmation, pending locks, known errors, and invariant POST arguments', async () => {
  const pending = deferred<Response>();
  const fetcher = vi.fn<(url: string, init: RequestInit & { body: string }) => Promise<Response>>(
    () => pending.promise,
  );
  vi.stubGlobal('fetch', fetcher);

  mount();
  fill(' CAM-VI-01 ', ' Cổng chính ', 'source-vi-01');

  // Trigger standalone discard confirmation in EN
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByText('Discard unsaved camera changes?')).toBeTruthy();

  // Switch EN -> VI and verify labels, discard prompt, and dirty draft retention
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('form', { name: 'Đăng ký camera' })).toBeTruthy();
  expect((screen.getByLabelText('Mã camera') as HTMLInputElement).value).toBe(' CAM-VI-01 ');
  expect((screen.getByLabelText('Tên camera') as HTMLInputElement).value).toBe(' Cổng chính ');
  expect((screen.getByLabelText('Mã nguồn (Source ID)') as HTMLInputElement).value).toBe(
    'source-vi-01',
  );
  expect(screen.getByText('Hủy các thay đổi camera chưa lưu?')).toBeTruthy();

  // Keep editing in VI and submit
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Đăng ký camera' }));

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole('button', { name: 'Đang đăng ký…' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByRole('button', { name: 'Hủy' }) as HTMLButtonElement).disabled).toBe(true);

  // Switch VI -> EN while pending and verify pending lock remains enforced
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect((screen.getByRole('button', { name: 'Registering…' }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  // Resolve with known 409 error and verify EN -> VI -> EN error translation without raw details
  await act(async () => pending.resolve(errorResponse(409)));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The camera code or Source ID is already registered. Verify the camera list before trying again.',
  );

  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'Mã camera hoặc Mã nguồn đã được đăng ký. Vui lòng kiểm tra danh sách camera trước khi thử lại.',
  );
  expect(screen.getByRole('alert').textContent).not.toMatch(/SQL|secret|password|internal/);

  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect(screen.getByRole('alert').textContent).toBe(
    'The camera code or Source ID is already registered. Verify the camera list before trying again.',
  );

  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    code: 'CAM-VI-01',
    name: 'Cổng chính',
    externalId: 'source-vi-01',
  });
});
