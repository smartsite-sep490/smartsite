# Web and Mobile team Zone attendance (MF03/MF07)

## Web workflow

- Contractor Representatives open **Worker teams → Teams → Team leader** for the
  selected Site/Contractor. The dialog loads the team's current version and all
  current member pages. Select a member with an active Worker account and save;
  select **No leader / remove current leader** to remove the appointment.
- Representatives use **View Zone attendance** on the same team to read the
  leader's results by date, shift and schedule version, including Gate comparison
  and paginated member results. This dialog has no attendance write controls;
  only the current team leader can record or correct Zone presence.
- Workers open **My Schedule → Zone attendance** on a shift in either timetable
  or list view. This remains available after the shift starts. Ordinary Workers
  see only their own status and Gate comparison. The current leader sees the roster
  and explicit **Present / Absent** choices for eligible members of that shift.
- Only selected changes are submitted. Existing records require a correction
  reason of at least five characters. Locked records cannot be edited. Backend
  `canManage` and `canSubmit` capabilities determine available actions; missing
  Zone context, unavailable data, stale memberships/versions and revoked access
  cannot authorize a submission. Refresh discards drafts and reloads the context.
- Retrying an unchanged failed attendance command preserves its request ID. A
  successful save refreshes Zone attendance and cached attendance reports. It does
  not fabricate Gate events or promise confirmed hours: remaining evidence and
  reconciliation rules still apply.
- Attendance details translate Zone review reasons, including **Waiting for the
  team leader to record Zone attendance**, in English and Vietnamese.

The Web uses the shared client/contracts and Backend APIs below. The absence
review extension requires the additional migration described below.

## Present roll call without Gate evidence

After a shift and its approved overtime end, a matching leader PRESENT record
with no Gate IN or OUT, no attendance event and no attendance session remains
**NEEDS_REVIEW with zero worked hours**. Reconciliation sends one
`ABSENCE_REVIEW_REQUIRED` notification per day/roll-call version to active
Contractor Representatives within that Site/Contractor. It does not send this
notification when any of those evidence records exists. Approved full-shift
leave does not enter this review.

The notice opens the exact attendance day on Web or Mobile. The representative
checks the original roll call, evidence counts and shift, enters a reason and
selects **Confirm absent — 0 hours**. Only an authorized representative other
than the Worker can perform the command. Pending unrelated anomalies must be
resolved first. Team leaders remain the only users who edit Zone roll call.

`POST /sites/:siteId/attendance-days/:id/confirm-absence` adds an optional workflow:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000001",
  "expectedVersion": 3,
  "expectedTeamAttendanceVersion": 2,
  "reason": "Checked the completed shift and Gate records; Worker was absent."
}
```

The command rechecks persisted authorization, both versions, shift/approved
overtime completion and canonical evidence inside the transaction. It is
idempotent for an identical request. Success sets the day to ABSENT, keeps zero
hours, and stores the reviewer, time, reason and roll-call snapshot separately.
The leader's original PRESENT record and raw evidence remain unchanged. New
evidence after a decision reopens review with `ABSENCE_REVIEW_CONFLICT`; it never
silently grants worked hours. Missing evidence storage fails closed.

Attendance detail adds optional `gateAbsenceReview` capabilities, evidence counts
and review history. Existing clients can continue reading the day; updated
clients offer this specific absence action only when `canConfirm` is true.

## Complete Gate evidence without leader roll call

After the shift and approved overtime end, complete Gate-backed IN/OUT sessions
with no leader roll call remain provisional and NEEDS_REVIEW. The Backend sends
one `ZONE_REVIEW_REQUIRED` notice per evidence snapshot to the active scoped
Contractor Representative. It opens the exact day on Web or Mobile.

The representative checks the shift, intervals, calculated regular/overtime
minutes and deductions, enters a reason and selects **Confirm working hours /
Chốt giờ công**. The command cannot supply minutes. Existing exit allowances,
breaks and deductions still apply. A completed early checkout can be reviewed
at its calculated hours; approval does not extend it to the full shift. Missing
IN/OUT, unprojected evidence or manual sessions without canonical Gate links,
invalid schedules and pending requests
block the operation. Leader ABSENT cannot be overridden; leader PRESENT uses
normal reconciliation.

This does not create a PRESENT roll call or grant leader permissions. Not yet
remains visible. The existing `audit_log` stores actor, timestamp, reason,
reviewed minutes, assignment context and evidence snapshot.
`attendance_day.zone_attendance_review_audit_id` links to the effective decision.
No new table is needed.

The additive command is
`POST /sites/:siteId/attendance-days/:id/confirm-zone-hours`:

```json
{
  "requestId": "00000000-0000-4000-8000-000000000002",
  "expectedVersion": 3,
  "evidenceHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "reason": "Gate intervals checked; the leader did not record roll call."
}
```

Use the actual version/hash from the authenticated day detail's optional
`zoneAttendanceReview`; example values are not approval tokens. The Backend
rechecks persisted role plus Site/Contractor scope, excludes self-review, locks
the Worker/day and recalculates evidence before committing. Identical retries
reuse one audit receipt. Changed evidence invalidates the prior decision and
reopens review; a new eligible decision preserves older audit history. Stale
forms cannot silently approve newer evidence.

## Behavior and acceptance criteria

- Contractor Representatives appoint or remove one current team member as leader from the Mobile team detail. The member needs an active Worker account. Transferring/removing the leader clears the appointment.
- Workers open a shift's daily calendar detail in a compact sheet. Their own Zone attendance is **Not yet**, **Present**, or **Absent**, translated into Vietnamese/English. Opening a calendar or entering the gate never automatically marks Zone attendance.
- Leaders open **Take team attendance / Update attendance** inside that same sheet. The roster contains only active current members with the same Site, Contractor, date, shift and schedule version. Only explicitly selected members are submitted; untouched members stay Not yet.
- The assigned Zone and shift context come from Backend. Attendance opens at the resolved shift start, including overnight shifts and the template timezone. A missing/ambiguous Zone or unavailable/denied API disables editing.
- Submitted attendance can be corrected with a reason of at least five characters. Each member has optimistic version and membership checks. The atomic submission records actor, timestamp, Zone, before/after values and correction reason in `audit_log`. Stable request IDs support retries without a duplicate submission audit.
- Finalized attendance days and records belonging to a previous membership are read only. This change does not add an approval flow for reopening finalized payroll.
- Ordinary Workers can read only their own scheduled attendance; they cannot fetch the roster or submit another Worker's attendance. Leadership is scoped, not a new global user role. Backend rechecks persisted account, role, membership, Contractor participation and leadership on every operation.

## Gate evidence

The Backend derives a read-only comparison with canonical gate-linked CHECK_IN evidence for the same worker schedule. `MATCHED` means gate entry plus Present; `NO_GATE_ENTRY` means Present needs gate review; `GATE_ONLY` means a gate entry has no corresponding Present confirmation; `NOT_YET` means neither is recorded. The Mobile sheet displays the comparison beside the confirmation.

Roll call attests to presence at the assigned Zone. It does not prove completed work, continuous presence throughout a shift or grant Zone access. Raw gate events stay immutable. For group-assigned shifts starting after the policy rollout, normal confirmation requires matching team/membership/Zone, leader PRESENT and a gate-linked CHECK_IN. After shift completion, the scoped representative review described above can confirm calculated hours when canonical Gate IN/OUT is complete and leader roll call is missing. Other missing or mismatched evidence requires review. Approved full-shift leave and consistent absence do not create worked hours; previously confirmed days are preserved.

## Additive API

All routes use `/api/v1`, an authenticated user token and reviewed types in `contracts/src/team-attendance-api.ts`.

- `PUT /sites/:siteId/contractors/:contractorId/teams/:teamId/leader`: `{ expectedVersion, workerId }`, where null removes the appointment. Team responses add optional `leaderWorkerId`; `my-team` adds optional `isLeader`.
- `GET /sites/:siteId/worker-schedules/:scheduleId/zone-attendance`: own status and gate comparison, assigned team/Zone, `canManage`, `canSubmit`, plus the roster only for the current leader.
- `PUT` on the same attendance route: `{ requestId, teamId, zoneId, entries: [{ scheduleId, expectedMembershipId, expectedVersion, status }], reason? }`. Status is explicitly PRESENT or ABSENT. A new record expects version zero. A maximum of 500 distinct members can be submitted atomically.
- `GET /sites/:siteId/contractors/:contractorId/teams/:id/attendance`: scoped contractor roster and totals for `workDate`, `shiftId`, `scheduleVersionId`, with `offset`/`limit`. It is shown inside the contractor group calendar day sheet; it does not call the Worker-only roster API.

## Mobile documents

Both Contractor and Worker document entry points use a compact document library: profile summary, two identity sides, and three certificate rows. Detail sheets display files, dates, review notes and pending renewals alongside approved originals. Previous superseded versions remain available on demand. Submission controls appear only with the caller's existing upload capability; Worker identity originals remain read only. The upload path keeps image quality/date checks and Backend review requirements.

Date inputs use the shared calendar control, displayed using the selected UI locale. Image evidence opens in a separate full-screen viewer. Existing PDF sharing and authenticated file loading are preserved. All added labels, states and actions have matching Vietnamese/English catalog entries.

## Deployment and validation

Apply `TeamAttendance1795219200000` before this Backend and Mobile version. It adds the nullable leader pointer, `team_attendance`, explicit foreign keys/checks, a team lookup index and a trigger rejecting inconsistent Worker/Site/Contractor/Zone/membership references. Existing teams have no leader, and existing shifts remain Not yet. Schema synchronization stays disabled.

Deploy Backend before Mobile. Older clients ignore additive response fields. Roll back application images while retaining the additive schema. Migration downgrade refuses to erase populated team attendance history.

Apply `AttendanceAbsenceReview1795651200000` before deploying the absence-review
Backend, then update Web/Mobile. It adds `attendance_absence_review` with scoped
snapshot constraints and extends the existing notification event constraint.
Keep the additive schema when rolling back applications. Downgrade refuses to
erase review or notification history. PostgreSQL coverage in
`attendance-absence-review.integration.test.ts` includes scope denial, retries,
concurrent decisions, stale versions, raw IN/OUT, overnight overtime and evidence
arriving after a notice or final decision. Web browser checks use synthetic data;
native device and push delivery require separate validation.

Apply `AttendanceZoneReview1795651200001` before the Zone-hours review Backend.
It adds the nullable audit link, a scope-checking trigger, an idempotency index
on the existing audit table and the notification event. Deploy Backend before
updated clients. Keep the additive schema on application rollback; downgrade
refuses to erase review/notification history. Dedicated PostgreSQL tests in
`attendance-zone-review.integration.test.ts` cover overnight overtime, revoked
scope, missing evidence, stale versions/hashes, concurrency and late evidence.
Browser tests use synthetic data on desktop and a mobile viewport; native
device/push delivery remains a separate check.

Focused tests cover ordinary Worker status refresh, leadership controls, explicit member choices, correction reasons, retained draft versions, retry/error states, document read/upload permissions, date rechecking and i18n parity. PostgreSQL integration coverage is provided in `team-attendance.integration.test.ts` for scoped leadership, immutable gate evidence, retries, correction history, finalized days, scope triggers and removal of leadership. Run it against the dedicated local test database before release.

Use the dedicated local test database for integration checks; never run test fixtures against the runtime database. Native device visual QA and actual native push delivery require separate validation. See [the Mobile audit](mobile-api-audit.vi.md) for email recovery, review actions and batch scheduling.
