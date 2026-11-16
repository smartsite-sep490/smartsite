// @vitest-environment jsdom
import { readFile } from 'node:fs/promises';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { SafetyAlertsView } from './components/alerts/SafetyAlertsView';
import { AssignedWorkView } from './components/contractor/AssignedWorkView';
import { AuthContext } from './features/auth/auth-session';
import { NotificationBell } from './features/notifications/NotificationBell';
import i18n from './i18n';

it.runIf(process.env.SMARTSITE_C02_CORRECTIVE_WEB === '1')(
  process.env.SMARTSITE_C02_ASSIGN_ALERT_ID
    ? 'assigns the confirmed finding to the scoped representative'
    : process.env.SMARTSITE_C02_CORRECTIVE_REVIEW === '1'
      ? 'records the submitted outcome as the Safety Officer'
      : 'opens the scoped corrective assignment from the Bell and submits a result',
  async () => {
    const apiUrl = import.meta.env.VITE_API_URL;
    expect(apiUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const token = process.env.SMARTSITE_C02_OFFICER_TOKEN!;
    const siteId = process.env.SMARTSITE_C02_SITE!;
    const incidentId = process.env.SMARTSITE_C02_EPISODE!;
    const actionId = process.env.SMARTSITE_C02_RECIPIENT!;
    const alertId = process.env.SMARTSITE_C02_ASSIGN_ALERT_ID;
    const review = process.env.SMARTSITE_C02_CORRECTIVE_REVIEW === '1';
    const fixturePath = process.env.SMARTSITE_CORRECTIVE_JPEG;
    const jpeg = fixturePath ? await readFile(fixturePath) : undefined;
    const client = new SmartSiteManagementClient(apiUrl);
    const profile = await client.me(token);
    const fetchHttp = globalThis.fetch;
    const submissions: Array<{ status: number; message: string }> = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      if (!init?.method || init.method === 'GET') return fetchHttp(input, init);
      const headers = new Headers(init.headers);
      headers.set('Origin', apiUrl);
      let body = init.body;
      if (String(input).endsWith('/submissions') && body instanceof FormData) {
        // jsdom supplies DOM FormData, while Node fetch needs a wire-format multipart body.
        const boundary = 'smartsite-test-multipart';
        const parts = await Promise.all(
          Array.from(body.entries(), async ([name, value]) => {
            const disposition = `--${boundary}\r\nContent-Disposition: form-data; name="${name}"`;
            if (typeof value === 'string') return Buffer.from(`${disposition}\r\n\r\n${value}\r\n`);
            expect(value.name).toBe('corrective-evidence.jpg');
            expect(value.type).toBe('image/jpeg');
            const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as ArrayBuffer);
              reader.onerror = () => reject(reader.error);
              reader.readAsArrayBuffer(value);
            });
            expect(Buffer.from(bytes)).toEqual(jpeg);
            return Buffer.concat([
              Buffer.from(
                `${disposition}; filename="${value.name}"\r\nContent-Type: image/jpeg\r\n\r\n`,
              ),
              Buffer.from(bytes),
              Buffer.from('\r\n'),
            ]);
          }),
        );
        body = new Uint8Array(Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]));
        headers.set('Content-Type', `multipart/form-data; boundary=${boundary}`);
      }
      const response = await fetchHttp(input, { ...init, headers, body });
      if (String(input).endsWith('/submissions')) {
        const error = response.ok ? null : await response.clone().json();
        submissions.push({
          status: response.status,
          message: JSON.stringify(error?.message ?? ''),
        });
      }
      return response;
    });
    vi.stubGlobal(
      'matchMedia',
      vi.fn((media: string) => ({
        media,
        matches: false,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    if (jpeg)
      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL() {
            return 'blob:corrective-evidence';
          }
          static revokeObjectURL() {}
        },
      );
    await i18n.changeLanguage('en');
    const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    try {
      render(
        <MemoryRouter initialEntries={[review || alertId ? '/incidents' : '/']}>
          <QueryClientProvider client={query}>
            <AuthContext.Provider
              value={{
                accessToken: token,
                isSessionExpired: false,
                setAccessToken: vi.fn(),
                triggerSessionExpired: vi.fn(),
                dismissSessionExpired: vi.fn(),
              }}
            >
              <NotificationBell apiUrl={apiUrl} userId={profile.id} assignedWork />
              <Routes>
                <Route path="/" element={<p>Home</p>} />
                <Route
                  path="/incidents"
                  element={
                    <SafetyAlertsView
                      apiUrl={apiUrl}
                      authenticatedSession={{ accessToken: token, user: profile }}
                      initialSiteId={siteId}
                      initialAlertId={alertId}
                      initialIncidentId={alertId ? undefined : incidentId}
                      initialActionId={alertId ? undefined : actionId}
                    />
                  }
                />
                <Route
                  path="/assigned-work"
                  element={<AssignedWorkView apiUrl={apiUrl} token={token} user={profile} />}
                />
              </Routes>
            </AuthContext.Provider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      if (alertId) {
        const initial = await client.getSafetyAlert(token, siteId, alertId);
        expect(initial.status).toBe('PENDING_REVIEW');
        await user.type(
          await screen.findByRole('textbox', { name: /Decision reason/ }),
          'Synthetic Officer confirmed the finding after C02 review',
        );
        await user.click(screen.getByRole('button', { name: 'Confirm violation' }));
        const create = await screen.findByRole('button', { name: 'Create incident from alert' });
        const confirmed = await client.getSafetyAlert(token, siteId, alertId);
        expect(confirmed.status).toBe('CONFIRMED');
        await user.click(create);
        const dialog = within(await screen.findByRole('dialog'));
        await user.type(dialog.getByLabelText('Title'), 'Synthetic grouped PPE corrective work');
        await user.type(
          dialog.getByLabelText('Description'),
          'Review and correct the confirmed finding',
        );
        await dialog.findByRole('option', { name: 'Synthetic permission contractor' });
        await user.selectOptions(
          dialog.getByLabelText('Responsible contractor'),
          process.env.SMARTSITE_C02_CONTRACTOR_ID!,
        );
        await user.click(
          await dialog.findByRole('checkbox', { name: /Synthetic permission Worker/ }),
        );
        await dialog.findByRole('option', { name: 'Synthetic permission representative' });
        await user.selectOptions(
          dialog.getByLabelText('Assignee'),
          process.env.SMARTSITE_C02_ASSIGN_REP_ID!,
        );
        await user.type(
          dialog.getByLabelText('Verification reason'),
          'Verified C02 response for this subject',
        );
        await user.type(
          dialog.getByLabelText('Handling request'),
          'Correct the confirmed PPE finding',
        );
        await user.click(dialog.getByRole('button', { name: 'Create incident' }));
        await waitFor(async () => {
          const page = await client.listIncidents(token, siteId);
          expect(page.items).toHaveLength(1);
        });
        return;
      }
      if (!review) {
        await user.click(await screen.findByRole('button', { name: /notifications, 1/i }));
        await user.click(await screen.findByText(/Synthetic grouped PPE corrective work/));
        await screen.findByRole('heading', { name: /assigned work/i });
      }
      const action = await waitFor(() => {
        const element = document.getElementById('action-' + actionId);
        if (!element) throw new Error('Assigned action is missing');
        return element;
      });
      if (review) {
        if (jpeg) {
          const incident = await client.getIncident(token, siteId, incidentId);
          const evidence = incident.actions.find((item) => item.id === actionId)?.submissions[0]
            ?.evidence;
          expect(evidence?.id).toBeTruthy();
          const blob = await client.getWorkflowEvidence(
            token,
            siteId,
            'incidents',
            incidentId,
            evidence!.id,
          );
          expect(blob.type).toBe('image/jpeg');
          expect(Buffer.from(await blob.arrayBuffer())).toEqual(jpeg);
          const image = await within(action).findByRole('img', {
            name: 'Submitted corrective evidence',
          });
          expect(image.getAttribute('src')).toBe('blob:corrective-evidence');
        }
        await user.click(within(action).getByRole('button', { name: 'Record handling outcome' }));
        const dialog = await screen.findByRole('dialog');
        await user.selectOptions(within(dialog).getByLabelText('Review decision'), 'APPROVED');
        await user.type(
          within(dialog).getByLabelText('Recording note'),
          'Synthetic Officer approved via Web',
        );
        await user.click(within(dialog).getByRole('button', { name: 'Record handling outcome' }));
        await waitFor(async () => {
          const incident = await client.getIncident(token, siteId, incidentId);
          expect(incident.actions.find((item) => item.id === actionId)?.status).toBe('CLOSED');
        });
        return;
      }
      await user.click(within(action).getByRole('button', { name: 'Start handling' }));
      const report = await screen.findByRole('button', { name: 'Report handling outcome' });
      const started = await client.getIncident(token, siteId, incidentId);
      expect(started.actions.find((item) => item.id === actionId)?.status).toBe('IN_PROGRESS');
      await user.click(report);
      const dialog = await screen.findByRole('dialog');
      await user.type(
        within(dialog).getByLabelText('Result description'),
        'Synthetic corrective work completed in Web',
      );
      if (jpeg) {
        const file = new File([new Uint8Array(jpeg)], 'corrective-evidence.jpg', {
          type: 'image/jpeg',
        });
        await user.upload(within(dialog).getByLabelText(/Photo.*optional/i), file);
      }
      await user.click(within(dialog).getByRole('button', { name: 'Report handling outcome' }));
      await waitFor(() => expect(submissions).toEqual([{ status: 201, message: '""' }]));
      await waitFor(async () => {
        const incident = await client.getIncident(token, siteId, incidentId);
        expect(incident.actions.find((item) => item.id === actionId)?.status).toBe('SUBMITTED');
      });
    } finally {
      cleanup();
      query.clear();
      vi.unstubAllGlobals();
    }
  },
  25_000,
);
