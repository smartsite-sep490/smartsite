// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { CameraResponse, Mf06AssessmentResponse } from '@smartsite/api-client';
import { Mf06AssessmentCaseCard } from './Mf06AssessmentCaseCard';
import { LocaleProvider } from '../../i18n/locale';
import i18n from '../../i18n/runtime';

type CameraCatalogItem = Pick<CameraResponse, 'id' | 'siteId' | 'code' | 'name'>;

const VALID_SITE_ID = '00000000-0000-4000-8000-000000000010';
const FOREIGN_SITE_ID = '00000000-0000-4000-8000-000000000099';
const VALID_CAMERA_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_CAMERA_ID = '55555555-5555-4555-8555-555555555599';
const VALID_ZONE_ID = '66666666-6666-4666-8666-666666666666';

function makeAssessment(overrides: Partial<Mf06AssessmentResponse> = {}): Mf06AssessmentResponse {
  return {
    assessmentId: '00000000-0000-4000-8000-000000000101',
    siteId: '00000000-0000-4000-8000-000000000010',
    requestId: '00000000-0000-4000-8000-000000000201',
    eventId: '00000000-0000-4000-8000-000000000301',
    cameraId: 'cam-gate-north',
    zoneId: 'zone-crane-bay',
    purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    outcome: 'DENIED',
    reasonCode: 'POLICY_PROHIBITED',
    provenance: 'TRUSTED_SERVICE',
    evaluatorVersion: 'mf06-v1.0.0',
    capturedAt: '2026-10-21T08:15:00Z',
    assessedAt: '2026-10-21T08:15:02Z',
    ...overrides,
  };
}

describe('Mf06AssessmentCaseCard', () => {
  it('updates delivery after refresh and locale change, then clears it for legacy data', async () => {
    const partial = makeAssessment({
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      frameDelivery: {
        frameId: '00000000-0000-4000-8000-000000000401',
        sequenceNumber: '9007199254740994',
        partCount: 2,
        receivedParts: 1,
        status: 'PARTIAL',
      },
    });
    const view = (assessment: Mf06AssessmentResponse) => (
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope"
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>
    );
    const { rerender } = render(view(partial));
    expect(screen.getByText('Frame data incomplete · 1/2 parts')).toBeTruthy();
    rerender(
      view({
        ...partial,
        frameDelivery: { ...partial.frameDelivery!, receivedParts: 2, status: 'COMPLETE' },
      }),
    );
    expect(screen.queryByText('Frame data incomplete · 1/2 parts')).toBeNull();
    expect(screen.getByText('All frame data received · 2/2 parts')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByText('Đã nhận đủ dữ liệu khung hình · 2/2 phần')).toBeTruthy();
    rerender(view(makeAssessment()));
    expect(screen.queryByText(/2\/2/)).toBeNull();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it.each([
    ['PARTIAL', 1, 'Frame data incomplete · 1/2 parts'],
    ['COMPLETE', 2, 'All frame data received · 2/2 parts'],
  ] as const)('shows %s delivery independently of outcome', (status, receivedParts, label) => {
    const assessment = makeAssessment({
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      frameDelivery: {
        frameId: '00000000-0000-4000-8000-000000000401',
        sequenceNumber: '9007199254740994',
        partCount: 2,
        receivedParts,
        status,
      },
    });
    render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope"
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText('Identity Unavailable')).toBeTruthy();
    expect(screen.queryByText('Allowed')).toBeNull();
  });
  it('does not invent delivery for legacy records', () => {
    render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={makeAssessment()}
            referencesKey="scope"
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );
    expect(screen.queryByText(/Frame data incomplete|All frame data received/)).toBeNull();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders low-density header with one outcome badge, plain reason, and honest image/person notices', () => {
    const denied = makeAssessment({ outcome: 'DENIED', reasonCode: 'POLICY_PROHIBITED' });
    const unavailable = makeAssessment({
      assessmentId: '00000000-0000-4000-8000-000000000102',
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      purpose: 'RETROSPECTIVE_REVIEW',
    });

    const { container } = render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={denied}
            referencesKey="scope-1"
            onViewAssessment={vi.fn()}
          />
          <Mf06AssessmentCaseCard
            assessment={unavailable}
            referencesKey="scope-1"
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getAllByText('MF06')).toHaveLength(2);
    expect(screen.getByText('Denied')).toBeTruthy();
    expect(screen.getByText('Prohibited by Policy')).toBeTruthy();
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText('Identity Unavailable')).toBeTruthy();

    expect(screen.getAllByText('View image in record (if available)')).toHaveLength(2);
    expect(screen.getAllByText('No public person/team data available')).toHaveLength(2);
    expect(container.textContent).not.toContain('Unverified');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('places camera/zone UUIDs, purpose, evaluator version, assessed time, and raw IDs inside details and triggers onViewAssessment', () => {
    const onViewAssessment = vi.fn();
    const assessment = makeAssessment({
      outcome: 'ALLOWED',
      reasonCode: 'AUTHORIZED',
    });

    const { container } = render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-1"
            onViewAssessment={onViewAssessment}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getAllByText(/cam-gate-north/)).toHaveLength(1);
    expect(screen.getAllByText(/zone-crane-bay/)).toHaveLength(1);

    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('cam-gate-north');
    expect(details?.textContent).toContain('zone-crane-bay');
    expect(details?.textContent).toContain('Initial Observation');
    expect(details?.textContent).toContain('vmf06-v1.0.0');
    expect(details?.textContent).toContain(assessment.assessmentId);
    expect(details?.textContent).toContain(assessment.requestId);
    expect(details?.textContent).toContain(assessment.eventId);
    expect(details?.textContent).toContain('TRUSTED_SERVICE');

    fireEvent.click(screen.getByRole('button', { name: 'View assessment' }));
    expect(onViewAssessment).toHaveBeenCalledTimes(1);
  });

  it('renders Vietnamese low-density case labels when locale is vi', async () => {
    await i18n.changeLanguage('vi');

    const assessment = makeAssessment({
      outcome: 'ALLOWED',
      reasonCode: 'AUTHORIZED',
    });

    const { container } = render(
      <LocaleProvider defaultLocale="vi">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-vi"
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getByText('MF06')).toBeTruthy();
    expect(screen.getByText('Được phép')).toBeTruthy();
    expect(screen.getByText('Đủ điều kiện theo quy định')).toBeTruthy();
    expect(screen.getByText('Ảnh trong hồ sơ (nếu có)')).toBeTruthy();
    expect(screen.getByText('Không có dữ liệu công khai về người/tổ đội')).toBeTruthy();
    expect(container.querySelector('details')?.textContent).toContain('Quan sát ban đầu');
  });

  it('current camera catalog displays matched same-Site camera name and code under Camera (current catalog) outside technical IDs in en and vi', async () => {
    await i18n.changeLanguage('en');
    const assessment = makeAssessment({
      siteId: VALID_SITE_ID,
      cameraId: VALID_CAMERA_ID,
      zoneId: VALID_ZONE_ID,
    });
    const cameraCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: VALID_CAMERA_ID.toUpperCase(),
        siteId: VALID_SITE_ID,
        code: 'CAM-01',
        name: 'North Gate Camera',
      },
    ];

    const { container, rerender } = render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-en"
            cameraCatalog={cameraCatalog}
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getByText('Camera (current catalog)')).toBeTruthy();
    expect(screen.getByText(/North Gate Camera/)).toBeTruthy();
    expect(screen.getByText(/CAM-01/)).toBeTruthy();
    expect(screen.getByText('No public person/team data available')).toBeTruthy();

    const details = container.querySelector('details');
    expect(details).toBeTruthy();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).not.toContain('North Gate Camera');
    expect(details?.textContent).not.toContain('CAM-01');
    expect(details?.textContent).toContain(VALID_CAMERA_ID);
    expect(details?.textContent).toContain(VALID_ZONE_ID);

    await i18n.changeLanguage('vi');
    rerender(
      <LocaleProvider defaultLocale="vi">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-vi"
            cameraCatalog={cameraCatalog}
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getByText('Camera (danh mục hiện tại)')).toBeTruthy();
    expect(screen.getByText(/North Gate Camera/)).toBeTruthy();
    expect(screen.getByText(/CAM-01/)).toBeTruthy();
  });

  it('current camera catalog omits foreign-Site label for same cameraId while rendering same-Site match', async () => {
    await i18n.changeLanguage('en');
    const assessment = makeAssessment({
      siteId: VALID_SITE_ID,
      cameraId: VALID_CAMERA_ID,
      zoneId: VALID_ZONE_ID,
    });
    const foreignAndOtherCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: VALID_CAMERA_ID,
        siteId: FOREIGN_SITE_ID,
        code: 'CAM-FOREIGN',
        name: 'Foreign Gate Camera',
      },
      {
        id: OTHER_CAMERA_ID,
        siteId: VALID_SITE_ID,
        code: 'CAM-OTHER',
        name: 'Other Site Camera',
      },
    ];
    const sameSiteCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: VALID_CAMERA_ID,
        siteId: VALID_SITE_ID,
        code: 'CAM-01',
        name: 'North Gate Camera',
      },
    ];

    const { rerender } = render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-foreign"
            cameraCatalog={foreignAndOtherCatalog}
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.queryByText('Camera (current catalog)')).toBeNull();
    expect(screen.queryByText(/Foreign Gate Camera/)).toBeNull();
    expect(screen.queryByText(/CAM-FOREIGN/)).toBeNull();
    expect(screen.queryByText(/Other Site Camera/)).toBeNull();

    rerender(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-same"
            cameraCatalog={sameSiteCatalog}
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getByText('Camera (current catalog)')).toBeTruthy();
    expect(screen.getByText(/North Gate Camera/)).toBeTruthy();
  });

  it('current camera catalog clears displayed camera name and code when rerendered without catalog', async () => {
    await i18n.changeLanguage('en');
    const assessment = makeAssessment({
      siteId: VALID_SITE_ID,
      cameraId: VALID_CAMERA_ID,
      zoneId: VALID_ZONE_ID,
    });
    const cameraCatalog: ReadonlyArray<CameraCatalogItem> = [
      {
        id: VALID_CAMERA_ID,
        siteId: VALID_SITE_ID,
        code: 'CAM-01',
        name: 'North Gate Camera',
      },
    ];

    const { rerender } = render(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-with-catalog"
            cameraCatalog={cameraCatalog}
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.getByText('Camera (current catalog)')).toBeTruthy();
    expect(screen.getByText(/North Gate Camera/)).toBeTruthy();
    expect(screen.getByText(/CAM-01/)).toBeTruthy();

    rerender(
      <LocaleProvider defaultLocale="en">
        <ul>
          <Mf06AssessmentCaseCard
            assessment={assessment}
            referencesKey="scope-without-catalog"
            cameraCatalog={undefined}
            onViewAssessment={vi.fn()}
          />
        </ul>
      </LocaleProvider>,
    );

    expect(screen.queryByText('Camera (current catalog)')).toBeNull();
    expect(screen.queryByText(/North Gate Camera/)).toBeNull();
    expect(screen.queryByText(/CAM-01/)).toBeNull();
  });
});
