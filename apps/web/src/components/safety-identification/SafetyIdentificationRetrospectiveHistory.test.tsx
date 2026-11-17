// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  API_URL,
  MANAGER_A_ID,
  SITE_A_ID,
  WORKER_1_ID,
  makeRequest,
  managerSession,
  officerSession,
} from './safetyIdentificationTestFixtures';
import {
  openRequestRow,
  renderWorkspace,
  setupWorkspaceTestLifecycle,
} from './safetyIdentificationTestHarness';

const request = makeRequest({
  status: 'CLOSED',
  version: 3,
  result: {
    outcome: 'IDENTIFIED',
    workerId: WORKER_1_ID,
    contractorId: null,
    evidenceRefs: [],
    respondedBy: MANAGER_A_ID,
    respondedAt: '2026-11-17T09:00:00.000Z',
    reason: 'Supervisor confirmed the subject',
  },
});

describe('MF06 retrospective history in the C02 workspace', () => {
  const { getSpies } = setupWorkspaceTestLifecycle();

  function showClosedCase() {
    getSpies().listRequests.mockResolvedValue({ items: [request], total: 1 });
    getSpies().getRequest.mockResolvedValue(request);
  }

  it('loads the selected C02 case on demand and shows original and retrospective outcomes', async () => {
    showClosedCase();
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockResolvedValueOnce(
      Response.json({
        items: [
          {
            requestId: 'review-1',
            initialRequestId: 'initial-1',
            cameraId: 'camera-1',
            zoneId: 'zone-1',
            identificationVersion: 3,
            capturedAt: '2026-11-17T09:00:00.123456Z',
            status: 'ALLOWED',
            reasonCode: 'AUTHORIZED',
            originalOutcome: 'UNAVAILABLE',
          },
        ],
        total: 1,
      }),
    );
    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    const show = await screen.findByRole('button', { name: 'View zone reassessments' });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(show);
    const section = await screen.findByRole('region', { name: 'Zone reassessments' });
    expect(await within(section).findByText('Access authorized')).toBeTruthy();
    expect(within(section).getByText('Original assessment')).toBeTruthy();
    expect(within(section).getByText('Unable to assess')).toBeTruthy();
    expect(fetch.mock.calls[0]?.[0]).toContain(
      `/sites/${SITE_A_ID}/safety-identification-requests/${request.id}/retrospective-assessments`,
    );
  });

  it('keeps reassessment history out of the site manager view', async () => {
    showClosedCase();
    renderWorkspace({ apiUrl: API_URL, session: managerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    await screen.findByText(request.result!.reason);
    expect(screen.queryByRole('button', { name: 'View zone reassessments' })).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('requires an explicit choice and reuses the same command after a failed response', async () => {
    showClosedCase();
    const initialRequestId = '140e8400-e29b-41d4-a716-446655441100';
    const commands: Record<string, unknown>[] = [];
    const fetch = vi.mocked(globalThis.fetch);
    fetch.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/retrospective-assessment-options')) {
        return Response.json({
          episodeId: request.episodeId,
          identificationVersion: 3,
          items:
            commands.length >= 2
              ? []
              : [
                  {
                    initialRequestId,
                    cameraName: 'Gate camera',
                    zoneName: 'Loading bay',
                    capturedAt: '2026-11-17T09:00:00.123456Z',
                  },
                ],
        });
      }
      if (path.endsWith('/retrospective-assessment')) {
        expect(init?.method).toBe('POST');
        commands.push(JSON.parse(String(init?.body)));
        if (commands.length === 1) throw new Error('Connection lost');
        return Response.json({ requestId: 'review-queued' }, { status: 202 });
      }
      return Response.json({ items: [], total: 0 });
    });
    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    fireEvent.click(await screen.findByRole('button', { name: 'View zone reassessments' }));
    const select = await screen.findByRole('combobox', { name: 'Zone entry to reassess' });
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Request reassessment' });
    expect(submit.disabled).toBe(true);
    expect(commands).toHaveLength(0);
    fireEvent.change(select, { target: { value: initialRequestId } });
    fireEvent.click(submit);
    await screen.findByText('Could not request reassessment. You can retry.');
    fireEvent.click(submit);
    await screen.findByText('Reassessment queued.');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual(commands[1]);
    expect(commands[0]).toMatchObject({
      commandId: expect.any(String),
      initialRequestId,
      identificationVersion: 3,
      episodeId: request.episodeId,
    });
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Zone entry to reassess' })).toBeNull(),
    );
  });

  it('removes cached results when refresh reports that the officer lost access', async () => {
    showClosedCase();
    let denied = false;
    vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
      if (denied)
        return Response.json({ code: 'FORBIDDEN', message: 'Forbidden' }, { status: 403 });
      if (String(url).includes('retrospective-assessment-options')) {
        return Response.json({ episodeId: request.episodeId, identificationVersion: 3, items: [] });
      }
      return Response.json({
        items: [
          {
            requestId: 'review-1',
            initialRequestId: 'initial-1',
            cameraId: 'camera-1',
            zoneId: 'zone-1',
            cameraName: 'Sensitive camera',
            zoneName: 'Sensitive zone',
            identificationVersion: 3,
            capturedAt: '2026-11-17T09:00:00.123456Z',
            status: 'ALLOWED',
            reasonCode: 'AUTHORIZED',
            originalOutcome: 'UNAVAILABLE',
          },
        ],
        total: 1,
      });
    });
    renderWorkspace({ apiUrl: API_URL, session: officerSession(), initialSiteId: SITE_A_ID });
    await openRequestRow(request);
    fireEvent.click(await screen.findByRole('button', { name: 'View zone reassessments' }));
    const section = await screen.findByRole('region', { name: 'Zone reassessments' });
    await within(section).findByText('Access authorized');
    denied = true;
    fireEvent.click(within(section).getByRole('button', { name: 'Refresh' }));
    await within(section).findByText('Could not load zone reassessments.');
    expect(within(section).queryByText('Access authorized')).toBeNull();
    expect(within(section).queryByText(/Sensitive camera/)).toBeNull();
  });
});
