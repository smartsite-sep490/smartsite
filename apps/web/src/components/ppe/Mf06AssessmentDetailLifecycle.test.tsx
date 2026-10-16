// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';

const target = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT' as const,
  capturedAt: '2026-10-13T01:02:03.123456Z',
};
const record = {
  ...target,
  assessedAt: '2026-10-13T01:02:04.123456Z',
  outcome: 'UNAVAILABLE' as const,
  reasonCode: 'IDENTITY_UNAVAILABLE' as const,
  evaluatorVersion: 'SYNTHETIC_LIFECYCLE_V1',
  provenance: 'UNAVAILABLE' as const,
};
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((q) => q.clear());
});
function mount(ui: React.ReactNode) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  return render(<QueryClientProvider client={queries}>{ui}</QueryClientProvider>);
}

it('cancels a pending detail request on actual dialog dismiss while component remains mounted', async () => {
  let signal: AbortSignal | undefined;
  const get = vi.fn(
    (_token: string, _site: string, _id: string, options: { signal?: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => {});
    },
  );
  const client = { getMf06Assessment: get } as unknown as SmartSiteManagementClient;
  function Harness() {
    const [open, setOpen] = React.useState(true);
    return (
      <Mf06AssessmentDetailDialog
        open={open}
        onClose={() => setOpen(false)}
        target={target}
        token="synthetic-token"
        siteId={target.siteId}
        credentialId="synthetic-credential"
        client={client}
      />
    );
  }
  mount(<Harness />);
  await waitFor(() => expect(signal).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(signal?.aborted).toBe(true));
});

it('can open a new detail after token rotation while the dialog was closed', async () => {
  const get = vi.fn().mockResolvedValue(record),
    client = { getMf06Assessment: get } as unknown as SmartSiteManagementClient;
  function Harness() {
    const [open, setOpen] = React.useState(false),
      [token, setToken] = React.useState('synthetic-old-token');
    return (
      <>
        <button onClick={() => setToken('synthetic-new-token')}>Rotate closed token</button>
        <button onClick={() => setOpen(true)}>Open new detail</button>
        <Mf06AssessmentDetailDialog
          open={open}
          onClose={() => setOpen(false)}
          target={target}
          token={token}
          siteId={target.siteId}
          credentialId="same-credential"
          client={client}
        />
      </>
    );
  }
  mount(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Rotate closed token' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open new detail' }));
  expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
  expect(get).toHaveBeenCalledWith(
    'synthetic-new-token',
    target.siteId,
    target.assessmentId,
    expect.objectContaining({ signal: expect.anything() }),
  );
});

it('a missing assessment does not prevent opening a different record in the same authorized scope', async () => {
  const nextTarget = { ...target, assessmentId: '77777777-7777-4777-8777-777777777777' };
  const get = vi
    .fn()
    .mockRejectedValueOnce(new ApiError('http', 'Not found', 404))
    .mockResolvedValueOnce({ ...record, ...nextTarget });
  const client = { getMf06Assessment: get } as unknown as SmartSiteManagementClient;
  function Harness() {
    const [open, setOpen] = React.useState(true),
      [selected, setSelected] = React.useState(target);
    return (
      <>
        <button
          onClick={() => {
            setSelected(nextTarget);
            setOpen(true);
          }}
        >
          Open other record
        </button>
        <Mf06AssessmentDetailDialog
          open={open}
          onClose={() => setOpen(false)}
          target={selected}
          token="synthetic-token"
          siteId={target.siteId}
          credentialId="same-credential"
          client={client}
        />
      </>
    );
  }
  mount(<Harness />);
  expect(await screen.findByText('Assessment record not found or unavailable.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open other record' }));
  expect(await screen.findByText('Identity Unavailable')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});
