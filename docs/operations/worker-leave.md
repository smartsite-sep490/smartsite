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
- The staffing recommendation is **24 hours before the assigned shift starts**, not before
  the requested leave interval. This is an internal advisory policy, not a statutory cutoff.
  `LEAVE_NOTICE_HOURS` is the shared default in the contracts package.
- Late planned requests and emergencies are still accepted. Reason is mandatory (5–1,000
  characters); the Worker explains the emergency or late notification there. There is no
  hard retrospective cutoff that could exclude a Worker who was unable to communicate.
- Backend derives and persists `shortNotice` from its actual receipt time and the scheduled
  shift window, including timezone and overnight shifts. Clients cannot supply this flag,
  the submitting user or the submission timestamp.
- No new illness document is required at submission. Existing Worker eligibility/document
  controls continue to apply. The application does not determine sick pay or BHXH entitlement.
- A scoped Representative can record leave on behalf through either creation endpoint.
  Requested-by and creation time remain the real submitting account/time; API reads expose
  `submittedOnBehalf`, `requestedByUserId` and `createdAt` for the review queue.

## APIs and compatibility

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
Work Hours offers hourly leave and overtime. Leave selectors include historical active shifts
for retrospective emergencies. Request times are derived from the assigned work date and
shift timezone; dates/times remain editable. Overtime excludes obsolete workdays.

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

Regression coverage includes the 24-hour boundary and overnight dates, late/emergency
creation, both review APIs, forbidden and revoked scopes, self-review, delegated audit
metadata, zero fabricated hours, preservation of a partial day's work, migration rollback,
and Mobile submission/review/error paths. Device-specific camera/physical gate behavior is
outside this change.
