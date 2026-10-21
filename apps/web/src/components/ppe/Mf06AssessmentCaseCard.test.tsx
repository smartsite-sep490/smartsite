// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Mf06AssessmentResponse } from '@smartsite/api-client';
import { Mf06AssessmentCaseCard } from './Mf06AssessmentCaseCard';
import { LocaleProvider } from '../../i18n/locale';
import i18n from '../../i18n/runtime';

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
});
