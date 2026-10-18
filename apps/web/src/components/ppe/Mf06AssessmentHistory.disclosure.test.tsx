// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06AssessmentPage,
  type Mf06AssessmentResponse,
} from '@smartsite/api-client';
import { LocaleProvider } from '../../i18n/locale';
import { changeUiLanguage } from '../../i18n/runtime';
import { Mf06AssessmentHistory } from './Mf06AssessmentHistory';

const SITE_1 = '33333333-3333-4333-8333-333333333331';
const SITE_2 = '33333333-3333-4333-8333-333333333332';
const SITE_FORBIDDEN = '33333333-3333-4333-8333-333333333339';
const CAMERA_1 = '55555555-5555-4555-8555-555555555551';
const CAMERA_2 = '55555555-5555-4555-8555-555555555552';
const CAMERA_SITE_2 = '55555555-5555-4555-8555-555555555553';
const ZONE_1 = '66666666-6666-4666-8666-666666666661';
const ZONE_2 = '66666666-6666-4666-8666-666666666662';
const ZONE_SITE_2 = '66666666-6666-4666-8666-666666666663';
const CREDENTIAL_1 = 'cred-test-1';
const TOKEN_1 = 'token-test-1';

function createAssessment(overrides?: Partial<Mf06AssessmentResponse>): Mf06AssessmentResponse {
  return {
    assessmentId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
    siteId: SITE_1,
    eventId: '44444444-4444-4444-8444-444444444444',
    cameraId: CAMERA_1,
    zoneId: ZONE_1,
    capturedAt: '2026-10-12T10:00:00.000Z',
    assessedAt: '2026-10-12T10:00:01.000Z',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    outcome: 'ALLOWED',
    reasonCode: 'AUTHORIZED',
    evaluatorVersion: 'mf06-v1.0.0',
    provenance: 'TRUSTED_SERVICE',
    ...overrides,
  };
}

function createPage(items: Mf06AssessmentResponse[], total = items.length): Mf06AssessmentPage {
  return { items, total, offset: 0, limit: 20 };
}

const clients: QueryClient[] = [];
beforeEach(() => changeUiLanguage('en'));
afterEach(() => {
  changeUiLanguage('en');
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

function mountWithLocale(node: React.ReactElement) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  const wrap = (child: React.ReactElement) => (
    <QueryClientProvider client={queries}>
      <LocaleProvider>{child}</LocaleProvider>
    </QueryClientProvider>
  );
  const view = render(wrap(node));
  return {
    ...view,
    rerenderWithProviders: (next: React.ReactElement) => view.rerender(wrap(next)),
  };
}

describe('Mf06AssessmentHistory technical references disclosure', () => {
  it('keeps primary scope/outcome/timestamps/dialog visible while collapsing assessmentId and provenance per row', async () => {
    const first = createAssessment();
    const second = createAssessment({
      assessmentId: '22222222-2222-4222-8222-222222222229',
      cameraId: CAMERA_2,
      zoneId: ZONE_2,
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      purpose: 'RETROSPECTIVE_REVIEW',
      provenance: 'UNAVAILABLE',
    });
    const listMf06Assessments = vi.fn().mockResolvedValue(createPage([first, second]));
    const getMf06Assessment = vi.fn().mockResolvedValue(first);
    const client = {
      listMf06Assessments,
      getMf06Assessment,
    } as unknown as SmartSiteManagementClient;

    mountWithLocale(
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={client}
      />,
    );

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const [firstRow, secondRow] = rows;
    if (!firstRow || !secondRow) {
      throw new Error('Expected two rendered assessment rows.');
    }
    expect(
      screen.getByText(/Historical records reflect technical camera observations/i),
    ).toBeTruthy();
    for (const label of [
      'Allowed',
      'Authorized',
      'Initial Observation',
      'vmf06-v1.0.0',
      first.cameraId,
      first.zoneId,
    ]) {
      expect(within(firstRow).getByText(label).closest('details')).toBeNull();
    }
    expect(
      firstRow.querySelector(`time[datetime="${first.capturedAt}"]`)?.closest('details'),
    ).toBeNull();
    expect(
      firstRow.querySelector(`time[datetime="${first.assessedAt}"]`)?.closest('details'),
    ).toBeNull();
    for (const label of [
      'Unavailable',
      'Identity Unavailable',
      'Retrospective Review',
      second.cameraId,
      second.zoneId,
    ]) {
      expect(within(secondRow).getByText(label).closest('details')).toBeNull();
    }

    const details0 = firstRow.querySelector('details');
    const details1 = secondRow.querySelector('details');
    const summary0 = within(firstRow).getByText('Technical references').closest('summary');
    if (
      !(details0 instanceof HTMLDetailsElement) ||
      !(details1 instanceof HTMLDetailsElement) ||
      !summary0
    ) {
      throw new Error('Expected native details and summary elements.');
    }
    expect(details0.open).toBe(false);
    expect(details1.open).toBe(false);
    expect(details0.getAttribute('role')).toBeNull();
    expect(summary0.getAttribute('role')).toBeNull();
    summary0.focus();
    expect(document.activeElement).toBe(summary0);

    expect(within(firstRow).getByText(first.assessmentId).closest('details')).toBe(details0);
    expect(within(firstRow).getByText('TRUSTED_SERVICE').closest('details')).toBe(details0);
    expect(within(secondRow).getByText(second.assessmentId).closest('details')).toBe(details1);
    expect(within(secondRow).getByText('UNAVAILABLE').closest('details')).toBe(details1);

    fireEvent.click(summary0);
    expect(details0.open).toBe(true);
    expect(details1.open).toBe(false);
    expect(listMf06Assessments).toHaveBeenCalledTimes(1);

    fireEvent.click(within(firstRow).getByRole('button', { name: 'View assessment' }));
    expect(await screen.findByRole('dialog', { name: 'Recorded assessment' })).toBeTruthy();
  });

  it('renders localized Vietnamese disclosure label and technical reference fields via LocaleProvider', async () => {
    act(() => changeUiLanguage('vi'));
    const item = createAssessment();
    const client = {
      listMf06Assessments: vi.fn().mockResolvedValue(createPage([item])),
    } as unknown as SmartSiteManagementClient;

    mountWithLocale(
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={client}
      />,
    );

    const row = await screen.findByRole('listitem');
    const details = row.querySelector('details');
    const summary = within(row).getByText('Thông tin kỹ thuật').closest('summary');
    if (!(details instanceof HTMLDetailsElement) || !summary) {
      throw new Error('Expected localized details and summary elements.');
    }
    expect(details.open).toBe(false);
    expect(summary.parentElement).toBe(details);
    for (const text of ['Mã đánh giá:', item.assessmentId, 'Nguồn xác lập:', 'TRUSTED_SERVICE']) {
      expect(within(row).getByText(text).closest('details')).toBe(details);
    }

    fireEvent.click(summary);
    expect(details.open).toBe(true);

    act(() => changeUiLanguage('en'));
    expect(details.isConnected).toBe(true);
    expect(details.open).toBe(true);
    expect(within(row).getByText('Technical references').closest('summary')).toBe(summary);
    for (const text of ['Assessment ID:', item.assessmentId, 'Provenance:', 'TRUSTED_SERVICE']) {
      expect(within(row).getByText(text).closest('details')).toBe(details);
    }
  });

  it('starts collapsed on a new site scope and clears expanded references on hard scope error', async () => {
    const item1 = createAssessment();
    const item2 = createAssessment({
      assessmentId: '33333333-3333-4333-8333-333333333338',
      siteId: SITE_2,
      cameraId: CAMERA_SITE_2,
      zoneId: ZONE_SITE_2,
    });
    const listMf06Assessments = vi.fn().mockImplementation((_token: string, siteId: string) => {
      if (siteId === SITE_1) return Promise.resolve(createPage([item1]));
      if (siteId === SITE_2) return Promise.resolve(createPage([item2]));
      return Promise.reject(new ApiError('http', 'Forbidden site', 403));
    });
    const client = { listMf06Assessments } as unknown as SmartSiteManagementClient;

    const { container, rerenderWithProviders } = mountWithLocale(
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_1}
        credentialId={CREDENTIAL_1}
        client={client}
      />,
    );

    const site1Summary = (await screen.findByText('Technical references')).closest('summary');
    if (!site1Summary) {
      throw new Error('Expected Site 1 technical references summary.');
    }
    fireEvent.click(site1Summary);
    expect((container.querySelector('details') as HTMLDetailsElement | null)?.open).toBe(true);

    rerenderWithProviders(
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_2}
        credentialId={CREDENTIAL_1}
        client={client}
      />,
    );
    await waitFor(() => expect(screen.queryByText(CAMERA_SITE_2)).not.toBeNull());
    const site2Details = container.querySelector('details');
    const site2Summary = screen.getByText('Technical references').closest('summary');
    if (!(site2Details instanceof HTMLDetailsElement) || !site2Summary) {
      throw new Error('Expected Site 2 details and summary elements.');
    }
    expect(site2Details.open).toBe(false);
    expect(screen.getByText(item2.assessmentId).closest('details')).toBe(site2Details);
    expect(screen.queryByText(item1.assessmentId)).toBeNull();

    fireEvent.click(site2Summary);
    expect(site2Details.open).toBe(true);

    rerenderWithProviders(
      <Mf06AssessmentHistory
        token={TOKEN_1}
        siteId={SITE_FORBIDDEN}
        credentialId={CREDENTIAL_1}
        client={client}
      />,
    );
    await waitFor(() =>
      expect(
        screen.queryByText('You do not have permission to view assessments for this site.'),
      ).not.toBeNull(),
    );
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(screen.queryByText(item2.assessmentId)).toBeNull();
  });
});
