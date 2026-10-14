// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n from '../../i18n';
import { CameraRegistrationDialog } from './CameraRegistrationDialog';

const SITE_ID = '33333333-3333-4333-8333-333333333333';
const camera: CameraResponse = {
  id: '55555555-5555-4555-8555-555555555555',
  siteId: SITE_ID,
  externalId: 'source-dialog-01',
  code: 'CAM-DLG-01',
  name: 'Dialog camera',
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

it('switches EN -> VI -> EN on CameraRegistrationDialog while preserving dirty draft, discard confirmation, and pending dismissal lock', async () => {
  let resolveFetch!: (value: Response) => void;
  const fetcher = vi.fn(
    () =>
      new Promise<Response>((yes) => {
        resolveFetch = yes;
      }),
  );
  vi.stubGlobal('fetch', fetcher);

  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false, gcTime: 0 } },
  });
  clients.push(queryClient);
  const onClose = vi.fn();
  const onCreated = vi.fn();

  render(
    <QueryClientProvider client={queryClient}>
      <CameraRegistrationDialog
        open={true}
        onClose={onClose}
        apiUrl="https://backend.invalid"
        token="token-dialog-private"
        sessionScope="session-dialog"
        credentialId={1}
        siteId={SITE_ID}
        siteName="Site Alpha"
        isAdmin={true}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );

  expect(screen.getByRole('dialog', { name: 'Register camera' })).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Camera code'), { target: { value: 'CAM-DLG-01' } });
  fireEvent.change(screen.getByLabelText('Camera name'), { target: { value: 'Dialog camera' } });
  fireEvent.change(screen.getByLabelText('Source ID'), { target: { value: 'source-dialog-01' } });

  // Attempt close via dialog Close button -> opens dialog-owned discard confirmation
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.getByText('Discard unsaved camera changes?')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();

  // Switch EN -> VI while discard confirmation is open
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('dialog', { name: 'Đăng ký camera' })).toBeTruthy();
  expect(screen.getByText('Hủy các thay đổi camera chưa lưu?')).toBeTruthy();
  expect((screen.getByLabelText('Mã camera') as HTMLInputElement).value).toBe('CAM-DLG-01');

  // Keep editing in VI and submit
  fireEvent.click(screen.getByRole('button', { name: 'Tiếp tục chỉnh sửa' }));
  fireEvent.submit(screen.getByRole('form', { name: 'Đăng ký camera' }));

  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(
    (screen.getByRole('button', { name: 'Đóng hộp thoại' }) as HTMLButtonElement).disabled,
  ).toBe(true);

  // Switch VI -> EN while pending and verify dialog close remains locked
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  expect((screen.getByRole('button', { name: 'Close dialog' }) as HTMLButtonElement).disabled).toBe(
    true,
  );

  await act(async () => resolveFetch(Response.json(camera)));
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(camera));
});
