// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { RegionGeometryConfirmation, RegionResponse } from '@smartsite/contracts';
import { LocaleProvider, useLocale } from '../../i18n/locale';
import { RegionGeometryConfirmationStatus } from './RegionGeometryConfirmationStatus';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import {
  baseCamera,
  existingRegionFixture,
  mockZones,
  stubCameraAndRegionPages,
} from './ZonePpeCameraRegionPanel.reference.fixtures';

const REF_ID = 'a5555555-5555-4555-8555-55555555555a';
const ACTOR_ID = '66666666-6666-4666-8666-666666666666';
const CONFIRMED_AT = '2026-10-26T12:34:56.000Z';

const UNCONFIRMED_PAYLOAD: RegionGeometryConfirmation = {
  status: 'UNCONFIRMED',
  referenceId: null,
  viewRevision: null,
  confirmedByUserId: null,
  confirmedAt: null,
};

const MANUALLY_CONFIRMED_PAYLOAD: RegionGeometryConfirmation = {
  status: 'MANUALLY_CONFIRMED',
  referenceId: REF_ID,
  viewRevision: 2,
  confirmedByUserId: ACTOR_ID,
  confirmedAt: CONFIRMED_AT,
};

const NEEDS_REVALIDATION_PAYLOAD: RegionGeometryConfirmation = {
  status: 'NEEDS_REVALIDATION',
  referenceId: REF_ID,
  viewRevision: 1,
  confirmedByUserId: ACTOR_ID,
  confirmedAt: CONFIRMED_AT,
};

function LocaleSwitchHarness({ children }: { children: React.ReactNode }) {
  const { setLocale } = useLocale();
  return (
    <div>
      <button type="button" onClick={() => setLocale('en')}>
        set-en
      </button>
      <button type="button" onClick={() => setLocale('vi')}>
        set-vi
      </button>
      {children}
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('RegionGeometryConfirmationStatus', () => {
  it('renders UNCONFIRMED, MANUALLY_CONFIRMED, and NEEDS_REVALIDATION labels in EN and VI and switches dynamically with wrapping classes for long VI text', () => {
    const { rerender } = render(
      <LocaleProvider defaultLocale="en">
        <LocaleSwitchHarness>
          <RegionGeometryConfirmationStatus geometryConfirmation={UNCONFIRMED_PAYLOAD} />
        </LocaleSwitchHarness>
      </LocaleProvider>,
    );

    expect(
      screen
        .getByTestId('region-geometry-confirmation-status')
        .getAttribute('data-confirmation-state'),
    ).toBe('UNCONFIRMED');
    expect(screen.getByText('no confirmation recorded')).toBeTruthy();
    expect(screen.queryByTestId('region-geometry-confirmation-details')).toBeNull();

    fireEvent.click(screen.getByText('set-vi'));
    expect(screen.getByText('chưa ghi nhận xác nhận')).toBeTruthy();

    rerender(
      <LocaleProvider defaultLocale="en">
        <LocaleSwitchHarness>
          <RegionGeometryConfirmationStatus geometryConfirmation={MANUALLY_CONFIRMED_PAYLOAD} />
        </LocaleSwitchHarness>
      </LocaleProvider>,
    );
    expect(
      screen
        .getByTestId('region-geometry-confirmation-status')
        .getAttribute('data-confirmation-state'),
    ).toBe('MANUALLY_CONFIRMED');
    expect(screen.getByText('Đã xác nhận vùng trên ảnh')).toBeTruthy();
    expect(screen.getByText('Chi tiết xác nhận')).toBeTruthy();
    expect(
      screen.getByText(
        'Chỉ xác nhận ranh giới trên ảnh; chưa xác nhận camera hay giám sát đang hoạt động.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('set-en'));
    expect(screen.getByText('Region confirmed on image')).toBeTruthy();
    expect(screen.getByText('Confirmation details')).toBeTruthy();

    rerender(
      <LocaleProvider defaultLocale="en">
        <LocaleSwitchHarness>
          <RegionGeometryConfirmationStatus geometryConfirmation={NEEDS_REVALIDATION_PAYLOAD} />
        </LocaleSwitchHarness>
      </LocaleProvider>,
    );
    expect(
      screen
        .getByTestId('region-geometry-confirmation-status')
        .getAttribute('data-confirmation-state'),
    ).toBe('NEEDS_REVALIDATION');
    expect(screen.getByText('review required after view changed')).toBeTruthy();
    fireEvent.click(screen.getByText('set-vi'));

    const viBadge = screen.getByText('cần kiểm tra lại sau khi khung nhìn thay đổi');
    expect(viBadge).toBeTruthy();
    expect(viBadge.className).toContain('break-words');
    expect(viBadge.className).toContain('[overflow-wrap:anywhere]');
    expect(viBadge.className).toContain('whitespace-normal');
  });

  it('keeps missing legacy geometryConfirmation as unconfirmed without invalid error styling or disclosure', () => {
    render(
      <LocaleProvider defaultLocale="en">
        <RegionGeometryConfirmationStatus geometryConfirmation={undefined} />
      </LocaleProvider>,
    );

    expect(
      screen
        .getByTestId('region-geometry-confirmation-status')
        .getAttribute('data-confirmation-state'),
    ).toBe('UNCONFIRMED');
    expect(screen.getByText('no confirmation recorded')).toBeTruthy();
    expect(screen.queryByText('confirmation status unavailable')).toBeNull();
    expect(screen.queryByTestId('region-geometry-confirmation-details')).toBeNull();
  });

  it.each([
    ['null value', null],
    [
      'uppercase referenceId UUID',
      {
        ...MANUALLY_CONFIRMED_PAYLOAD,
        referenceId: REF_ID.toUpperCase(),
      },
    ],
    [
      'zero viewRevision',
      {
        ...MANUALLY_CONFIRMED_PAYLOAD,
        viewRevision: 0,
      },
    ],
    [
      'non-millisecond confirmedAt timestamp',
      {
        ...MANUALLY_CONFIRMED_PAYLOAD,
        confirmedAt: '2026-10-26T12:34:56Z',
      },
    ],
    [
      'unexpected extra property',
      {
        ...MANUALLY_CONFIRMED_PAYLOAD,
        extra: true,
      },
    ],
    [
      'UNCONFIRMED with non-null referenceId',
      {
        ...UNCONFIRMED_PAYLOAD,
        referenceId: REF_ID,
      },
    ],
  ])('fails closed on malformed present field (%s) and never shows confirmed', (_label, raw) => {
    render(
      <LocaleProvider defaultLocale="en">
        <LocaleSwitchHarness>
          <RegionGeometryConfirmationStatus geometryConfirmation={raw} />
        </LocaleSwitchHarness>
      </LocaleProvider>,
    );

    expect(
      screen
        .getByTestId('region-geometry-confirmation-status')
        .getAttribute('data-confirmation-state'),
    ).toBe('INVALID');
    expect(screen.getByText('confirmation status unavailable')).toBeTruthy();
    expect(screen.queryByText('Region confirmed on image')).toBeNull();
    expect(screen.queryByTestId('region-geometry-confirmation-details')).toBeNull();

    fireEvent.click(screen.getByText('set-vi'));
    expect(screen.getByText('trạng thái xác nhận không khả dụng')).toBeTruthy();
    expect(screen.queryByText('Đã xác nhận vùng trên ảnh')).toBeNull();
  });

  it('preserves referenceId, viewRevision, and confirmedAt in disclosure without exposing confirmedByUserId actor UUID', () => {
    render(
      <LocaleProvider defaultLocale="en">
        <RegionGeometryConfirmationStatus geometryConfirmation={MANUALLY_CONFIRMED_PAYLOAD} />
      </LocaleProvider>,
    );

    const details = screen.getByTestId('region-geometry-confirmation-details');
    expect(details.getAttribute('open')).toBeNull();
    expect(screen.getByText('Confirmation details')).toBeTruthy();
    expect(screen.getByText(`View revision: v2`)).toBeTruthy();
    expect(screen.getByText(`Reference ID: ${REF_ID}`)).toBeTruthy();
    expect(screen.getByText(`Confirmed at: ${CONFIRMED_AT}`)).toBeTruthy();
    expect(
      screen.getByText(
        'Confirms the boundary on this image only; camera and monitoring readiness are separate.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(ACTOR_ID, 'i'))).toBeNull();
  });

  it('renders confirmation statuses inside ZonePpeCameraRegionPanel region list without extra API requests or breaking Edit Geometry', async () => {
    const regions: RegionResponse[] = [
      {
        ...existingRegionFixture,
        id: 'reg-legacy-unconfirmed',
        geometryConfirmation: undefined,
      },
      {
        ...existingRegionFixture,
        id: 'reg-confirmed',
        geometryConfirmation: MANUALLY_CONFIRMED_PAYLOAD,
      },
      {
        ...existingRegionFixture,
        id: 'reg-revalidation',
        geometryConfirmation: NEEDS_REVALIDATION_PAYLOAD,
      },
    ];
    stubCameraAndRegionPages([baseCamera], regions);
    const getUserSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getUser');

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <LocaleProvider defaultLocale="en">
        <QueryClientProvider client={queryClient}>
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="token-1"
            sessionScope="scope-1"
            credentialId={1}
            siteId={baseCamera.siteId}
            zones={mockZones}
          />
        </QueryClientProvider>
      </LocaleProvider>,
    );

    expect(await screen.findByText('reg-legacy-unconfirmed')).toBeTruthy();
    expect(screen.getByText('no confirmation recorded')).toBeTruthy();
    expect(screen.getByText('Region confirmed on image')).toBeTruthy();
    expect(screen.getByText('review required after view changed')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Edit Geometry' })).toHaveLength(3);
    expect(screen.queryByText(new RegExp(ACTOR_ID, 'i'))).toBeNull();
    expect(getUserSpy).not.toHaveBeenCalled();
  });
});
