# Attendance reporting API (MF03/MF07)

These two authenticated, read-only endpoints are additive. Existing attendance
routes remain supported; no table, migration or AI contract change is introduced.
Canonical types: `contracts/src/attendance-reports-api.ts`. Shared client:
`SmartSiteManagementClient.attendanceSummary` and `attendanceWorkers`.

## Requests

`GET /api/v1/sites/:siteId/attendance-summary`

`GET /api/v1/sites/:siteId/attendance-workers`

Both require `fromDate` and `toDate`, inclusive `YYYY-MM-DD` work dates, ordered
and at most 366 days apart including endpoints. Optional filters:

| Parameter      | Meaning                                                                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `timezone`     | Valid IANA timezone used to determine **today**, default `Asia/Ho_Chi_Minh`. Shift windows still use each configured shift timezone.            |
| `contractorId` | UUID; must be within caller scope.                                                                                                              |
| `workerId`     | UUID; must identify an active Worker currently visible to the caller.                                                                           |
| `shiftId`      | UUID belonging to the requested Site. Filters schedules and matching attendance; workers without that shift in the range or today are excluded. |
| `search`       | Up to 160 characters, literal case-insensitive substring of worker name/code.                                                                   |
| `todayStatus`  | `PRESENT`, `ABSENT`, `NEEDS_REVIEW`, `SCHEDULED`, `NOT_ARRIVED`, `OFF`, `APPROVED_LEAVE`, `UNAVAILABLE`.                                        |

Workers endpoint additionally accepts `offset` (default 0), `limit` (default 20,
maximum 100), and `includeDaily` (`true`/`false`, default false). Unknown query
fields, invalid dates/UUIDs/enums, invalid timezone and oversized/reversed ranges
are rejected with 400. Body parameters cannot select an actor or a clock.

Representative reads combine persisted active account, Site role, Contractor
assignment and current active Contractor participation. Worker reads include
only their active linked Worker. Global Admin and Site-scoped Manager/Security
retain existing attendance staff read scope. No Safety Officer read role is added.
Missing/revoked permissions produce 403; unavailable permission data fails the
request, never a successful empty report. The report roster includes active
Workers only. Valid empty scopes return zero totals/items. Totals and pagination
use one repeatable-read database snapshot. Ordering is Worker display name then ID.

## Examples and field semantics

```ts
const summary = await client.attendanceSummary(token, siteId, {
  fromDate: '2026-10-12',
  toDate: '2026-10-18',
  timezone: 'Asia/Ho_Chi_Minh',
});
const page = await client.attendanceWorkers(token, siteId, {
  fromDate: '2026-10-12',
  toDate: '2026-10-18',
  offset: 0,
  limit: 20,
});
const worker = await client.attendanceWorkers(token, siteId, {
  fromDate: '2026-10-12',
  toDate: '2026-10-18',
  workerId,
  includeDaily: true,
});
```

All responses include `siteId`, `fromDate`, `toDate`, `timezone`, `today` and UTC
RFC 3339 `asOf`. Today indicators are independent of the selected historical
range. Summary fields include `totalWorkers`, `absentTodayCount`,
`overtimeWorkerCount`, the metrics below, `previousPeriod` and
`workingMinutesChangePercent`. There is deliberately no Present Today card field.
Previous period is the immediately preceding interval of equal calendar length;
it uses the same currently authorized roster/filters. Percentage change is null
when previous confirmed total is zero, not a fabricated increase.

Workers response is `{ ..., items, total, offset, limit }`. Each row adds
`workerId`, `workerCode`, `workerName`, `contractorId`, `todayStatus`,
`todayFirstCheckInAt`, `todayLastCheckOutAt` and these metrics:

| Field                                               | Definition                                                                                                                                                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `regularMinutes`, `overtimeMinutes`, `totalMinutes` | Stored payroll minutes on **CONFIRMED** days only. OT is Backend-approved OT, never inferred from checkout minus shift end.                                                                                                                      |
| `provisionalMinutes`                                | Estimated total minutes on unconfirmed days, separate from confirmed hours.                                                                                                                                                                      |
| `confirmedDays`                                     | Confirmed attendance records; includes approved full leave at zero hours, so not a days-present count.                                                                                                                                           |
| `requiredDays`                                      | Distinct work dates with active valid required shifts, all non-leave shift windows ended by `asOf`. Excludes cancelled schedules, days off, full approved leave and unfinished workdays.                                                         |
| `presentDays`                                       | Required days with a valid effective check-in linked to the assigned schedule. Accepted corrections can restore missing raw IN. Ignored duplicate sessions do not count. Late/early attendance still counts. Multiple shifts count once per day. |
| `absentDays`                                        | Days classified ABSENT in the selected range; not inferred from absence of a response row.                                                                                                                                                       |
| `reviewDays`                                        | Days with review/unavailable configuration, or overdue evidence not yet reconciled.                                                                                                                                                              |
| `attendanceRate`                                    | `round(presentDays / requiredDays * 100, 2)`, null when denominator is zero.                                                                                                                                                                     |
| `isProvisional`                                     | True when any selected day needs review. Missing/unresolved IN contributes zero until resolved; do not present this provisional percentage as a final payroll determination.                                                                     |

Example: 5 scheduled days, 1 full approved leave day, 3 days with check-in and
1 ABSENT day => `requiredDays=4`, `presentDays=3`, `attendanceRate=75`.

`PRESENT` means a valid effective check-in for that work date, including people
already checked out. It does not assert current physical presence. Day-level
`NEEDS_REVIEW` takes precedence over PRESENT. `ABSENT` requires a completed
obligation and persisted absence state. Missing configuration is UNAVAILABLE;
no assigned shift is OFF; full approved leave is APPROVED_LEAVE. Before all
required shifts end, lack of check-in is SCHEDULED or NOT_ARRIVED, never ABSENT.

With `includeDaily=true`, each row includes `daily` for every date in the range:
`workDate`, `attendanceDayId`, `status`, `shifts` (actual dated windows/timezones),
`firstCheckInAt`, `lastCheckOutAt`, minute fields, `hoursStatus` and `anomalies`.
Use this for daily bars, chart totals, summary and record links. A single first-IN
and last-OUT is a display summary, not continuous worked time: detailed intervals
remain at `GET /attendance-days/:id`. Preserve days off as OFF, not ABSENT.
Rows contain no daily array unless requested.

Existing `attendance-days`, `attendance-days/:id`, `attendance-timesheets` and
attendance review/correction endpoints remain available for the detailed workflow.
This report API has no write side effects and does not trigger reconciliation.
Reconciliation runs at startup/every minute; an overdue unmaterialized workday
remains NEEDS_REVIEW/provisional until processed.

The Web attendance page separates Timesheet from Requests & Approvals. Correction
requests appear in Pending Review and Request History tabs under Requests &
Approvals. The header review shortcut and reminder appear only when
the authorized reviewer has pending corrections. Recorded/proposed intervals and
approve/reject controls remain in the request cards; full session tables are shown
in individual worker details. Additional day/timesheet controls are available from
worker details and notification links containing `dayId`. Review controls follow
the Backend's `canReviewCorrection` capability. Successful reviews refresh both
reports and attendance details. Zone Permissions does not embed Attendance.

## Validation and limits

Focused tests cover rate definitions, approved leave, overnight windows, ignored
duplicates/corrections, missing configuration, malformed query fields and clock
spoofing. PostgreSQL integration verifies authentic JWT HTTP requests, totals,
date/shift filters, pagination, Contractor/Site isolation and live permission
revocation. Shared client tests verify URL encoding, booleans and authentication.

No throughput benchmark is claimed. Bulk reads are scoped and limited by the
requested date windows; worker summaries are calculated before status filtering
and pagination. Very large rosters may need measured query/index optimization.
