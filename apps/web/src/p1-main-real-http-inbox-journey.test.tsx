// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { AccountResponse } from '@smartsite/api-client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from './app';
import i18n from './i18n';

const session = vi.hoisted(() => {
  window.matchMedia = vi.fn((media: string) => ({
    media,
    matches: false,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  }));
  return { token: '', user: null as AccountResponse | null };
});
vi.mock('./features/auth/auth-session', async (original) => ({
  ...(await original<typeof import('./features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: session.token, isSessionExpired: false }),
  useCurrentUser: () => ({ data: session.user }),
  useLogout: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ isLoading: false }),
  SessionExpiredModal: () => null,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const endpoint = process.env.VITE_API_URL ?? '';
it.runIf(process.env.SMARTSITE_P1_OWNED_FIXTURE === '1')(
  'opens a grouped Bell item, loads protected JPEGs and persists both finding decisions over HTTP',
  async () => {
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    session.token = process.env.SMARTSITE_P1_FIXTURE_TOKEN ?? '';
    expect(Boolean(session.token)).toBe(true);
    const recipientId = process.env.SMARTSITE_P1_FIXTURE_RECIPIENT!;
    const client = new SmartSiteManagementClient(endpoint);
    session.user = await client.me(session.token);
    await i18n.changeLanguage('en');
    vi.stubGlobal('crypto', webcrypto);
    const issuedUrls: string[] = [];
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL(blob: Blob) {
          expect(blob.type).toBe('image/jpeg');
          expect(blob.size).toBeGreaterThan(4);
          const url = 'blob:fixture-frame-' + issuedUrls.length;
          issuedUrls.push(url);
          return url;
        }
        static revokeObjectURL() {}
      },
    );
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/incidents?tab=episodes']}>
        <QueryClientProvider client={queries}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const openFromBell = async () => {
      await user.click(await screen.findByRole('button', { name: /notifications/i }));
      await user.click(await screen.findByTestId('notification-bell-ppe-frame'));
      await user.click(await screen.findByRole('link', { name: /open case/i }));
      await screen.findByTestId('tracked-workspace-finding-reviews');
    };
    await openFromBell();
    const scopedInbox = await client.listSafetyEpisodeInbox(session.token, {
      recipientId,
      limit: 1,
    });
    expect(scopedInbox.items[0]?.unread).toBe(true);
    expect(scopedInbox.items[0]?.episode.findingCount).toBe(2);
    const episode = scopedInbox.items[0]!.episode;
    const tracked = await client.getTrackedEpisode(session.token, episode.siteId, episode.id);
    const frames = await screen.findAllByTestId('tracked-history-item');
    expect(frames).toHaveLength(2);
    for (const row of frames) {
      await user.click(within(row).getByRole('button', { name: 'Full FRAME #0' }));
      await screen.findByTestId('tracked-viewer-image');
      await user.click(screen.getByRole('button', { name: 'Close viewer' }));
    }
    expect(issuedUrls).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Mark viewed version read' }));
    await screen.findByText('Read status saved.');
    for (const [index, finding] of tracked.findings.entries()) {
      await user.click(screen.getByTestId(`tracked-workspace-review-finding-${finding.alertId}`));
      await user.type(
        await screen.findByRole('textbox', { name: /decision reason/i }),
        'Synthetic integration review',
      );
      await user.click(
        screen.getByRole('button', { name: index === 0 ? /dismiss alert/i : /confirm violation/i }),
      );
      await screen.findByText(`Alert ${finding.alertId} · Revision ${finding.alertRevision + 1}`);
      await openFromBell();
      expect(
        screen.getByTestId(`tracked-workspace-finding-status-${finding.alertId}`).textContent,
      ).toMatch(index === 0 ? /dismissed/i : /confirmed/i);
    }
    const persisted = await client.getTrackedEpisode(session.token, episode.siteId, episode.id);
    expect(persisted.findings.map(({ status }) => status)).toEqual(['DISMISSED', 'CONFIRMED']);
  },
  45000,
);
