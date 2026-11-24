import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type AttendanceDayDetailResponse,
  type AttendanceOverviewResponse,
} from '@smartsite/api-client';
import { AttendanceDetail } from './attendance-day-detail';
import type { useWorkspace } from '../workspace/workspace-context';
import { setLanguage, translate as t } from '../../i18n';
import { minutes } from '../shared/data';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
let detail: AttendanceDayDetailResponse;
let overview: AttendanceOverviewResponse;

function text() {
  return root.root
    .findAll((node) => String(node.type) === 'Text')
    .map((node) => node.children.join(''))
    .join('\n');
}
function buttons(label: string) {
  return root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount() {
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <AttendanceDetail dayId="day" onBack={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  for (
    let attempt = 0;
    !text().includes(t('attendance.timeline')) &&
    !text().includes(t('attendance.outOfScope')) &&
    attempt < 40;
    attempt++
  )
    await settle();
  await settle();
}
async function click(label: string) {
  expect(buttons(label)).toHaveLength(1);
  await act(async () => buttons(label)[0]!.props.onPress());
}

it('shows finalized absence as worked time zero without a provisional confirmation hint', async () => {
  detail.day = {
    ...detail.day,
    status: 'ABSENT',
    anomalies: [],
    regularMinutes: 0,
    provisionalMinutes: 0,
    confirmedMinutes: null,
  };
  await mount();
  expect(text()).toContain(t('attendance.worked'));
  expect(text()).not.toContain(t('attendanceDetail.provisionalHint'));
  expect(text()).toContain(minutes(0));
});

beforeEach(async () => {
  await setLanguage('vi');
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'token',
    workerId: 'worker',
    queryKey: ['mobile', 'day-detail'],
    user: {
      id: 'user',
      username: 'worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Synthetic Site',
      contractorId: 'contractor',
      contractorName: 'Synthetic Contractor',
    },
  };
  detail = {
    day: {
      id: 'day',
      workerId: 'worker',
      workerName: 'Synthetic Worker',
      workDate: '2026-11-20',
      timezone: 'Asia/Ho_Chi_Minh',
      scheduleId: 'schedule',
      shiftName: 'Synthetic Shift',
      startsAt: '2026-11-20T01:00:00Z',
      endsAt: '2026-11-20T10:00:00Z',
      status: 'NEEDS_REVIEW',
      regularMinutes: 420,
      overtimeMinutes: 0,
      provisionalMinutes: 425,
      confirmedMinutes: null,
      presence: 'OUTSIDE',
      anomalies: ['MISSING_CHECKOUT'],
      version: 1,
      canRequest: true,
      exitCount: 2,
      deductedMinutes: 15,
      allowedExitMinutes: 20,
      maxExitCount: 3,
    },
    sessions: [
      {
        id: 'session',
        workerId: 'worker',
        workerName: 'Synthetic Worker',
        effectiveInAt: '2026-11-20T01:00:00Z',
        effectiveOutAt: null,
        rawInAt: '2026-11-20T00:55:00Z',
        rawOutAt: null,
        status: 'OPEN',
        version: 3,
        workedMinutes: null,
      },
    ],
  };
  overview = {
    sessions: [],
    corrections: [],
    canRequestCorrection: true,
    canReviewCorrection: false,
    hasPendingCorrection: false,
  };
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker',
        userId: 'user',
        siteId: 'site',
        contractorId: 'contractor',
        displayName: 'Synthetic Worker',
        externalId: 'W001',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'attendanceDayDetail').mockImplementation(async () => detail);
  vi.spyOn(client, 'attendanceOverview').mockImplementation(async () => overview);
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
  await setLanguage('vi');
});

it('shows estimated hours and missing checkout clearly, with raw scans and deductions collapsed', async () => {
  await mount();
  expect(text()).toContain(minutes(425));
  expect(text()).toContain(t('attendanceDetail.provisionalHint'));
  expect(text()).toContain('08:00');
  expect(text()).toContain(t('attendanceDetail.notRecorded'));
  expect(text()).not.toContain('07:55');
  await click(t('attendanceDetail.originalSession', { index: 1 }));
  expect(text()).toContain('07:55');
  await click(t('attendanceDetail.calculationDetails'));
  expect(text()).toContain(minutes(15));
  expect(text()).toContain(minutes(20));
});

it.each(['vi', 'en'] as const)(
  'uses site time and shows the checkout date for overnight shifts in %s',
  async (language) => {
    await setLanguage(language);
    detail.day = {
      ...detail.day,
      startsAt: '2026-11-20T15:00:00Z',
      endsAt: '2026-11-20T23:00:00Z',
      status: 'CONFIRMED',
      confirmedMinutes: 480,
      anomalies: [],
    };
    detail.sessions = [
      {
        ...detail.sessions[0]!,
        effectiveInAt: detail.day.startsAt,
        effectiveOutAt: detail.day.endsAt,
        status: 'CONFIRMED',
        workedMinutes: 480,
      },
    ];
    await mount();
    expect(text()).toContain('22:00');
    expect(text()).toContain('06:00');
    expect(text()).toContain('21/11/2026');
    expect(text()).toContain(t('attendance.confirmedHours'));
    expect(text()).not.toContain(t('attendanceDetail.provisionalHint'));
    expect(text()).not.toContain('attendanceDetail.');
  },
);

it('allows the worker correction action and keeps contractor details read-only even with a stale capability', async () => {
  await mount();
  expect(buttons(t('attendance.requestSessionCorrection'))).toHaveLength(1);
  await click(t('attendance.requestSessionCorrection'));
  expect(text()).toContain(t('attendanceUi.originalTimes'));
  await act(async () => root.unmount());
  workspace.scope = { ...workspace.scope, role: 'contractor' };
  await mount();
  expect(text()).toContain('Synthetic Worker');
  expect(buttons(t('attendance.requestSessionCorrection'))).toHaveLength(0);
});

it.each(['pending', 'ignored'])('hides correction actions for %s sessions', async (state) => {
  if (state === 'pending') overview.hasPendingCorrection = true;
  else detail.sessions[0]!.status = 'IGNORED';
  await mount();
  expect(buttons(t('attendance.requestSessionCorrection'))).toHaveLength(0);
  if (state === 'pending') expect(text()).toContain(t('attendance.pendingCorrectionWarning'));
});

it('separates the proposed interval, reason and review note in correction history', async () => {
  overview.corrections = [
    {
      id: 'correction',
      attendanceSessionId: 'session',
      workerName: 'Synthetic Worker',
      proposedInAt: '2026-11-20T01:00:00Z',
      proposedOutAt: '2026-11-20T10:00:00Z',
      reason: 'Synthetic correction reason',
      status: 'REJECTED',
      reviewNote: 'Synthetic review note',
    },
  ];
  await mount();
  expect(text()).toContain(t('attendanceDetail.proposedTimes'));
  expect(text()).toContain('17:00');
  expect(text()).toContain('Synthetic correction reason');
  expect(text()).toContain(t('attendanceDetail.reviewNote'));
  expect(text()).toContain('Synthetic review note');
});

it('keeps an absent day with no shift or sessions readable without inventing exit totals', async () => {
  detail.day = {
    ...detail.day,
    status: 'ABSENT',
    shiftName: null,
    startsAt: null,
    endsAt: null,
    confirmedMinutes: 0,
    regularMinutes: 0,
    provisionalMinutes: 0,
    anomalies: [],
    exitCount: undefined,
    deductedMinutes: undefined,
  };
  detail.sessions = [];
  await mount();
  expect(text()).toContain(t('attendance.shiftNotAssigned'));
  expect(text()).toContain(t('attendance.noSessions'));
  expect(text()).not.toContain('— – —');
  expect(buttons(t('attendance.requestSessionCorrection'))).toHaveLength(0);
  await click(t('attendanceDetail.calculationDetails'));
  expect(text()).toContain(t('attendanceDetail.deducted'));
  expect(
    text()
      .split('\n')
      .filter((value) => value === '—'),
  ).toHaveLength(2);
});

it('lets the authorized contractor reject a correction with a reason while keeping the selected request', async () => {
  workspace.scope.role = 'contractor';
  overview.canReviewCorrection = true;
  overview.corrections = [
    {
      id: 'correction',
      attendanceSessionId: 'session',
      workerName: 'Synthetic Worker',
      proposedInAt: '2026-11-20T01:00:00Z',
      proposedOutAt: '2026-11-20T10:00:00Z',
      reason: 'Synthetic correction',
      status: 'PENDING',
      reviewNote: null,
      canReview: true,
    },
  ];
  const review = vi
    .spyOn(workspace.client, 'reviewAttendanceCorrection')
    .mockResolvedValue({ id: 'correction' });
  await mount();
  await click(t('attendanceReview.reviewCorrection'));
  expect(buttons(t('attendanceReview.reject'))[0]!.props.disabled).toBe(true);
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('attendanceReview.note'),
      )[0]!
      .props.onChangeText('Synthetic review reason'),
  );
  await click(t('attendanceReview.reject'));
  await settle();
  expect(review).toHaveBeenCalledWith('token', 'site', 'correction', {
    approve: false,
    reviewNote: 'Synthetic review reason',
  });
});

it('carries the selected duplicate session version and requires a reason before ignoring it', async () => {
  workspace.scope.role = 'contractor';
  detail.sessions[0]!.canIgnoreDuplicate = true;
  const ignore = vi
    .spyOn(workspace.client, 'ignoreDuplicateAttendance')
    .mockResolvedValue({ id: 'session' });
  await mount();
  await click(t('attendanceReview.ignoreDuplicate'));
  expect(buttons(t('common.confirm'))[0]!.props.disabled).toBe(true);
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('attendanceReview.reason'),
      )[0]!
      .props.onChangeText('Confirmed duplicate evidence'),
  );
  await click(t('common.confirm'));
  await settle();
  expect(ignore).toHaveBeenCalledWith('token', 'site', 'session', {
    expectedSessionVersion: 3,
    reason: 'Confirmed duplicate evidence',
  });
});

it('offers early-checkout acknowledgement only when the server capability permits it', async () => {
  workspace.scope.role = 'contractor';
  detail.canAcknowledgeEarlyCheckout = true;
  const confirm = vi
    .spyOn(workspace.client, 'confirmAttendanceDay')
    .mockResolvedValue({ id: 'day' });
  await mount();
  await click(t('attendanceReview.acknowledge'));
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('attendanceReview.reason'),
      )[0]!
      .props.onChangeText('Departure checked'),
  );
  await click(t('common.confirm'));
  await settle();
  expect(confirm).toHaveBeenCalledWith('token', 'site', 'day', {
    expectedVersion: 1,
    reviewNote: 'Departure checked',
  });
});

it('opens the absence review from an authorized day and preserves the day/roll-call versions', async () => {
  workspace.scope.role = 'contractor';
  detail.sessions = [];
  detail.gateAbsenceReview = {
    canConfirm: true,
    gateEventCount: 0,
    attendanceEventCount: 0,
    sessionCount: 0,
    status: 'PENDING',
    teamAttendance: {
      version: 4,
      status: 'PRESENT',
      recordedBy: 'leader',
      recordedAt: '2026-11-20T10:05:00Z',
    },
  };
  const confirm = vi
    .spyOn(workspace.client, 'confirmAttendanceAbsence')
    .mockResolvedValue({ id: 'day' });
  await mount();
  await click(t('attendanceReview.confirmAbsence'));
  expect(buttons(t('common.confirm'))[0]!.props.disabled).toBe(true);
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('attendanceReview.reason'),
      )[0]!
      .props.onChangeText('Verified absent from the Site'),
  );
  await click(t('common.confirm'));
  await settle();
  expect(confirm).toHaveBeenCalledWith('token', 'site', 'day', {
    requestId: expect.any(String),
    expectedVersion: 1,
    expectedTeamAttendanceVersion: 4,
    reason: 'Verified absent from the Site',
  });
});
it('does not offer absence confirmation without the Backend capability', async () => {
  workspace.scope.role = 'contractor';
  detail.gateAbsenceReview = {
    canConfirm: false,
    gateEventCount: 1,
    attendanceEventCount: 0,
    sessionCount: 0,
    status: 'CONFLICTED',
  };
  await mount();
  expect(buttons(t('attendanceReview.confirmAbsence'))).toHaveLength(0);
});
it('opens the missing-roll-call review from an authorized day and preserves the day and evidence snapshot', async () => {
  workspace.scope.role = 'contractor';
  detail.sessions = [];
  detail.zoneAttendanceReview = {
    canConfirm: true,
    status: 'PENDING',
    evidenceHash: 'a'.repeat(64),
    gateInCount: 1,
    gateOutCount: 1,
    sessionCount: 1,
    regularMinutes: 420,
    overtimeMinutes: 0,
    teamAttendanceStatus: 'NOT_YET',
  };
  const confirm = vi
    .spyOn(workspace.client, 'confirmAttendanceZoneHours')
    .mockResolvedValue({ id: 'day' });
  await mount();
  await click(t('attendanceReview.confirmZoneHours'));
  expect(buttons(t('common.confirm'))[0]!.props.disabled).toBe(true);
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('attendanceReview.reason'),
      )[0]!
      .props.onChangeText('Verified absent from the Site'),
  );
  await click(t('common.confirm'));
  await settle();
  expect(confirm).toHaveBeenCalledWith('token', 'site', 'day', {
    requestId: expect.any(String),
    expectedVersion: 1,
    evidenceHash: 'a'.repeat(64),
    reason: 'Verified absent from the Site',
  });
});
it('does not offer hours confirmation without the Backend capability', async () => {
  workspace.scope.role = 'contractor';
  detail.zoneAttendanceReview = {
    canConfirm: false,
    status: 'CONFLICTED',
    evidenceHash: 'a'.repeat(64),
    gateInCount: 1,
    gateOutCount: 0,
    sessionCount: 1,
    regularMinutes: 0,
    overtimeMinutes: 0,
    teamAttendanceStatus: 'NOT_YET',
  };
  await mount();
  expect(buttons(t('attendanceReview.confirmZoneHours'))).toHaveLength(0);
});
it.each(['worker', 'contractor'] as const)(
  'hides out-of-scope day content and does not fetch corrections for %s',
  async (role) => {
    workspace.scope = { ...workspace.scope, role };
    detail.day = { ...detail.day, workerId: 'outside-scope', workerName: 'Private Outside Worker' };
    await mount();
    expect(text()).toContain(t('attendance.outOfScope'));
    expect(text()).not.toContain('Private Outside Worker');
    expect(workspace.client.attendanceOverview).not.toHaveBeenCalled();
  },
);
