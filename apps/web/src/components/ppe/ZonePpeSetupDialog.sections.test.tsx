// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient, type ZoneResponse } from '@smartsite/api-client';
import i18n from '../../i18n';
import { ZonePpeSetupDialog } from './ZonePpeSetupDialog';

vi.mock('./ZonePpeCameraRegionPanel', () => ({
  ZonePpeCameraRegionPanel: () => <div>Region configuration</div>,
}));

type SectionMode = 'all' | 'zones' | 'regions';
type DialogPropsWithSection = ComponentProps<typeof ZonePpeSetupDialog> & {
  section?: SectionMode;
};

const site = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'SITE-01',
  name: 'North Gate',
};

const otherSite = {
  ...site,
  id: '99999999-9999-4999-8999-999999999999',
  code: 'SITE-02',
  name: 'South Gate',
};

const zone: ZoneResponse = {
  id: '33333333-3333-4333-8333-333333333333',
  siteId: site.id,
  code: 'GROUND',
  name: 'Ground work',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  configurationLocked: false,
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  createdAt: '2026-04-06T00:00:00.000Z',
};

const EMPTY_ZONES_PREREQ =
  'Create and save an area policy in step 1 before linking observation regions.';

function renderDialog(
  props: Partial<DialogPropsWithSection> = {},
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  }),
) {
  const defaultProps: DialogPropsWithSection = {
    apiUrl: 'http://localhost:3000',
    sessionScope: 'section-session',
    credentialId: 1,
    onClose: vi.fn(),
    token: 'token-one',
    siteId: site.id,
    siteName: site.name,
    canManageZones: true,
    canManageRegions: true,
    ...props,
  };

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ZonePpeSetupDialog {...defaultProps} />
    </QueryClientProvider>,
  );

  return {
    ...view,
    queryClient,
    rerenderDialog: (nextProps: Partial<DialogPropsWithSection>) =>
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <ZonePpeSetupDialog {...defaultProps} {...nextProps} />
        </QueryClientProvider>,
      ),
  };
}

describe('ZonePpeSetupDialog section mode separation', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network in DOM test')));
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [zone],
      total: 1,
    });
  });

  afterEach(async () => {
    cleanup();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders Zone creation and list without Region configuration when section is zones', async () => {
    renderDialog({ section: 'zones' });

    expect(await screen.findByRole('dialog', { name: 'Zone PPE configuration' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Zone Code' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Zone Name' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save Zone PPE' })).toBeDefined();
    expect(await screen.findByText('Configured Zones for this Site')).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Rename GROUND' })).toBeDefined();
    expect(screen.queryByText('Region configuration')).toBeNull();
  });

  it('renders Region configuration once with Region dialog title and no Zone form/list when section is regions', async () => {
    renderDialog({ section: 'regions' });

    expect(await screen.findByRole('dialog', { name: 'Link Zone to Camera Region' })).toBeDefined();
    expect(await screen.findAllByText('Region configuration')).toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: 'Zone Code' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Zone Name' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save Zone PPE' })).toBeNull();
    expect(screen.queryByText('Configured Zones for this Site')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename GROUND' })).toBeNull();
  });

  it('shows loading status and 403 error in regions section without Region configuration or empty-zones prerequisite', async () => {
    let rejectZones!: (reason?: unknown) => void;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectZones = reject;
        }),
    );

    renderDialog({ section: 'regions' });

    expect(await screen.findByRole('status')).toHaveProperty(
      'textContent',
      'Loading configured zones...',
    );
    expect(screen.queryByText('Region configuration')).toBeNull();
    expect(screen.queryByText(EMPTY_ZONES_PREREQ)).toBeNull();

    await act(async () => {
      rejectZones(new ApiError('http', 'FORBIDDEN', 403));
    });

    expect(
      await screen.findByText(
        'Could not load configured zones for this site. Access denied or session expired.',
      ),
    ).toBeDefined();
    expect(screen.queryByText('Region configuration')).toBeNull();
    expect(screen.queryByText(EMPTY_ZONES_PREREQ)).toBeNull();
  });

  it('shows the existing zero-zones prerequisite without mounting Region configuration when regions section settles empty', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });

    renderDialog({ section: 'regions' });

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveProperty('textContent', EMPTY_ZONES_PREREQ),
    );
    expect(screen.queryByText('Region configuration')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Zone Code' })).toBeNull();
  });

  it('denies regions section for read-only Admin without rendering dialog or calling listZones', () => {
    const listZonesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listZones');

    renderDialog({
      section: 'regions',
      canManageZones: false,
      canManageRegions: false,
      canReadZones: true,
    });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Region configuration')).toBeNull();
    expect(listZonesSpy).not.toHaveBeenCalled();
  });

  it('preserves legacy all section behavior when section prop is omitted', async () => {
    renderDialog();

    expect(await screen.findByRole('dialog', { name: 'Zone PPE configuration' })).toBeDefined();
    expect(screen.getByRole('textbox', { name: 'Zone Code' })).toBeDefined();
    expect(await screen.findByRole('button', { name: 'Rename GROUND' })).toBeDefined();
    expect(await screen.findByText('Region configuration')).toBeDefined();
  });

  it('hides next-page action after a base refresh fails on a previously partial list', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.listZones)
      .mockResolvedValueOnce({ items: [{ ...zone, siteId: otherSite.id }], total: 2 })
      .mockRejectedValueOnce(new ApiError('http', 'UNAVAILABLE', 503));
    const { queryClient } = renderDialog({ section: 'regions' });
    await screen.findByRole('button', { name: 'Load more zones' });
    await act(async () => {
      await queryClient.refetchQueries();
    });
    expect(await screen.findByRole('button', { name: 'Retry loading zones' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Load more zones' })).toBeNull();
    expect(screen.queryByText(EMPTY_ZONES_PREREQ)).toBeNull();
    queryClient.clear();
  });

  it('retains explicit Zone pagination for Region options and does not call a partial list empty', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.listZones)
      .mockResolvedValueOnce({ items: [{ ...zone, siteId: otherSite.id }], total: 2 })
      .mockResolvedValueOnce({ items: [zone], total: 2 });
    renderDialog({ section: 'regions' });
    const more = await screen.findByRole('button', { name: 'Load more zones' });
    expect(screen.queryByText(EMPTY_ZONES_PREREQ)).toBeNull();
    expect(screen.queryByText('Region configuration')).toBeNull();
    fireEvent.click(more);
    expect(await screen.findByText('Region configuration')).toBeTruthy();
    expect(SmartSiteManagementClient.prototype.listZones).toHaveBeenLastCalledWith(
      'token-one',
      site.id,
      { offset: 1, limit: 20 },
      { signal: expect.any(AbortSignal) },
    );
  });

  it.each([401, 404])(
    'does not convert a denied %s Region prerequisite read into an empty catalog',
    async (status) => {
      vi.mocked(SmartSiteManagementClient.prototype.listZones).mockRejectedValue(
        new ApiError('http', 'Denied', status),
      );
      renderDialog({ section: 'regions' });
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(screen.queryByText(EMPTY_ZONES_PREREQ)).toBeNull();
      expect(screen.queryByText('Region configuration')).toBeNull();
    },
  );

  it('preserves active draft across EN/VI locale switch in zones section and clears draft when section, token, or siteId changes', async () => {
    const { rerenderDialog } = renderDialog({ section: 'zones' });

    const codeInput = await screen.findByRole('textbox', { name: 'Zone Code' });
    fireEvent.change(codeInput, { target: { value: 'ASSEMBLY' } });
    expect((codeInput as HTMLInputElement).value).toBe('ASSEMBLY');

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect((screen.getByRole('textbox', { name: 'Mã khu vực' }) as HTMLInputElement).value).toBe(
      'ASSEMBLY',
    );

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe(
      'ASSEMBLY',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.getByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeDefined();

    rerenderDialog({ section: 'regions' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved Zone changes?' })).toBeNull();
    });

    rerenderDialog({ section: 'zones' });
    expect(
      ((await screen.findByRole('textbox', { name: 'Zone Code' })) as HTMLInputElement).value,
    ).toBe('');

    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Code' }), {
      target: { value: 'CRANE' },
    });
    rerenderDialog({ section: 'zones', token: 'token-two' });
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe(
        '',
      );
    });

    fireEvent.change(screen.getByRole('textbox', { name: 'Zone Code' }), {
      target: { value: 'GATE' },
    });
    rerenderDialog({
      section: 'zones',
      token: 'token-two',
      siteId: otherSite.id,
      siteName: otherSite.name,
    });
    await waitFor(() => {
      expect((screen.getByRole('textbox', { name: 'Zone Code' }) as HTMLInputElement).value).toBe(
        '',
      );
    });
  });
});
