import { Blob as NodeBlob } from 'node:buffer';
// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import { SafetyEpisodeWorkspace } from './components/safety-episodes/SafetyEpisodeWorkspace';
import { AuthContext } from './features/auth/auth-session';
import { IDENTIFICATION_COPY } from './components/safety-identification/IdentificationCopy';
import { getIdentificationWorkspaceCopy } from './components/safety-identification/IdentificationWorkspaceCopy';
import i18n from './i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.runIf(process.env.SMARTSITE_C02_OWNED_FIXTURE === '1')(
  'creates, returns and closes a request over actual scoped HTTP',
  async () => {
    const endpoint = process.env.VITE_API_URL ?? '';
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const siteId = process.env.SMARTSITE_C02_SITE!;
    const episodeId = process.env.SMARTSITE_C02_EPISODE!;
    const recipientId = process.env.SMARTSITE_C02_RECIPIENT!;
    const officerToken = process.env.SMARTSITE_C02_OFFICER_TOKEN!;
    const managerToken = process.env.SMARTSITE_C02_MANAGER_TOKEN!;
    expect(Boolean(officerToken && managerToken)).toBe(true);
    const workerId = process.env.SMARTSITE_C02_WORKER_ID;
    const contractorId = process.env.SMARTSITE_C02_CONTRACTOR_ID;
    const withEvidence = process.env.SMARTSITE_C02_WEB_EVIDENCE === '1';
    const images: NodeBlob[] = [];
    if (withEvidence) {
      vi.stubGlobal('Blob', NodeBlob);
      vi.stubGlobal(
        'URL',
        class extends URL {
          static createObjectURL(blob: unknown) {
            if (!(blob instanceof NodeBlob)) throw new Error('Expected fixture Blob');
            images.push(blob);
            return 'blob:c02-' + images.length;
          }
          static revokeObjectURL() {}
        },
      );
    }
    const client = new SmartSiteManagementClient(endpoint);
    await i18n.changeLanguage('en');
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((media: string) => ({
        media,
        matches: false,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    );
    const [officer, manager] = await Promise.all([
      client.me(officerToken),
      client.me(managerToken),
    ]);
    const page = await client.listSafetyFrameInbox(officerToken, { siteId });
    const frame = page.items.find((item) =>
      item.cases.some((entry) => entry.recipientId === recipientId),
    );
    if (!frame) throw new Error('The originating Inbox frame is missing');
    const form = IDENTIFICATION_COPY.en;
    const copy = getIdentificationWorkspaceCopy('en');
    const user = userEvent.setup();
    const reason = 'C02 mounted HTTP synthetic subject verification';
    const inboxHref = `/incidents?${new URLSearchParams({ tab: 'ppe-frames', siteId, frameKey: frame.frameKey })}`;
    const workspaceHref = `/incidents?${new URLSearchParams({ tab: 'identification', siteId })}`;
    function mount(accessToken: string, href = workspaceHref) {
      const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      const profile = accessToken === officerToken ? officer : manager;
      const view = render(
        <MemoryRouter initialEntries={[href]}>
          <QueryClientProvider client={queries}>
            <AuthContext.Provider
              value={{
                accessToken,
                isSessionExpired: false,
                setAccessToken: vi.fn(),
                triggerSessionExpired: vi.fn(),
                dismissSessionExpired: vi.fn(),
              }}
            >
              <SafetyEpisodeWorkspace apiUrl={endpoint} session={{ accessToken, user: profile }}>
                <div>Safety Operations</div>
              </SafetyEpisodeWorkspace>
            </AuthContext.Provider>
          </QueryClientProvider>
        </MemoryRouter>,
      );
      return () => {
        view.unmount();
        queries.clear();
      };
    }
    let unmount = mount(officerToken, inboxHref);
    const secondSiteId = process.env.SMARTSITE_C02_SECOND_SITE;
    if (secondSiteId) {
      await screen.findByRole('option', { name: 'Synthetic second Site' });
      expect(screen.queryByRole('option', { name: 'Synthetic outside Site' })).toBeNull();
      await user.selectOptions(screen.getByRole('combobox', { name: 'Site' }), secondSiteId);
      await waitFor(() => {
        const choices = screen.getAllByRole('button', { expanded: false });
        expect(
          choices.some((button) => button.textContent?.includes('Synthetic second Site')),
        ).toBe(true);
      });
      expect(screen.queryByRole('link', { name: 'View all frames' })).toBeNull();
      await user.selectOptions(screen.getByRole('combobox', { name: 'Site' }), '');
      await waitFor(() => {
        const frames = screen
          .getAllByRole('button', { expanded: false })
          .filter((button) => button.textContent?.includes('person to review'));
        expect(frames).toHaveLength(2);
      });
      unmount();
      unmount = mount(officerToken, inboxHref);
    }
    await user.click(await screen.findByRole('link', { name: 'Open case for person 1' }));
    const originalImageCount = images.length;
    const entry = await screen.findByRole('link', { name: 'Request identification' });
    const originHref = entry.getAttribute('href');
    if (!originHref) throw new Error('Identification link is missing its destination');
    await user.click(entry);
    await user.type(await screen.findByLabelText(form.create.reasonLabel), reason);
    if (withEvidence) {
      await user.click(screen.getByRole('button', { name: 'Choose image' }));
      await screen.findByRole('option', { name: 'Image 1' });
      await user.selectOptions(screen.getByLabelText('Image source'), '0');
      await user.click(screen.getByRole('button', { name: 'Add mask' }));
      await user.click(screen.getByRole('button', { name: 'Preview image' }));
      await screen.findByRole('img', { name: 'Image to share' });
      await user.click(screen.getByRole('checkbox', { name: /I reviewed this image/ }));
    }
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: form.create.submitLabel }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: form.create.submitLabel }));
    let requestId = '';
    await waitFor(async () => {
      const list = await client.listSafetyIdentificationRequests(officerToken, siteId);
      expect(list.total).toBe(1);
      expect(list.items[0]?.episodeId).toBe(episodeId);
      requestId = list.items[0]!.id;
    });
    unmount();
    async function open() {
      await user.click(await screen.findByRole('button', { name: new RegExp(reason) }));
      await screen.findByLabelText(copy.detail.title);
    }
    async function status(expected: string, version: number) {
      await waitFor(async () => {
        const current = await client.getSafetyIdentificationRequest(
          officerToken,
          siteId,
          requestId,
        );
        expect(current.status).toBe(expected);
        expect(current.version).toBe(version);
      });
    }
    unmount = mount(managerToken);
    await open();
    expect(screen.queryByRole('button', { name: copy.detail.acceptButton })).toBeNull();
    if (withEvidence) {
      await user.click(await screen.findByRole('button', { name: 'Evidence image 1' }));
      await screen.findByRole('img', { name: 'Evidence image 1' });
      expect(images).toHaveLength(originalImageCount + 2);
      expect(Buffer.from(await images.at(-1)!.arrayBuffer())).toEqual(
        Buffer.from(await images.at(-2)!.arrayBuffer()),
      );
      await user.click(screen.getByRole('button', { name: 'Close image' }));
    } else {
      expect(await screen.findByText(copy.detail.evidenceUnavailableBadge)).toBeTruthy();
    }
    expect(screen.getByLabelText(copy.detail.title).querySelector('img')).toBeNull();
    await user.type(
      screen.getByLabelText(form.response.reasonLabel),
      'Insufficient subject evidence',
    );
    await user.click(screen.getByRole('button', { name: form.response.submitLabel }));
    await status('RESPONDED', 2);
    unmount();
    unmount = mount(officerToken);
    await open();
    await user.type(
      screen.getByLabelText(copy.detail.reviewReasonLabel),
      'Please confirm whether further evidence exists',
    );
    await user.click(screen.getByRole('button', { name: copy.detail.returnButton }));
    await status('OPEN', 3);
    unmount();
    unmount = mount(managerToken);
    await open();
    if (workerId && contractorId) {
      await user.click(await screen.findByRole('radio', { name: /^Identified/i }));
      await user.selectOptions(
        await screen.findByLabelText(form.response.contractorLabel),
        contractorId,
      );
      await waitFor(() => {
        const select = screen.getByLabelText<HTMLSelectElement>(form.response.workerLabel);
        expect(Array.from(select.options, (option) => option.value)).toContain(workerId);
      });
      await user.selectOptions(screen.getByLabelText(form.response.workerLabel), workerId);
    }
    await user.type(
      screen.getByLabelText(form.response.reasonLabel),
      workerId
        ? 'Synthetic identity independently checked by Manager'
        : 'Still unresolved; do not assign a Worker',
    );
    await user.click(screen.getByRole('button', { name: form.response.submitLabel }));
    await status('RESPONDED', 4);
    unmount();
    unmount = mount(officerToken, originHref);
    await open();
    await user.type(
      screen.getByLabelText(copy.detail.reviewReasonLabel),
      'Record the Manager result without automatic responsibility assignment',
    );
    await user.click(screen.getByRole('button', { name: copy.detail.acceptButton }));
    await status('CLOSED', 5);
    const current = await client.getSafetyIdentificationRequest(officerToken, siteId, requestId);
    expect(current.result).toMatchObject({
      outcome: workerId ? 'IDENTIFIED' : 'UNRESOLVED',
      workerId: workerId ?? null,
      contractorId: contractorId ?? null,
    });
    const history = await client.listSafetyIdentificationHistory(officerToken, siteId, requestId);
    expect(history.items.map((item) => item.kind).reverse()).toEqual([
      'CREATE',
      'RESPOND',
      'RETURN',
      'RESPOND',
      'ACCEPT',
    ]);
    await expect(
      client.listSafetyIdentificationHistory(managerToken, siteId, requestId),
    ).rejects.toMatchObject({ status: 403 });
    const returnLink = await waitFor(() => {
      const link = screen.getAllByRole('link').find((candidate) => {
        const url = new URL(candidate.getAttribute('href') ?? '', 'http://localhost');
        return (
          url.pathname === '/incidents' &&
          url.searchParams.get('tab') === 'episodes' &&
          url.searchParams.get('siteId') === siteId &&
          url.searchParams.get('recipientId') === recipientId &&
          url.searchParams.get('frameKey') === frame.frameKey
        );
      });
      if (!link) throw new Error('Closed request has no link to the originating Inbox record');
      return link;
    });
    await user.click(returnLink);
    expect(await screen.findByRole('link', { name: 'Request identification' })).toBeTruthy();
    await user.click(await screen.findByRole('link', { name: 'Back to this frame' }));
    expect(await screen.findByRole('link', { name: 'Open case for person 1' })).toBeTruthy();
    unmount();
  },
  45000,
);
