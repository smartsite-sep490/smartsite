# Scheduled absence (MF03/MF07)

After an active assigned shift ends, Backend reconciliation creates the attendance
day even if the worker has never passed a gate. A valid single schedule with no
non-ignored attendance sessions becomes `ABSENT`. No absence is inferred before
the shift ends, for a cancelled schedule, or for approved full-shift leave.
Unresolved attendance evidence, pending requests, changed/missing shift data and
multiple shifts remain subject to attendance review rather than automatic absence.
Overnight shifts use the configured shift timezone and work date.

The existing scoped attendance-days API adds the status `ABSENT` (also accepted
as a status filter). Example fields: `{ "status": "ABSENT", "regularMinutes": 0,
"overtimeMinutes": 0, "confirmedMinutes": null }`. Web displays an `ABSENT` badge
in both worker schedule views by matching the Backend attendance day to its
schedule ID. Zero hours do not represent approved payroll hours.

Worker Dashboard shows each assigned Site's total absent days. My Schedule also
shows an absence count for the selected date range. Counts use the scoped API's
`total` with `status=ABSENT` and the resolved Worker ID, rather than a page's
length. Approved leave and days without an assigned shift are excluded; loading
or unavailable data never displays a misleading zero.

An in-app `ATTENDANCE` notification with event `ABSENT` is sent to the linked
active worker account and authorized representatives of the same Contractor and
Site. The existing recipient/event uniqueness constraint prevents duplicate
notifications on retries, multiple Backend instances and restarts. Email/SMS
delivery is not added. The periodic job runs at startup and every minute; it
also reconciles historical active schedules, so deployment may generate absence
notifications for past shifts. Check schedule and approved-leave data first.

Deploy migration `AttendanceAbsence1792022400000`, then Backend and Web together.
This expands a response status enum and notification event enum; clients with
exhaustive enum handling must be updated before enabling reconciliation. No
AI contract changes are involved. Rollback refuses to discard absence history;
stop the new Backend and resolve/preserve those rows before rolling back.
