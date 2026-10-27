// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { VisitResponse } from '@smartsite/contracts';
import { VisitorAccessView } from './visitor/VisitorAccessView';
import i18n from '../../i18n';
const visit: VisitResponse = {
  id: 'visit-1',
  siteId: 'site-a',
  visitorName: 'Synthetic representative',
  company: '',
  contact: 'synthetic@example.test',
  hostName: 'Synthetic host',
  purpose: 'Tour',
  targetArea: 'Office',
  groupSize: 2,
  gateId: 'gate-north-01',
  validFrom: new Date().toISOString(),
  validUntil: new Date(Date.now() + 3600000).toISOString(),
  status: 'APPROVED',
  enteredCount: 0,
  exitedCount: 0,
  createdAt: new Date().toISOString(),
  decidedByUserId: 'manager',
  version: 2,
  members: [1, 2].map((i) => ({
    id: `member-${i}`,
    fullName: `Synthetic ${i}`,
    identityNumber: String(i).padStart(12, '0'),
    registeredFullName: `Synthetic ${i}`,
    registeredIdentityNumber: String(i).padStart(12, '0'),
    inside: false,
  })),
};
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

it.each(['observer', 'approvals', 'gate'] as const)(
  'restricts visitor actions to the %s workspace',
  async (mode) => {
    await i18n.changeLanguage('en');
    vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({
      items: [{ ...visit, status: 'PENDING' }],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorEvents').mockResolvedValue({
      items: [],
    });
    const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={cache}>
        <VisitorAccessView
          apiUrl="https://api.example.test"
          token="test"
          siteId="site-a"
          sessionScope="test"
          mode={mode}
          canApprove={mode === 'approvals'}
          canManualCheckout={mode === 'gate'}
        />
      </QueryClientProvider>,
    );
    await screen.findAllByText(visit.visitorName);
    expect(screen.queryByLabelText('QR Token') !== null).toBe(mode === 'gate');
    expect(screen.queryByRole('button', { name: 'Quản lý duyệt (Site Manager)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bàn trực cổng (Security)' })).toBeNull();
    expect(screen.queryByRole('link', { name: i18n.t('visitor.openPortal') }) !== null).toBe(
      mode === 'approvals',
    );
    if (mode !== 'approvals') {
      expect(screen.queryByRole('button', { name: i18n.t('visitor.approve') })).toBeNull();
      expect(screen.queryByRole('button', { name: i18n.t('visitor.retryEmail') })).toBeNull();
    }
    cache.clear();
  },
);

it.each(['REJECTED', 'CANCELLED'] as const)(
  'lets the Site Manager retry a failed %s email',
  async (status) => {
    await i18n.changeLanguage('en');
    const user = userEvent.setup();
    const decidedVisit: VisitResponse = {
      ...visit,
      status,
      email: 'synthetic@example.test',
      emailStatus: 'FAILED',
    };
    vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({
      items: [decidedVisit],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorEvents').mockResolvedValue({
      items: [],
    });
    const retry = vi
      .spyOn(SmartSiteManagementClient.prototype, 'retryVisitorEmail')
      .mockResolvedValue({
        ...decidedVisit,
        emailStatus: 'SENT',
      });
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={cache}>
        <VisitorAccessView
          apiUrl="https://api.example.test"
          token="test"
          siteId="site-a"
          sessionScope="test"
          canApprove
        />
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: i18n.t('visitor.retryEmail') }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith('test', 'site-a', visit.id));
    cache.clear();
  },
);

it('loads a QR before confirmation, selects actual arrivals, submits a replacement, and expands grouped history', async () => {
  await i18n.changeLanguage('en');
  const user = userEvent.setup();
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({ items: [visit] });
  const events = vi
    .spyOn(SmartSiteManagementClient.prototype, 'listVisitorEvents')
    .mockResolvedValue({ items: [] });
  vi.spyOn(SmartSiteManagementClient.prototype, 'previewVisitorQr').mockResolvedValue({
    visit,
    direction: 'IN',
    expiresAt: null,
  });
  const result = {
    id: 'event-1',
    visitId: visit.id,
    gateId: visit.gateId,
    direction: 'IN' as const,
    count: 1,
    createdAt: new Date().toISOString(),
    visit: { ...visit, enteredCount: 1 },
    attendees: [
      {
        memberId: 'member-1',
        fullName: 'Synthetic replacement',
        identityNumber: '000000000003',
        replacedFrom: { fullName: 'Synthetic 1', identityNumber: '000000000001' },
      },
    ],
  };
  const verify = vi
    .spyOn(SmartSiteManagementClient.prototype, 'verifyVisitorQr')
    .mockImplementation(async () => {
      events.mockResolvedValue({ items: [result] });
      return result;
    });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <VisitorAccessView
        apiUrl="https://api.example.test"
        token="test"
        siteId="site-a"
        sessionScope="test"
        canApprove={false}
        canManualCheckout
      />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText('QR Token'), 'ABCD2345');
  expect(screen.queryByRole('button', { name: 'Confirm Check-in (IN)' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Load visitor list' }));
  await user.click(await screen.findByRole('checkbox', { name: 'Select Synthetic 1' }));
  await user.clear(screen.getByLabelText('Full name — visitor 1'));
  await user.type(screen.getByLabelText('Full name — visitor 1'), 'Synthetic replacement');
  await user.clear(screen.getByLabelText('Citizen ID — visitor 1'));
  await user.type(screen.getByLabelText('Citizen ID — visitor 1'), '000000000003');
  await user.click(screen.getByRole('button', { name: 'Confirm Check-in (IN)' }));
  await waitFor(() =>
    expect(verify).toHaveBeenCalledWith(
      'test',
      'site-a',
      'gate-north-01',
      expect.objectContaining({
        expectedVersion: 2,
        attendees: [
          {
            memberId: 'member-1',
            fullName: 'Synthetic replacement',
            identityNumber: '000000000003',
          },
        ],
      }),
    ),
  );
  await user.click(await screen.findByText('Entry · Synthetic representative · 1 visitors'));
  expect(screen.getByText('Replaced: Synthetic 1 · 000000000001')).toBeTruthy();
  await i18n.changeLanguage('vi');
  await screen.findByText('Lịch sử khách qua cổng');
  expect(screen.getByText('Thay cho: Synthetic 1 · 000000000001')).toBeTruthy();
  cache.clear();
});

it('renders priority approval queue when canApprove is true and allows one-click approval and modal rejection', async () => {
  await i18n.changeLanguage('vi');
  const user = userEvent.setup();
  const pendingVisit: VisitResponse = {
    ...visit,
    id: 'visit-pending-1',
    status: 'PENDING',
    visitorName: 'Đoàn kiểm thử phần mềm',
    company: 'FPT Software',
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({
    items: [pendingVisit],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorEvents').mockResolvedValue({
    items: [],
  });
  const decideSpy = vi
    .spyOn(SmartSiteManagementClient.prototype, 'decideVisit')
    .mockResolvedValue({ ...pendingVisit, status: 'APPROVED' });

  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={cache}>
      <VisitorAccessView
        apiUrl="https://api.example.test"
        token="test"
        siteId="site-a"
        sessionScope="test"
        canApprove={true}
      />
    </QueryClientProvider>,
  );

  // Verify prominent priority approval queue banner exists
  expect(await screen.findByText(/Cần bạn phê duyệt/)).toBeTruthy();
  expect(screen.getAllByText('Đoàn kiểm thử phần mềm').length).toBeGreaterThan(0);

  // Test one-click approve
  const approveButtons = screen.getAllByRole('button', { name: 'Phê duyệt' });
  const approveButton = approveButtons[0];
  if (!approveButton) throw new Error('Missing approval control');
  await user.click(approveButton);

  await waitFor(() =>
    expect(decideSpy).toHaveBeenCalledWith(
      'test',
      'site-a',
      'visit-pending-1',
      'APPROVED',
      expect.objectContaining({ expectedVersion: 2 }),
    ),
  );

  // Test Reject modal
  const rejectButtons = screen.getAllByRole('button', { name: 'Từ chối' });
  const rejectButton = rejectButtons[0];
  if (!rejectButton) throw new Error('Missing rejection control');
  await user.click(rejectButton);
  expect(await screen.findByText('Từ chối chuyến thăm')).toBeTruthy();
  await user.type(
    screen.getByPlaceholderText(/Nhập lý do gửi phản hồi cho khách/i),
    'Không đủ thông tin bảo hộ',
  );
  await user.click(screen.getByRole('button', { name: 'Xác nhận từ chối' }));

  await waitFor(() =>
    expect(decideSpy).toHaveBeenCalledWith(
      'test',
      'site-a',
      'visit-pending-1',
      'REJECTED',
      expect.objectContaining({
        expectedVersion: 2,
        reviewNote: 'Không đủ thông tin bảo hộ',
      }),
    ),
  );

  cache.clear();
});

it('separates registration status from physical presence and provides combined filtering with On-Site', async () => {
  await i18n.changeLanguage('en');
  const user = userEvent.setup();

  const vPending: VisitResponse = {
    ...visit,
    id: 'v-pending',
    visitorName: 'Alice Pending',
    status: 'PENDING',
    enteredCount: 0,
    exitedCount: 0,
    presence: 'OUTSIDE',
  };

  const vApprovedOnSite: VisitResponse = {
    ...visit,
    id: 'v-approved',
    visitorName: 'Bob Approved Inside',
    status: 'APPROVED',
    groupSize: 2,
    enteredCount: 2,
    exitedCount: 1,
    presence: 'INSIDE',
  };

  const vCheckedOut: VisitResponse = {
    ...visit,
    id: 'v-checked-out',
    visitorName: 'Charlie Checked Out',
    status: 'APPROVED',
    enteredCount: 2,
    exitedCount: 2,
    presence: 'OUTSIDE',
  };

  const vExpiredInside: VisitResponse = {
    ...visit,
    id: 'v-expired-inside',
    visitorName: 'Diana Expired Inside',
    status: 'EXPIRED',
    groupSize: 3,
    enteredCount: 3,
    exitedCount: 1,
    presence: 'INSIDE',
  };

  const vCancelledInside: VisitResponse = {
    ...visit,
    id: 'v-cancelled-inside',
    visitorName: 'Eve Cancelled Inside',
    status: 'CANCELLED',
    groupSize: 5,
    enteredCount: 3,
    exitedCount: 1,
    presence: 'INSIDE',
  };

  const vNeedsReview: VisitResponse = {
    ...visit,
    id: 'v-needs-review',
    visitorName: 'Frank Needs Review',
    status: 'APPROVED',
    groupSize: 4,
    enteredCount: 2,
    exitedCount: 0,
    presence: 'NEEDS_REVIEW',
  };

  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({
    items: [vPending, vApprovedOnSite, vCheckedOut, vExpiredInside, vCancelledInside, vNeedsReview],
    total: 6,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorEvents').mockResolvedValue({
    items: [],
  });

  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={cache}>
      <VisitorAccessView
        apiUrl="https://api.example.test"
        token="test"
        siteId="site-a"
        sessionScope="test"
        canApprove={false}
        canManualCheckout
      />
    </QueryClientProvider>,
  );

  // 1. Verify all 4 physical presence representations are visible
  expect(await screen.findByText('Not yet entered')).toBeTruthy();
  expect(screen.getByText('On-site (1/2)')).toBeTruthy();
  expect(screen.getByText('Everyone checked out')).toBeTruthy();
  expect(screen.getByText('Needs review')).toBeTruthy();

  // 2. Filter by EXPIRED
  const expiredTab = screen.getByRole('button', { name: /^Expired/i });
  await user.click(expiredTab);
  expect(screen.getByText('Diana Expired Inside')).toBeTruthy();
  expect(screen.queryByText('Alice Pending')).toBeNull();
  expect(screen.queryByText('Bob Approved Inside')).toBeNull();

  // 3. Combined Filter: Toggle On-Site while on EXPIRED
  const onSiteToggle = screen.getByRole('button', { name: /On-Site only/i });
  await user.click(onSiteToggle);
  // Diana is EXPIRED AND has people on-site, so she remains visible
  expect(screen.getByText('Diana Expired Inside')).toBeTruthy();

  // 4. Combined Filter: Switch to CANCELLED with On-Site active
  const cancelledTab = screen.getByRole('button', { name: /^Cancelled/i });
  await user.click(cancelledTab);
  expect(screen.getByText('Eve Cancelled Inside')).toBeTruthy();
  expect(screen.queryByText('Diana Expired Inside')).toBeNull();

  // 5. Switch to ALL with On-Site active -> all 4 visits with people inside appear
  const allTab = screen.getByRole('button', { name: /^All\s*\d+/i });
  await user.click(allTab);
  expect(screen.getByText('Bob Approved Inside')).toBeTruthy();
  expect(screen.getByText('Diana Expired Inside')).toBeTruthy();
  expect(screen.getByText('Eve Cancelled Inside')).toBeTruthy();
  expect(screen.getByText('Frank Needs Review')).toBeTruthy();
  // Not on site:
  expect(screen.queryByText('Alice Pending')).toBeNull();
  expect(screen.queryByText('Charlie Checked Out')).toBeNull();

  cache.clear();
});

it('displays summary cards with visit counts vs headcounts and bounded list indicator', async () => {
  await i18n.changeLanguage('en');

  const v1: VisitResponse = {
    ...visit,
    id: 'v-1',
    visitorName: 'Visitor 1',
    status: 'APPROVED',
  };
  const v2: VisitResponse = {
    ...visit,
    id: 'v-2',
    visitorName: 'Visitor 2',
    status: 'PENDING',
  };

  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisits').mockResolvedValue({
    items: [v1, v2],
    total: 120,
    summary: {
      totalVisits: 120,
      pendingVisits: 25,
      approvedValidVisits: 75,
      onSitePeople: 18,
    },
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorEvents').mockResolvedValue({
    items: [],
  });

  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={cache}>
      <VisitorAccessView
        apiUrl="https://api.example.test"
        token="test"
        siteId="site-a"
        sessionScope="test"
        canApprove
      />
    </QueryClientProvider>,
  );

  // Check metrics values
  expect(await screen.findByText('120')).toBeTruthy();
  expect(screen.getByText('25')).toBeTruthy();
  expect(screen.getByText('75')).toBeTruthy();
  expect(screen.getByText('18')).toBeTruthy();

  // Check distinct units (visits vs people)
  const visitsUnits = screen.getAllByText('visits');
  expect(visitsUnits.length).toBe(3); // Total, Pending, Approved & Valid
  const peopleUnits = screen.getAllByText('people');
  expect(peopleUnits.length).toBe(1); // Currently On-Site

  // Check bounded list indicator
  expect(screen.getByText('Showing latest 2 of 120 registrations')).toBeTruthy();

  cache.clear();
});
