# MF07 shift change and swap deadline

A worker may request a change or coworker swap while the scheduled shift is still ongoing.
At the exact scheduled end, change and swap are locked. The end uses the schedule's work date,
the shift template's local times, and its configured timezone. Overnight shifts remain available
until their end on the following local day.

Web timetable and list views replace the actions with a locked message and recheck an open
form before submission. Backend creation, coworker confirmation and approval recheck each
affected shift, including the target of a change. A request filed earlier cannot be applied
after either affected shift has ended. Rejection and decline remain available.

For compatibility, HTTP 409 retains the existing `SHIFT_WORK_DATE_PASSED` code with the
message `This shift has ended. Changes are no longer allowed.` Unverifiable shift dates or
timezones fail closed with `SHIFT_DATE_UNAVAILABLE`. No database schema or AI contract changes
are required.

Shift request lists and swap detail reads add optional `requesterWorkDate` and
`coworkerWorkDate` fields, for example `"requesterWorkDate": "2026-10-09"`.
These are the schedule dates, separate from the request's `createdAt` timestamp.
Existing clients can ignore these additive fields; older responses or missing schedules
show `Date unavailable` in Web. No schema migration is needed. The worker schedule UI
uses English labels and omits secondary explanatory copy; user-entered reasons and team
names retain their original content.

Contractor swap review displays each worker's current active team and scheduled date
beside their shift. Optional `requesterTeamName` and `coworkerTeamName` fields are
returned by request lists and swap detail reads (for example `"requesterTeamName": "Painting Team"`).
Null means no active team in the worker's Site/Contractor scope; an omitted field from an
older Backend is shown as unavailable. Team labels are current context, not a historical
snapshot or permission to approve; Backend still rechecks the bound memberships on approval.

Direct shift-change lists and detail reads also return optional `workDate`
(for example `"workDate": "2026-10-12"`). Contractor pending review and history
show `Shift date` from the affected schedule, independently of the request's
creation timestamp. Older responses without the date display `Date unavailable`.
