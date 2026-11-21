# Worker leave and overtime

Workers request leave against their own active assigned shift. The assigned Contractor
Representative reviews both full-shift and hourly leave within the current Site/Contractor.
Site Managers and Admins retain their existing read scope, without review authority.
An expired/revoked contractor grant never authorizes creation on behalf or review.
Requesters cannot review their own request, including entries recorded on behalf of a Worker;
another authorized Representative must review those entries.

## Planned and emergency reporting

- `noticeType` is `PLANNED` or `EMERGENCY`. A new request from an older client without this
  field defaults to planned. Existing database rows remain unclassified (`null`).
- Planned leave requires **at least 24 hours before the assigned shift starts**, not before
  the requested leave interval. The exact 24-hour boundary is accepted.
  `LEAVE_NOTICE_HOURS` is the shared default in the contracts package.
- Emergency leave is available for shifts taking place today in the shift timezone that
  have not ended, including an ongoing overnight shift from the previous work date.
  Future-day emergency leave and new requests for an ended shift are rejected. Reason
  remains mandatory (5–1,000 characters), including representative entries on behalf.
- Backend derives and persists `shortNotice` from its actual receipt time and the scheduled
  shift window, including timezone and overnight shifts. Clients cannot supply this flag,
  the submitting user or the submission timestamp.
- No new illness document is required at submission. Existing Worker eligibility/document
  controls continue to apply. The application does not determine sick pay or BHXH entitlement.
- A scoped Representative can record leave on behalf through either creation endpoint.
  Requested-by and creation time remain the real submitting account/time; API reads expose
  `submittedOnBehalf`, `requestedByUserId` and `createdAt` for the review queue.

## APIs and compatibility

Workers may submit only one new leave request within 24 hours of their latest successful
self-submission, regardless of whether it is pending, approved, rejected, cancelled or conflicted.
This applies across both leave APIs and different assigned shifts in the same Site/Worker scope.
The Backend serializes submissions with the Worker lock and checks PostgreSQL time; client clock
changes or concurrent requests do not bypass the limit. An identical idempotent retry remains valid.
Representative entries on behalf are separate and retain the existing authorization/review rules.

`GET /my-requests` returns the authenticated Worker's own submitted leave, overtime, shift changes,
swaps and attendance corrections. It supports type/status/ID filtering and stable pagination, returns
`serverTime` and unfiltered `leaveAvailableAt`, and preserves history for inactive schedules. Applied
shift changes/swaps are included by the Approved filter. It does not accept a caller-selected Worker.
The existing time-request list additionally accepts `requestId`, without removing scope checks.

Mobile has a Worker **Submitted requests** tab with status filters, review notes and request details.
The list uses compact tappable rows with localized dates and short status badges. A single New
request action opens a type menu; type/status filters use a compact sheet with Apply and Clear.
Reasons and review notes are shown in full inside the request detail sheet.
Successful submissions show a translated confirmation with a link to the history; failed sends retain
the draft and never show success. Leave creation controls show the next available submission time.
Attendance time-request notifications carry an additive request ID/type alongside the existing day
target, so Mobile opens the exact request for Contractor review or Worker history, independent of
the current queue page/status. Incoming swap-consent notifications retain their own consent view.
The Worker Submitted/Needs your response tabs stay on the same compact screen. Incoming rows
contain only pending swap invitations addressed to that Worker. Details compare their current shift
with the proposed shift in a compact sheet; agreement sends the request to Contractor review, while
decline requires a reason. Failed responses retain the draft and remain retryable.

All routes below use `/api/v1/sites/:siteId` and require a user bearer token.

| Route                                             | Behavior                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /absence-requests`                          | Full-shift leave: `workerScheduleId`, `reason`, optional `noticeType` and existing representative-only `replacementWorkerId`.                                                        |
| `POST /attendance-time-requests`                  | Hourly/full leave or overtime: existing request ID, schedule, kind, timestamps and reason; optional `noticeType` is leave-only. Reusing an ID with changed classification conflicts. |
| `GET /attendance-time-requests?kind=LEAVE`        | Both leave creation paths appear in the same scoped, paginated queue. Existing filters/status names remain compatible.                                                               |
| `POST /attendance-time-requests/:kind/:id/review` | Canonical review with `approve` and a mandatory `reviewNote` for rejection.                                                                                                          |
| `PATCH /absence-requests/:id/approve`             | Delegates to the canonical leave review, including scope, self-review protection, overlap/version checks, retries and attendance reconciliation.                                     |
| `PATCH /absence-requests/:id/reject`              | Delegates to canonical review; body **now requires `{ "reason": "..." }`** (5–1,000 characters). Deploy the updated shared client with callers of this legacy route.                 |

`PENDING_MANAGER` remains the persisted/wire leave status for compatibility; Mobile labels it
as awaiting a Representative. No schema enum rename or historical request rewrite is performed.
Overtime remains worker-submitted, outside the shift and requested/approved before it starts.
The assigned regular shift must not have ended when submitting a new overtime request.
These creation cutoffs apply to both leave APIs. Historical requests remain reviewable,
and an identical retry of an existing time-request ID still succeeds after its cutoff.

## Attendance and Mobile

A pending leave request gives its attendance day `NEEDS_REVIEW` and the `PENDING_LEAVE`
annotation. It does not become confirmed unpaid absence while the request is pending. Mobile
shows “Absent — leave awaiting review” only after the assigned shift ends for an outside Worker with no provisional hours, and
“Leave awaiting representative review” when there are worked hours. Existing absence
notifications are retained as historical records; new pending-leave days do not emit absence.
Approved leave is excluded from required time without fabricating attendance or paid work.
For illness during a shift, select the remaining unworked interval; the Mobile form initially
suggests now through shift end and retains recorded hours. Actual IN/OUT evidence is preserved.

Worker: the home quick request and schedule detail offer planned/emergency full-shift leave;
Work Hours offers hourly leave and overtime. Planned selectors show only shifts at least
24 hours away; emergency selectors show today's unended shifts. Overtime excludes ended
assigned shifts, including ones that ended earlier today. Classification is selected before
the schedule; changing it clears the old selection. Open forms refresh at submission cutoffs
and on foreground, and recheck eligibility when submitting. Request times are derived from
the assigned work date and shift timezone; dates/times remain editable.

The Worker attendance tab separates **Timesheet** from **My requests**. Timesheet shows the
latest real IN/OUT session for today, separate provisional/confirmed hours, direct leave/OT
actions, and daily history; detailed reports are expandable. My requests pages leave/OT
requests with approval filters, submission time and reviewer feedback. Forms keep the submit
button outside the scrolling fields, offer searchable shift selectors, and preserve a failed
submission for retry with the same request ID. A cancelled form opens with a fresh draft.

Representative: **Approve Requests → Leave and overtime** lists pending/approved/rejected
requests, shows classification, short notice, reason and actual submission time, and supports
approval/rejection. Select a Worker and **Record leave for a worker** for delegated entry.
The queue is filtered by the currently selected Contractor, with Backend authorization as
the authority. Mutations invalidate Mobile queries so lists, calendars and hours reload.

Worker: **Requests → Submitted by me** also shows shift change/swap approval status.
`PENDING_COWORKER` means the coworker must consent; `PENDING_MANAGER` means the contractor
representative must review. Approved/rejected requests retain the review time and reason.
An open request detail reloads from the Backend every 15 seconds while the app is active
and refreshes on returning to the app, so the displayed status follows the review result.

## Deployment and verification

Apply `LeaveNotice1795046400000` before starting the changed Backend. Then deploy Backend
and Mobile/shared-client callers together. The migration only adds nullable classification
and short-notice columns, preserving historical unknown values. Downgrade refuses to discard
new request metadata. Runtime database migration is an explicit deployment operation; tests
apply it only to the dedicated local `smartsite_test` database.

### Attendance returns HTTP 500 after pulling main

If `attendance-summary` and `attendance-days` both fail with PostgreSQL code `42703`
(undefined column) while reading `AbsenceRequestEntity`, check that the database has
`absence_request.notice_type` and `absence_request.short_notice`. Both endpoints read
leave requests, so an unapplied leave migration can break the attendance board even
when there are no leave requests.

From the repository root, stop the local Backend and run:

```sh
pnpm --filter @smartsite/backend db:migrate:show
pnpm --filter @smartsite/backend db:migrate:run
pnpm dev:api
```

`LeaveNotice1795046400000` must be marked as applied (`[X]`). Run migrations against
the same database used by the Backend. The migration CLI prioritizes `DIRECT_URL`,
then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`; for Neon, the direct connection
must point to the same database and branch as the pooled runtime connection.
If a different pending migration fails, resolve that reported failure before retrying;
do not delete data or mark migrations as applied manually.

Regression coverage includes the 24-hour boundary and overnight dates, late/emergency
creation, both review APIs, forbidden and revoked scopes, self-review, delegated audit
metadata, zero fabricated hours, preservation of a partial day's work, migration rollback,
and Mobile submission/review/error paths. Device-specific camera/physical gate behavior is
outside this change.
