import { expect, test, type Page } from '@playwright/test';

async function mockTeamApi(
  page: Page,
  role: 'CONTRACTOR_REPRESENTATIVE' | 'WORKER',
  language: 'en' | 'vi',
) {
  await page.addInitScript((lang) => localStorage.setItem('smartsite-language', lang), language);
  await page.clock.setFixedTime(new Date('2030-01-01T04:00:00Z'));
  const user = {
    id: 'synthetic-user',
    username: 'qa.team',
    displayName: 'Synthetic User',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [
      {
        role,
        siteId: 'site',
        ...(role === 'CONTRACTOR_REPRESENTATIVE' ? { contractorId: 'contractor' } : {}),
      },
    ],
  };
  const site = {
    id: 'site',
    name: 'Synthetic Site',
    code: 'QA',
    createdAt: '2029-12-01T00:00:00Z',
  };
  const scope = {
    siteId: site.id,
    siteName: site.name,
    siteCode: site.code,
    contractorId: 'contractor',
    contractorName: 'Synthetic Contractor',
  };
  let team = {
    id: 'team',
    siteId: site.id,
    contractorId: 'contractor',
    name: 'Painting team',
    description: 'Synthetic team for browser checks',
    isActive: true,
    version: 1,
    memberCount: 2,
    leaderWorkerId: role === 'WORKER' ? 'worker-a' : (null as string | null),
  };
  let members = ['a', 'b'].map((id) => ({
    scheduleId: `schedule-${id}`,
    workerId: `worker-${id}`,
    membershipId: `membership-${id}`,
    displayName: `Worker ${id.toUpperCase()}`,
    status: 'NOT_YET' as 'NOT_YET' | 'PRESENT' | 'ABSENT',
    version: 0,
    updatedAt: null as string | null,
    gateCheck: 'GATE_ONLY' as 'GATE_ONLY' | 'MATCHED',
    locked: false,
  }));
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const zoneAttendance = () => ({
    own: members[0],
    teamId: 'team',
    teamName: team.name,
    zoneId: 'zone',
    zoneName: 'Zone A',
    canManage: true,
    canSubmit: true,
    members,
  });
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace('/api/v1', ''),
      method = request.method();
    const headers = {
      'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:5181',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type,authorization',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    let body: unknown = { items: [], total: 0, unreadCount: 0 };
    if (path === '/auth/refresh')
      body = {
        accessToken: 'synthetic-browser-token',
        user,
        tokenType: 'Bearer',
        accessTokenExpiresAt: '2099-01-01T00:00:00Z',
        refreshTokenExpiresAt: '2099-01-02T00:00:00Z',
      };
    else if (path === '/auth/me') body = user;
    else if (path === '/sites') body = { items: [site], total: 1 };
    else if (path === '/sites/site') body = site;
    else if (path === '/contractor-dashboard/scopes') body = { items: [scope] };
    else if (path.endsWith('/dashboard'))
      body = { scope, workerCount: 2, teamCount: 1, unassignedWorkerCount: 0 };
    else if (path.endsWith('/teams/team/leader') && method === 'PUT') {
      const input = request.postDataJSON();
      writes.push({ path, body: input });
      team = { ...team, leaderWorkerId: input.workerId, version: team.version + 1 };
      body = team;
    } else if (path.endsWith('/teams/team')) body = team;
    else if (path.endsWith('/teams')) body = { items: [team], total: 1 };
    else if (path.endsWith('/team-workers'))
      body = {
        items: members.map((m) => ({ ...m, teamId: team.id, teamName: team.name })),
        total: 2,
      };
    else if (path.endsWith('/my-team'))
      body = { ...members[0], teamId: team.id, teamName: team.name, isLeader: true, zones: [] };
    else if (path.endsWith('/shifts'))
      body = {
        items: [
          {
            id: 'shift',
            siteId: site.id,
            name: 'Morning shift',
            startsAt: '2030-01-01T01:00:00Z',
            endsAt: '2030-01-01T10:00:00Z',
            timezone: 'Asia/Ho_Chi_Minh',
            isActive: true,
          },
        ],
        total: 1,
      };
    else if (path.endsWith('/schedule-versions'))
      body = {
        items: [
          {
            id: 'version',
            siteId: site.id,
            version: 1,
            effectiveFrom: '2029-01-01T00:00:00Z',
            effectiveUntil: null,
            createdAt: site.createdAt,
          },
        ],
        total: 1,
      };
    else if (path.endsWith('/teams/team/attendance'))
      body = {
        teamId: team.id,
        teamName: team.name,
        workDate: '2030-01-01',
        total: 2,
        present: 0,
        absent: 0,
        pending: 2,
        matched: 0,
        items: members.map((member) => ({ ...member, zoneName: 'Zone A', dayId: null })),
      };
    else if (path.endsWith('/worker-schedules'))
      body = {
        items: [
          {
            id: 'schedule-a',
            siteId: site.id,
            workerId: 'worker-a',
            shiftId: 'shift',
            scheduleVersionId: 'version',
            workDate: '2030-01-01',
            isActive: true,
            createdAt: site.createdAt,
          },
        ],
        total: 1,
      };
    else if (path.endsWith('/shift-requests'))
      body = { items: [], total: 0, pendingCount: 0, incomingCount: 0, pendingScheduleIds: [] };
    else if (path.endsWith('/attendance-days'))
      body = { items: [], total: 0, requests: [], canReview: false, canRequest: true };
    else if (path.endsWith('/zone-attendance')) {
      if (method === 'PUT') {
        const input = request.postDataJSON();
        writes.push({ path, body: input });
        members = members.map((member) => {
          const entry = input.entries.find(
            (item: { scheduleId: string }) => item.scheduleId === member.scheduleId,
          );
          return entry
            ? {
                ...member,
                status: entry.status,
                version: member.version + 1,
                updatedAt: '2030-01-01T04:00:00Z',
                gateCheck: entry.status === 'PRESENT' ? 'MATCHED' : 'GATE_ONLY',
              }
            : member;
        });
      }
      body = zoneAttendance();
    } else if (method !== 'GET' && path !== '/auth/refresh')
      return route.fulfill({
        status: 405,
        headers,
        json: { message: 'Unexpected synthetic write' },
      });
    return route.fulfill({ headers, json: body });
  });
  return writes;
}

for (const mobile of [false, true]) {
  test(`management timesheet opens on today and keeps historical hours explicit on ${mobile ? 'mobile viewport' : 'desktop'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await mockTeamApi(page, 'CONTRACTOR_REPRESENTATIVE', 'vi');
    await page.clock.setFixedTime(new Date('2029-12-31T18:30:00Z'));
    const requests: Array<{ path: string; from: string | null; to: string | null }> = [];
    await page.route('**/api/v1/sites/site/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        path = url.pathname;
      if (request.method() !== 'GET') return route.fallback();
      let body: unknown;
      const metrics = {
        regularMinutes: 0,
        overtimeMinutes: 0,
        totalMinutes: 0,
        provisionalMinutes: url.searchParams.get('fromDate') === '2029-12-30' ? 87 : 0,
        confirmedDays: 1,
        requiredDays: 0,
        presentDays: 0,
        absentDays: 0,
        reviewDays: 0,
        attendanceRate: null,
        isProvisional: false,
      };
      if (path.endsWith('/attendance-summary') || path.endsWith('/attendance-workers')) {
        requests.push({
          path,
          from: url.searchParams.get('fromDate'),
          to: url.searchParams.get('toDate'),
        });
        body = path.endsWith('/attendance-summary')
          ? {
              ...metrics,
              totalWorkers: 1,
              absentTodayCount: 0,
              overtimeWorkerCount: 0,
              workingMinutesChangePercent: null,
              previousPeriod: { fromDate: '2029-12-31', toDate: '2029-12-31', totalMinutes: 0 },
            }
          : {
              items: [
                {
                  ...metrics,
                  workerId: 'worker-a',
                  workerCode: 'WTEST',
                  workerName: 'Worker A',
                  contractorId: 'contractor',
                  todayStatus: 'APPROVED_LEAVE',
                  todayFirstCheckInAt: null,
                  todayLastCheckOutAt: null,
                },
              ],
              total: 1,
            };
      } else if (path.endsWith('/attendance'))
        body = {
          sessions: [],
          corrections: [],
          canRequestCorrection: false,
          canReviewCorrection: true,
        };
      else return route.fallback();
      return route.fulfill({
        json: body,
        headers: {
          'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:5173',
          'access-control-allow-credentials': 'true',
        },
      });
    });
    await page.goto('/access?tab=attendance');
    await expect(
      page.getByRole('table').getByText('Nghỉ đã được duyệt', { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel('Từ', { exact: true })).toHaveValue('2030-01-01');
    await expect(page.getByLabel('Đến', { exact: true })).toHaveValue('2030-01-01');
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests.every((r) => r.from === '2030-01-01' && r.to === '2030-01-01')).toBe(true);
    await page.screenshot({ path: info.outputPath('attendance-today.png'), fullPage: true });
    await page.getByLabel('Từ', { exact: true }).fill('2029-12-30');
    await expect(page.getByText(/1 giờ 27 phút/).first()).toBeVisible();
    await expect(
      page.getByText(/Giờ công và tỷ lệ tham dự tính trong khoảng: 2029-12-30/),
    ).toBeVisible();
    await page.getByRole('button', { name: 'hôm nay', exact: true }).click();
    await expect(page.getByLabel('Từ', { exact: true })).toHaveValue('2030-01-01');
    await expect(page.getByText(/1 giờ 27 phút/)).toHaveCount(0);
  });
  test(`approved leave replaces scheduled status and blocks swap on ${mobile ? 'mobile viewport' : 'desktop'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await mockTeamApi(page, 'WORKER', 'vi');
    await page.clock.setFixedTime(new Date('2030-01-01T00:00:00Z'));
    await page.route('**/api/v1/sites/site/worker-schedules?**', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({
        headers: {
          'access-control-allow-origin':
            route.request().headers().origin ?? 'http://127.0.0.1:5173',
          'access-control-allow-credentials': 'true',
        },
        json: {
          items: [
            {
              id: 'schedule-a',
              siteId: 'site',
              workerId: 'worker-a',
              shiftId: 'shift',
              scheduleVersionId: 'version',
              workDate: '2030-01-01',
              isActive: false,
              approvedFullShiftLeave: true,
              createdAt: '2030-01-01T00:00Z',
            },
          ],
          total: 1,
        },
      });
    });
    await page.goto('/workforce');
    await expect(page.getByText('Nghỉ phép', { exact: true })).toBeVisible();
    await expect(page.getByText('Đã duyệt', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Điểm danh khu vực:/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hoán đổi ca', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('approved-leave-calendar.png'), fullPage: true });
    await page.getByRole('button', { name: 'Danh sách', exact: true }).click();
    await expect(page.getByText('Nghỉ phép', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Điểm danh khu vực:/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Hoán đổi ca', exact: true })).toHaveCount(0);
    await page.route('**/api/v1/sites/site/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') return route.fallback();
      let body: unknown;
      if (path.endsWith('/attendance'))
        body = { sessions: [], corrections: [], canReviewCorrection: false };
      else if (path.endsWith('/my-requests'))
        body = { items: [], total: 0, serverTime: '2030-01-01T04:00Z', leaveAvailableAt: null };
      else if (path.endsWith('/attendance-time-requests'))
        body =
          new URL(request.url()).searchParams.get('kind') === 'LEAVE'
            ? {
                items: [
                  {
                    id: 'approved-leave',
                    kind: 'LEAVE',
                    scheduleId: 'schedule-a',
                    workerId: 'worker-a',
                    workerName: 'Worker A',
                    startsAt: '2030-01-01T01:00Z',
                    endsAt: '2030-01-01T10:00Z',
                    createdAt: '2029-12-29T00:00Z',
                    requestedByUserId: 'synthetic-user',
                    reason: 'Synthetic approved leave',
                    status: 'APPROVED',
                    reviewNote: null,
                    noticeType: 'PLANNED',
                  },
                ],
                total: 1,
              }
            : { items: [], total: 0 };
      else return route.fallback();
      return route.fulfill({
        json: body,
        headers: {
          'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:5173',
          'access-control-allow-credentials': 'true',
        },
      });
    });
    await page.goto('/access?tab=attendance&subtab=requests');
    await page.locator('#queue-kind').selectOption('LEAVE');
    const approvedRow = page
      .locator('div.px-6.py-4')
      .filter({ hasText: 'Synthetic approved leave' });
    await expect(approvedRow.getByText('Đã duyệt', { exact: true })).toBeVisible();
    await expect(approvedRow.getByText('Chờ duyệt', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('approved-leave-request.png'), fullPage: true });
  });
  test(`representative confirms hours with missing leader roll call on ${mobile ? 'mobile viewport' : 'desktop'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await mockTeamApi(page, 'CONTRACTOR_REPRESENTATIVE', 'en');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const day = {
      id: 'missing-roll-call-day',
      workerId: 'worker-a',
      workerName: 'Worker A',
      workDate: '2029-12-31',
      timezone: 'Asia/Ho_Chi_Minh',
      scheduleId: 'schedule-a',
      shiftName: 'Morning shift',
      startsAt: '2029-12-31T01:00:00Z',
      endsAt: '2029-12-31T02:00:00Z',
      status: 'NEEDS_REVIEW',
      regularMinutes: 60,
      overtimeMinutes: 0,
      provisionalMinutes: 60,
      confirmedMinutes: null,
      presence: 'OUTSIDE',
      anomalies: ['ZONE_ATTENDANCE_PENDING'],
      version: 3,
      canRequest: false,
    };
    let applied = false;
    const commands: Record<string, unknown>[] = [];
    const currentDay = () => ({
      ...day,
      ...(applied ? { status: 'CONFIRMED', confirmedMinutes: 60, anomalies: [], version: 4 } : {}),
    });
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname.replace('/api/v1', '');
      let body: unknown;
      if (request.method() === 'OPTIONS') return route.fallback();
      if (path === '/me/notifications')
        body = {
          items: [
            {
              id: 'zone-notice',
              event: 'ZONE_REVIEW_REQUIRED',
              siteId: 'site',
              siteName: 'Synthetic Site',
              title: 'ZONE REVIEW REQUIRED',
              message:
                'Worker Worker A (WTEST) has complete Gate IN/OUT on 2029-12-31, but no team leader roll call was recorded. Review recorded hours before confirming attendance.',
              createdAt: '2030-01-01T03:00:00Z',
              readAt: null,
              target: { siteId: 'site', dayId: day.id, tab: 'attendance' },
            },
          ],
          total: 1,
          unreadCount: 1,
        };
      else if (path === '/me/notifications/zone-notice/read') body = {};
      else if (path === `/sites/site/attendance-days/${day.id}/confirm-zone-hours`) {
        commands.push(request.postDataJSON());
        applied = true;
        body = { id: day.id };
      } else if (path === `/sites/site/attendance-days/${day.id}`)
        body = {
          day: currentDay(),
          sessions: [
            {
              id: 'session',
              workerId: day.workerId,
              workerName: day.workerName,
              effectiveInAt: day.startsAt,
              effectiveOutAt: day.endsAt,
              rawInAt: day.startsAt,
              rawOutAt: day.endsAt,
              status: 'MATCHED',
              version: 1,
              workedMinutes: 60,
              dayId: day.id,
            },
          ],
          zoneAttendanceReview: {
            canConfirm: !applied,
            status: applied ? 'CONFIRMED' : 'PENDING',
            evidenceHash: 'a'.repeat(64),
            gateInCount: 1,
            gateOutCount: 1,
            sessionCount: 1,
            regularMinutes: 60,
            overtimeMinutes: 0,
            teamAttendanceStatus: 'NOT_YET',
            ...(applied
              ? {
                  decision: {
                    reviewedBy: 'synthetic-user',
                    reviewedByName: 'Synthetic Representative',
                    reviewedAt: '2030-01-01T04:00:00Z',
                    reason: 'Gate hours checked; leader forgot roll call',
                  },
                }
              : {}),
          },
        };
      else if (path === '/sites/site/attendance-days')
        body = {
          items: [currentDay()],
          total: 1,
          requests: [],
          canReview: true,
          canRequest: false,
        };
      else if (path === '/sites/site/attendance')
        body = {
          canRequestCorrection: false,
          canReviewCorrection: true,
          sessions: [],
          corrections: [],
        };
      else if (path === '/sites/site/attendance-summary')
        body = {
          confirmedDays: applied ? 1 : 0,
          absentDays: 0,
          reviewDays: applied ? 0 : 1,
          regularMinutes: applied ? 60 : 0,
          overtimeMinutes: 0,
          totalMinutes: applied ? 60 : 0,
          provisionalMinutes: applied ? 0 : 60,
          totalWorkers: 1,
          absentTodayCount: 0,
          overtimeWorkerCount: 0,
          requiredDays: 1,
          presentDays: applied ? 1 : 0,
          attendanceRate: applied ? 100 : 0,
          isProvisional: !applied,
          previousPeriod: { fromDate: '2029-12-19', toDate: '2029-12-25', totalMinutes: 0 },
          workingMinutesChangePercent: null,
        };
      else if (path === '/sites/site/attendance-timesheets')
        body = {
          items: applied
            ? [
                {
                  workerId: day.workerId,
                  workerName: day.workerName,
                  confirmedDays: 1,
                  regularMinutes: 60,
                  overtimeMinutes: 0,
                  totalMinutes: 60,
                },
              ]
            : [],
        };
      else return route.fallback();
      return route.fulfill({
        json: body,
        headers: {
          'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:5181',
          'access-control-allow-credentials': 'true',
        },
      });
    });
    await page.goto('/contractor-teams');
    await page.getByRole('button', { name: /Notifications/i }).click();
    await page
      .getByText('Missing team leader roll call — hours review required', { exact: true })
      .click();
    await expect(page).toHaveURL(/dayId=missing-roll-call-day/);
    const card = page.getByRole('region', { name: 'Review hours: missing team leader roll call' });
    await expect(card.getByText('Gate IN: 1 · Gate OUT: 1 · completed sessions: 1')).toBeVisible();
    await expect(card.getByText(/Not yet/)).toBeVisible();
    await card
      .getByLabel('Reason for confirming working hours')
      .fill('Gate hours checked; leader forgot roll call');
    await page.screenshot({ path: info.outputPath('zone-hours-before.png'), fullPage: true });
    await card.getByRole('button', { name: 'Confirm working hours', exact: true }).click();
    await expect(
      card.getByText(
        'Working hours confirmed by the Contractor Representative. Original roll call retained.',
      ),
    ).toBeVisible();
    await expect(card.getByText(/Not yet/)).toBeVisible();
    await expect(card.getByText(/Synthetic Representative/)).toBeVisible();
    await expect(page.getByText('Awaiting confirmation', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('zone-hours-after.png'), fullPage: true });
    expect(commands).toEqual([
      expect.objectContaining({
        requestId: expect.any(String),
        expectedVersion: 3,
        evidenceHash: 'a'.repeat(64),
        reason: 'Gate hours checked; leader forgot roll call',
      }),
    ]);
    expect(errors).toEqual([]);
  });

  test(`representative follows an absence notice and confirms zero hours on ${mobile ? 'mobile viewport' : 'desktop'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    await mockTeamApi(page, 'CONTRACTOR_REPRESENTATIVE', 'en');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const day = {
      id: 'missing-gate-day',
      workerId: 'worker-a',
      workerName: 'Worker A',
      workDate: '2029-12-31',
      timezone: 'Asia/Ho_Chi_Minh',
      scheduleId: 'schedule-a',
      shiftName: 'Morning shift',
      startsAt: '2029-12-31T01:00:00Z',
      endsAt: '2029-12-31T10:00:00Z',
      status: 'NEEDS_REVIEW',
      regularMinutes: 0,
      overtimeMinutes: 0,
      provisionalMinutes: 0,
      confirmedMinutes: null,
      presence: 'OUTSIDE',
      anomalies: ['ZONE_GATE_MISSING'],
      version: 3,
      canRequest: false,
    };
    let applied = false;
    const commands: Record<string, unknown>[] = [];
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request(),
        path = new URL(request.url()).pathname.replace('/api/v1', '');
      let body: unknown;
      if (request.method() === 'OPTIONS') return route.fallback();
      if (path === '/me/notifications')
        body = {
          items: [
            {
              id: 'notice',
              event: 'ABSENCE_REVIEW_REQUIRED',
              siteId: 'site',
              siteName: 'Synthetic Site',
              title: 'Present without Gate evidence — review required',
              message:
                'Worker Worker A (WTEST) was marked present on 2029-12-31, but no Gate IN/OUT was recorded. Review attendance before confirming absence.',
              createdAt: '2030-01-01T03:00:00Z',
              readAt: null,
              target: { siteId: 'site', dayId: day.id, tab: 'attendance' },
            },
          ],
          total: 1,
          unreadCount: 1,
        };
      else if (path === '/me/notifications/notice/read') body = {};
      else if (path === `/sites/site/attendance-days/${day.id}/confirm-absence`) {
        commands.push(request.postDataJSON());
        applied = true;
        body = { id: day.id };
      } else if (path === `/sites/site/attendance-days/${day.id}`)
        body = {
          day: { ...day, ...(applied ? { status: 'ABSENT', anomalies: [], version: 4 } : {}) },
          sessions: [],
          gateAbsenceReview: {
            canConfirm: !applied,
            gateEventCount: 0,
            attendanceEventCount: 0,
            sessionCount: 0,
            status: applied ? 'CONFIRMED_ABSENT' : 'PENDING',
            teamAttendance: {
              version: 2,
              status: 'PRESENT',
              recordedBy: 'leader',
              recordedAt: '2029-12-31T02:00:00Z',
            },
            ...(applied
              ? {
                  decision: {
                    reviewedBy: 'synthetic-user',
                    reviewedAt: '2030-01-01T04:00:00Z',
                    reason: 'Checked Gate records: Worker was absent',
                  },
                }
              : {}),
          },
        };
      else if (path === '/sites/site/attendance-days')
        body = {
          items: [{ ...day, ...(applied ? { status: 'ABSENT', anomalies: [], version: 4 } : {}) }],
          total: 1,
          requests: [],
          canReview: true,
          canRequest: false,
        };
      else if (path === '/sites/site/attendance')
        body = {
          canRequestCorrection: false,
          canReviewCorrection: true,
          sessions: [],
          corrections: [],
        };
      else if (path === '/sites/site/attendance-summary')
        body = {
          confirmedDays: 0,
          absentDays: 0,
          reviewDays: 1,
          regularMinutes: 0,
          overtimeMinutes: 0,
          totalMinutes: 0,
          provisionalMinutes: 0,
          totalWorkers: 1,
          absentTodayCount: 0,
          overtimeWorkerCount: 0,
          requiredDays: 1,
          presentDays: 0,
          attendanceRate: 0,
          isProvisional: true,
          previousPeriod: { fromDate: '2029-12-19', toDate: '2029-12-25', totalMinutes: 0 },
          workingMinutesChangePercent: null,
        };
      else return route.fallback();
      return route.fulfill({
        json: body,
        headers: {
          'access-control-allow-origin': request.headers().origin ?? 'http://127.0.0.1:5181',
          'access-control-allow-credentials': 'true',
        },
      });
    });
    await page.goto('/contractor-teams');
    await page.getByRole('button', { name: /Notifications/i }).click();
    await page
      .getByText('Present without Gate evidence — review required', { exact: true })
      .click();
    await expect(page).toHaveURL(/dayId=missing-gate-day/);
    const card = page.getByRole('region', { name: 'Review: Present without Gate IN/OUT' });
    await expect(card).toBeVisible();
    await expect(
      card.getByText('Gate passages: 0 · attendance events: 0 · sessions: 0'),
    ).toBeVisible();
    await card
      .getByLabel('Reason for confirming absence')
      .fill('Checked Gate records: Worker was absent');
    await page.screenshot({ path: info.outputPath('absence-before.png'), fullPage: true });
    await card.getByRole('button', { name: 'Confirm absent — 0 hours' }).click();
    await expect(
      card.getByText('Absence confirmed — 0 hours. Original roll call retained.'),
    ).toBeVisible();
    await expect(page.getByText('Awaiting confirmation', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('absence-after.png'), fullPage: true });
    expect(commands).toEqual([
      expect.objectContaining({
        expectedVersion: 3,
        expectedTeamAttendanceVersion: 2,
        reason: 'Checked Gate records: Worker was absent',
        requestId: expect.any(String),
      }),
    ]);
    expect(errors).toEqual([]);
  });
  const language = mobile ? 'vi' : 'en';
  test(`representative assigns a team leader on ${mobile ? 'mobile viewport (vi)' : 'desktop (en)'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = await mockTeamApi(page, 'CONTRACTOR_REPRESENTATIVE', language);
    await page.goto('/contractor-teams');
    await page
      .getByRole('button', { name: mobile ? 'Nhóm trưởng' : 'Team leader', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(mobile ? 'Chọn nhóm trưởng' : 'Select team leader')
      .selectOption('worker-a');
    await page.screenshot({ path: info.outputPath('team-leader.png'), fullPage: true });
    await dialog
      .getByRole('button', { name: mobile ? 'Lưu nhóm trưởng' : 'Save team leader', exact: true })
      .click();
    await expect(
      dialog.getByText(mobile ? 'Nhóm trưởng hiện tại: Worker A' : 'Current leader: Worker A', {
        exact: true,
      }),
    ).toBeVisible();
    expect(writes).toEqual([
      {
        path: '/sites/site/contractors/contractor/teams/team/leader',
        body: { workerId: 'worker-a', expectedVersion: 1 },
      },
    ]);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole('button', {
        name: mobile ? 'Xem điểm danh khu vực' : 'View Zone attendance',
        exact: true,
      })
      .click();
    const report = page.getByRole('dialog');
    await expect(report.getByText('Worker B', { exact: true })).toBeVisible();
    await expect(
      report.getByRole('button', { name: mobile ? 'Có mặt' : 'Present', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath('contractor-attendance-report.png'),
      fullPage: true,
    });
    expect(writes).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test(`leader records selected Zone attendance on ${mobile ? 'mobile viewport (vi)' : 'desktop (en)'}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const writes = await mockTeamApi(page, 'WORKER', language);
    await page.goto('/workforce');
    await page
      .getByRole('button', { name: mobile ? /^Điểm danh khu vực:/ : /^Zone attendance:/ })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByRole('group', { name: 'Worker A', exact: true })
      .getByRole('button', { name: mobile ? 'Có mặt' : 'Present', exact: true })
      .click();
    await page.screenshot({ path: info.outputPath('zone-attendance.png'), fullPage: true });
    await dialog
      .getByRole('button', { name: mobile ? 'Lưu điểm danh' : 'Save attendance', exact: true })
      .click();
    await expect(
      dialog.getByText(mobile ? /Đã lưu điểm danh khu vực/ : /Zone attendance saved/),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({
      teamId: 'team',
      zoneId: 'zone',
      requestId: expect.any(String),
      entries: [
        {
          scheduleId: 'schedule-a',
          expectedMembershipId: 'membership-a',
          expectedVersion: 0,
          status: 'PRESENT',
        },
      ],
    });
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
