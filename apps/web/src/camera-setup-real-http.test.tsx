// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { afterEach, expect, it, vi } from 'vitest';
import { CameraSetupRoute } from './components/cameras/CameraSetupRoute';
import { AuthContext } from './features/auth/auth-session';
import { WebSession } from './features/auth/web-session';
import i18n from './i18n';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.runIf(process.env.SMARTSITE_C02_OWNED_FIXTURE === '1')(
  'lets the assigned Manager create a five-item PPE Zone from Camera Setup over HTTP',
  async () => {
    const endpoint = process.env.VITE_API_URL ?? '';
    expect(endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const siteId = process.env.SMARTSITE_C02_SITE!;
    const token = process.env.SMARTSITE_C02_MANAGER_TOKEN!;
    const client = new SmartSiteManagementClient(endpoint);
    const polygonAuthoring = process.env.SMARTSITE_C02_POLYGON === '1';
    if (polygonAuthoring)
      vi.stubGlobal(
        'Image',
        class {
          src = '';
          naturalWidth = 120;
          naturalHeight = 80;
          decode() {
            return Promise.resolve();
          }
        },
      );
    await i18n.changeLanguage('en');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const webSession = new WebSession(endpoint);
    webSession.setAccessToken(token);
    const view = render(
      <MemoryRouter initialEntries={['/camera-setup?siteId=' + siteId]}>
        <QueryClientProvider client={queries}>
          <AuthContext.Provider
            value={{
              manager: webSession,
              epoch: webSession.getSnapshot().epoch,
              accessToken: token,
              isSessionExpired: false,
              setAccessToken: vi.fn(),
              triggerSessionExpired: vi.fn(),
              dismissSessionExpired: vi.fn(),
            }}
          >
            <CameraSetupRoute apiUrl={endpoint} />
          </AuthContext.Provider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    try {
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Configure PPE by Zone' }));
      await user.type(await screen.findByLabelText('Zone Code'), 'SYNTH-MANAGER-PPE');
      await user.type(screen.getByLabelText('Zone Name'), 'Synthetic UI PPE Zone');
      for (const name of [/Hard Hat \/ Helmet/, /Safety Vest/, /Gloves/, /Boots/, /Goggles/]) {
        const checkbox = screen.getByRole('checkbox', { name }) as HTMLInputElement;
        if (!checkbox.checked) await user.click(checkbox);
      }
      await user.click(screen.getByRole('button', { name: 'Save Zone PPE' }));
      await screen.findByText(/SYNTH-MANAGER-PPE.*created successfully/);
      await waitFor(async () => {
        const zones = await client.listZones(token, siteId, { limit: 20 });
        const created = zones.items.find((zone) => zone.code === 'SYNTH-MANAGER-PPE');
        expect(created?.siteId).toBe(siteId);
        expect(new Set(created?.requiredPpe)).toEqual(
          new Set(['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']),
        );
      });
      if (polygonAuthoring) {
        const zone = (await client.listZones(token, siteId, { limit: 20 })).items.find(
          (entry) => entry.code === 'SYNTH-MANAGER-PPE',
        )!;
        await user.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: 'Close dialog' }),
        );
        await user.click(await screen.findByRole('button', { name: 'Regions' }));
        await user.selectOptions(
          await screen.findByRole('combobox', { name: 'Select Zone' }),
          zone.id,
        );
        await user.click(screen.getByRole('button', { name: 'Get configuration image' }));
        const start = screen.getByRole('button', { name: 'Start Drawing Region' });
        await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
        await user.click(start);
        for (const [x, y] of [
          [0.2, 0.2],
          [0.7, 0.2],
          [0.5, 0.7],
        ]) {
          fireEvent.change(screen.getByLabelText('Point X (0–1)'), {
            target: { value: String(x) },
          });
          fireEvent.change(screen.getByLabelText('Point Y (0–1)'), {
            target: { value: String(y) },
          });
          await user.click(screen.getByRole('button', { name: 'Add Point' }));
        }
        await user.click(
          screen.getByRole('checkbox', {
            name: 'I checked that the drawn region matches this reference image',
          }),
        );
        if (process.env.SMARTSITE_C02_POLICY_V2 === '1') {
          const mode = await screen.findByLabelText('Policy mode');
          expect(
            (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
          ).toBe(true);
          await user.selectOptions(mode, 'EXPLICIT');
          expect(
            (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
          ).toBe(true);
          await user.click(screen.getByRole('checkbox', { name: 'Gloves' }));
        }
        await waitFor(() =>
          expect(
            (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
          ).toBe(false),
        );
        await user.click(screen.getByRole('button', { name: 'Save Region' }));
        await waitFor(async () => {
          const cameras = await client.listCameras(token, siteId, { limit: 20 });
          const regions = await client.listRegions(token, siteId, cameras.items[0]!.id, {
            limit: 20,
          });
          expect(regions.items.find((entry) => entry.zoneId === zone.id)?.polygon).toEqual({
            coordinates: [
              [0.2, 0.2],
              [0.7, 0.2],
              [0.5, 0.7],
            ],
          });
        });
      }
    } finally {
      view.unmount();
      queries.clear();
      webSession.dispose();
    }
  },
  30000,
);
