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
  vi.spyOn(SmartSiteManagementClient.prototype, 'listVisitorZones').mockResolvedValue({
    items: [{ id: 'zone-beta', name: 'Beta office' }],
  });
  const lookup = vi
    .spyOn(SmartSiteManagementClient.prototype, 'getVisitorPass')
    .mockResolvedValue({ visit, pass: null });
  render(
    <QueryClientProvider client={queryClient}>
      <VisitorRegistrationView apiUrl="https://api.example.test" onBack={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole('option', { name: 'Beta' });
  await user.selectOptions(screen.getByLabelText('Registration Site'), 'site-beta');
  await user.type(screen.getByLabelText('Representative Full Name'), visit.visitorName);
  await user.type(screen.getByLabelText('Contact Phone / Email'), visit.contact);
  await user.type(screen.getByLabelText('Host Contact at Site'), visit.hostName);
  await user.type(screen.getByLabelText('Visit Purpose'), visit.purpose);
  await user.type(screen.getByLabelText('Target Visit Area'), visit.targetArea);
  await user.click(await screen.findByLabelText('Beta office'));
  await user.clear(screen.getByLabelText('Total Visitors (Headcount)'));
  await user.type(screen.getByLabelText('Total Visitors (Headcount)'), '20');
  await user.click(screen.getByRole('button', { name: 'Submit for Site Manager Approval' }));
  await screen.findByText('Status: Pending Site Manager Approval');
  expect(register).toHaveBeenCalledWith(
    'site-beta',
    expect.objectContaining({
      groupSize: 20,
      visitorName: visit.visitorName,
      zoneIds: ['zone-beta'],
    }),
  );
  expect(screen.queryByTitle('SmartSite access QR')).toBeNull();
  const reference = screen.getByLabelText('Visitor Pass Tracking Link') as HTMLInputElement;
  expect(reference.value).toContain(`#visitor-pass=${visit.id}.`);
  lookup.mockResolvedValue({
    visit: { ...visit, status: 'APPROVED' },
    pass: {
      token: 'SSQ-' + 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  });
  await user.click(screen.getByRole('button', { name: 'Check Status / Refresh QR' }));
  await waitFor(() => expect(screen.getByTitle('SmartSite access QR')).toBeTruthy());
  const svg = screen.getByRole('img', { name: 'SmartSite access QR' });
  const exportedSvg = new DOMParser().parseFromString(svg.outerHTML, 'image/svg+xml');
  expect(exportedSvg.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
  queryClient.clear();
});
