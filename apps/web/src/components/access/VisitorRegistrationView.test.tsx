// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { VisitResponse } from '@smartsite/contracts';
import { VisitorRegistrationView } from './VisitorRegistrationView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});
it('routes a representative group registration to the selected site and shows QR only after approval', async () => {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const visit: VisitResponse = {
    id: 'b81a5d44-4ea7-4932-b87d-27e3a42e7f75',
    siteId: 'site-beta',
    visitorName: 'Synthetic representative',
    company: '',
    contact: 'synthetic@example.test',
    hostName: 'Synthetic host',
    purpose: 'Tour',
    targetArea: 'Office',
    groupSize: 20,
    gateId: 'gate-north-01',
    validFrom: new Date().toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    status: 'PENDING',
    enteredCount: 0,
    exitedCount: 0,
    createdAt: new Date().toISOString(),
    decidedByUserId: null,
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorSites').mockResolvedValue({
    items: [
      { id: 'site-alpha', code: 'A', name: 'Alpha' },
      { id: 'site-beta', code: 'B', name: 'Beta' },
    ],
  });
  const register = vi
    .spyOn(SmartSiteManagementClient.prototype, 'registerVisit')
    .mockResolvedValue(visit);
  const lookup = vi
    .spyOn(SmartSiteManagementClient.prototype, 'getVisitorPass')
    .mockResolvedValue({ visit, pass: null });
  render(
    <QueryClientProvider client={queryClient}>
      <VisitorRegistrationView apiUrl="https://api.example.test" onBack={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole('option', { name: 'Beta' });
  await user.selectOptions(screen.getByLabelText('Site đăng ký'), 'site-beta');
  await user.type(screen.getByLabelText('Tên người đại diện'), visit.visitorName);
  await user.type(screen.getByLabelText('Điện thoại / email liên hệ'), visit.contact);
  await user.type(screen.getByLabelText('Người tiếp đón tại site'), visit.hostName);
  await user.type(screen.getByLabelText('Mục đích tham quan'), visit.purpose);
  await user.type(screen.getByLabelText('Khu vực đề nghị tham quan'), visit.targetArea);
  await user.clear(screen.getByLabelText('Số lượng người'));
  await user.type(screen.getByLabelText('Số lượng người'), '20');
  await user.click(screen.getByRole('button', { name: 'Gửi Site Manager duyệt' }));
  await screen.findByText('Trạng thái: Chờ Site Manager duyệt');
  expect(register).toHaveBeenCalledWith(
    'site-beta',
    expect.objectContaining({ groupSize: 20, visitorName: visit.visitorName }),
  );
  expect(screen.queryByTitle('SmartSite access QR')).toBeNull();
  const reference = screen.getByLabelText('Đường dẫn theo dõi lượt tham quan') as HTMLInputElement;
  expect(reference.value).toContain(`#visitor-pass=${visit.id}.`);
  lookup.mockResolvedValue({
    visit: { ...visit, status: 'APPROVED' },
    pass: {
      token: 'SSQ-' + 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  });
  await user.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái / làm mới QR' }));
  await waitFor(() => expect(screen.getByTitle('SmartSite access QR')).toBeTruthy());
  const svg = screen.getByRole('img', { name: 'SmartSite access QR' });
  const exportedSvg = new DOMParser().parseFromString(svg.outerHTML, 'image/svg+xml');
  expect(exportedSvg.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
  queryClient.clear();
});
