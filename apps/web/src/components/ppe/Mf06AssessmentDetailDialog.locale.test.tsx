// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  type Mf06AssessmentResponse,
  type SmartSiteManagementClient,
} from '@smartsite/api-client';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { parseMf06AssessmentResponse } from '@smartsite/contracts/mf06-assessments';
import { useLocale, type Locale } from '../../i18n/locale-context';
import { Mf06AssessmentDetailDialog } from './Mf06AssessmentDetailDialog';
import type { AssessmentTargetContext } from './mf06AssessmentDetailBinding';

const target: AssessmentTargetContext = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  siteId: '33333333-3333-4333-8333-333333333331',
  requestId: '22222222-2222-4222-8222-222222222222',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  capturedAt: '2026-10-12T10:00:00.123456Z',
};
const record: Mf06AssessmentResponse = {
  ...target,
  assessedAt: '2026-10-12T10:00:02.000Z',
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'SYNTHETIC_READ_V1',
  provenance: 'UNAVAILABLE',
};
const historyTarget: AssessmentTargetContext = {
  ...target,
  outcome: record.outcome,
  reasonCode: record.reasonCode,
  evaluatorVersion: record.evaluatorVersion,
  provenance: record.provenance,
  assessedAt: record.assessedAt,
};
const MISMATCH_UUID = '99999999-9999-4999-8999-999999999999';
const BINDING_MISMATCH_CASES: ReadonlyArray<{
  field: string;
  expectedTarget: AssessmentTargetContext;
  loadedRecord: Mf06AssessmentResponse;
  viReason: string;
  enReason: string;
}> = [
  {
    field: 'assessmentId',
    expectedTarget: target,
    loadedRecord: { ...record, assessmentId: MISMATCH_UUID },
    viReason: 'Mã đánh giá không khớp',
    enReason: 'Assessment ID mismatch',
  },
  {
    field: 'siteId',
    expectedTarget: target,
    loadedRecord: { ...record, siteId: MISMATCH_UUID },
    viReason: 'Mã công trường không khớp',
    enReason: 'Site ID mismatch',
  },
  {
    field: 'requestId',
    expectedTarget: target,
    loadedRecord: { ...record, requestId: MISMATCH_UUID },
    viReason: 'Mã yêu cầu không khớp',
    enReason: 'Request ID mismatch',
  },
  {
    field: 'eventId',
    expectedTarget: target,
    loadedRecord: { ...record, eventId: MISMATCH_UUID },
    viReason: 'Mã sự kiện không khớp',
    enReason: 'Event ID mismatch',
  },
  {
    field: 'cameraId',
    expectedTarget: target,
    loadedRecord: { ...record, cameraId: MISMATCH_UUID },
    viReason: 'Mã camera không khớp',
    enReason: 'Camera ID mismatch',
  },
  {
    field: 'zoneId',
    expectedTarget: target,
    loadedRecord: { ...record, zoneId: MISMATCH_UUID },
    viReason: 'Mã khu vực không khớp',
    enReason: 'Zone ID mismatch',
  },
  {
    field: 'purpose',
    expectedTarget: target,
    loadedRecord: { ...record, purpose: 'RETROSPECTIVE_REVIEW' },
    viReason: 'Mục đích đánh giá không khớp',
    enReason: 'Purpose mismatch',
  },
  {
    field: 'capturedAt',
    expectedTarget: target,
    loadedRecord: { ...record, capturedAt: '2026-10-12T10:00:00.123457Z' },
    viReason: 'Độ chính xác thời điểm ghi hình không khớp',
    enReason: 'CapturedAt precision mismatch',
  },
  {
    field: 'outcome',
    expectedTarget: historyTarget,
    loadedRecord: { ...record, outcome: 'DENIED', reasonCode: 'POLICY_PROHIBITED' },
    viReason: 'Kết quả đánh giá không khớp',
    enReason: 'Outcome mismatch',
  },
  {
    field: 'reasonCode',
    expectedTarget: historyTarget,
    loadedRecord: { ...record, reasonCode: 'AUTHORITY_UNAVAILABLE' },
    viReason: 'Mã lý do không khớp',
    enReason: 'Reason code mismatch',
  },
  {
    field: 'provenance',
    expectedTarget: historyTarget,
    loadedRecord: { ...record, provenance: 'TRUSTED_SERVICE' },
    viReason: 'Nguồn xác lập không khớp',
    enReason: 'Provenance mismatch',
  },
  {
    field: 'evaluatorVersion',
    expectedTarget: historyTarget,
    loadedRecord: { ...record, evaluatorVersion: 'TAMPERED_V2' },
    viReason: 'Phiên bản bộ đánh giá không khớp',
    enReason: 'Evaluator version mismatch',
  },
  {
    field: 'assessedAt',
    expectedTarget: historyTarget,
    loadedRecord: { ...record, assessedAt: '2026-10-12T10:00:02.000001Z' },
    viReason: 'Độ chính xác thời điểm đánh giá không khớp',
    enReason: 'AssessedAt precision mismatch',
  },
];
let changeLocale: ((locale: Locale) => void) | undefined;
const clients: QueryClient[] = [];
function LocaleControl() {
  const { setLocale } = useLocale();
  React.useEffect(() => {
    changeLocale = setLocale;
    return () => {
      changeLocale = undefined;
    };
  }, [setLocale]);
  return null;
}
function mount(
  fetch: ReturnType<typeof vi.fn>,
  open = true,
  activeTarget: AssessmentTargetContext = target,
) {
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queries);
  const client = { getMf06Assessment: fetch } as unknown as SmartSiteManagementClient;
  return render(
    <QueryClientProvider client={queries}>
      <LocaleProvider defaultLocale="vi">
        <LocaleControl />
        <Mf06AssessmentDetailDialog
          open={open}
          onClose={vi.fn()}
          target={activeTarget}
          token="synthetic-token"
          siteId={activeTarget.siteId}
          credentialId="synthetic-credential"
          client={client}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  localStorage.clear();
  changeLocale = undefined;
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe('MF06 recorded assessment presentation locale', () => {
  it('retranslates an unavailable immutable assessment without refetching or inferring unauthorized identity', async () => {
    const fetch = vi.fn().mockResolvedValue(record);
    mount(fetch);
    const dialog = await screen.findByRole('dialog', { name: 'Đánh giá đã lưu' });
    await screen.findByText('Chưa có kết quả');
    await screen.findByText('Chưa xác định được danh tính');
    expect(screen.queryByText('Không được phép')).toBeNull();
    expect(screen.getByText(record.assessmentId)).toBeDefined();
    const time = dialog.querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(record.capturedAt);
    if (!changeLocale) throw new Error('Locale setter missing');
    act(() => changeLocale?.('en'));
    await screen.findByRole('dialog', { name: 'Recorded assessment' });
    await screen.findByText('Identity Unavailable');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(time?.getAttribute('datetime')).toBe(record.capturedAt);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('localizes a safe forbidden response without disclosing private transport diagnostics', async () => {
    const fetch = vi.fn().mockRejectedValue(new ApiError('http', 'private-driver-details', 403));
    mount(fetch);
    await screen.findByText('Bạn không có quyền xem đánh giá này.');
    expect(screen.queryByText('private-driver-details')).toBeNull();
    if (!changeLocale) throw new Error('Locale setter missing');
    act(() => changeLocale?.('en'));
    await screen.findByText('You do not have permission to view this assessment.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not fetch a closed dialog while the locale changes', async () => {
    const fetch = vi.fn().mockResolvedValue(record);
    mount(fetch, false);
    if (!changeLocale) throw new Error('Locale setter missing');
    act(() => changeLocale?.('en'));
    await waitFor(() => expect(fetch).not.toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it.each(BINDING_MISMATCH_CASES)(
    'localizes $field binding mismatch in VI, retranslates to EN without refetching, and never exposes record details',
    async ({ expectedTarget, loadedRecord, viReason, enReason }) => {
      const fetch = vi.fn().mockResolvedValue(parseMf06AssessmentResponse(loadedRecord));
      mount(fetch, true, expectedTarget);
      const dialog = await screen.findByRole('dialog', { name: 'Đánh giá đã lưu' });
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(
        `Bản ghi đánh giá không khớp với ngữ cảnh yêu cầu ban đầu (${viReason}).`,
      );
      expect(alert.textContent).not.toContain(enReason);
      expect(dialog.querySelector('time')).toBeNull();
      expect(screen.queryByText(`v${loadedRecord.evaluatorVersion}`)).toBeNull();
      expect(screen.queryByText(loadedRecord.requestId)).toBeNull();
      expect(screen.queryByText('Chưa xác định được danh tính')).toBeNull();
      expect(screen.queryByText('Identity Unavailable')).toBeNull();

      if (!changeLocale) throw new Error('Locale setter missing');
      act(() => changeLocale?.('en'));
      await screen.findByRole('dialog', { name: 'Recorded assessment' });
      expect(alert.textContent).toContain(
        `Assessment record does not match expected request context (${enReason}).`,
      );
      expect(dialog.querySelector('time')).toBeNull();
      expect(screen.queryByText(`v${loadedRecord.evaluatorVersion}`)).toBeNull();
      expect(screen.queryByText(loadedRecord.requestId)).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
});
