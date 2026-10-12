# MF03 Worker UI review — 2026-10-10

The current Worker UI change is partially implemented and does not yet satisfy the requested personal read-only dashboard. This review inspected the current workspace and ran tests; it does not establish whether the external Antigravity agent is still working.

## Implemented

- Site Access passes a Worker-specific flag, and Attendance renders `My Work Hours`.
- Worker hides `Enrol Worker` and `Active Workers`.
- Web TypeScript check passes.
- Docker Backend/Web are healthy; the served Web bundle `index-BXKNhEm4.js` includes `My Work Hours`.

## Required corrections

1. `AttendanceDaysView.tsx` calculates Worker `Total Hours` from the current 20-row page using `Math.floor(sum(confirmedMinutes)/60)`. This both omits other pages and discards minutes. Use the existing date-scoped `attendanceTimesheets` aggregate for confirmed monthly hours and overtime; query today's provisional hours independently. Summary values must not depend on history pagination or filters.
2. `AttendanceView.tsx` labels an unfiltered `attendanceOverview` response as `Today's attendance intervals`. Without `dayId`, Backend returns up to 100 recent sessions across days. Resolve today's attendance day and use its detail; selecting historical details must update the heading and scope explicitly.
3. Worker interval rendering displays `effectiveOutAt` for every session. Duplicate/ignored IN records can use this field as a reconciliation marker, not a physical OUT. Render using raw event fields and session semantics as in the existing Contractor path.
4. The shared child still displays `Request Overtime or Leave` when `canRequest` is true. This violates the requested read-only Worker dashboard. Keep Backend capabilities and other Worker features, but remove these forms/queues from this dashboard.
5. `Confirmed` and `Needs Review` cards count the current page; they are not totals for the whole range. Use scoped totals or explicitly describe the page-only scope. The requested monthly summary cards and date presets are absent.
6. Worker still sees the management-style history columns, raw anomaly codes and historical `INSIDE` values. Use a compact personal history, readable English labels, and `Open session` for unresolved history. Backend day presence is not a global real-time presence assertion.
7. The shell still says `Active Managed Site`. Use Worker-specific copy such as `My Site`.
8. No Worker-specific dashboard regression tests were found. The existing Worker access test fails because it still expects `Recent attendance`; update it to verify the new role-specific behavior and accurate data scope, rather than only rename its heading expectation.

## Verification

- `pnpm --filter @smartsite/web typecheck`: passed.
- Focused Web tests (AttendanceDaysView, interaction, AccessControlView, SecurityGateDeskView): 22 passed, 1 failed. Failure: `Worker sees personal QR and attendance without gate operations` expects old `Recent attendance` heading.
- `pnpm --filter @smartsite/backend test:integration`: 123 passed, 0 failed against dedicated PostgreSQL test database, including MF03, migrations and gate repeat protection.
- Compiled focused Backend unit tests for attendance calculation, validation, background reconciliation, repeat policy and QR commands: 14 passed, 0 failed.
- Full Web suite: 364 passed, 1 failed across 44 files; the same outdated Worker heading assertion fails. No complete green gate can be claimed.

Backend behavior exercised includes interval calculation, missing checkout and notifications, leave/overtime approval, corrections, ignored duplicates, scope boundaries, overnight shifts, preserved archival history and concurrency. Real camera/browser acceptance and human review remain separate. No application source or runtime services were changed by this review.

## Follow-up implementation

The user explicitly corrected the earlier read-only specification: Worker overtime/leave forms must remain. That instruction supersedes item 4 above.

Implemented a Worker summary that uses independent today/month/attention API queries and selected-day detail, retains minute precision, distinguishes unavailable data from zero, and omits duplicate IN markers as checkout. Worker keeps personal overtime/leave requests and history, with compact columns; shared labels explain anomalies and historical open sessions. Management page-only counts are labelled explicitly. The obsolete Worker heading test was updated; focused regression coverage verifies aggregate ranges, missing-day handling, duplicate semantics, failures and retained forms. See the latest turn verification for complete check and deployment results.

Follow-up verification: focused Web tests 24/24 passed; full `pnpm check` passed with Web 370/370, Backend 273/273, client 45/45 and script tests 23/23 (unchanged tasks may use Turbo cache). Frozen offline install, peers check, Mobile dependency check, changed-file Prettier and diff checks passed. The final focused interval/summary suite passed again after the shared label change. Standard Compose Web image built successfully and Web-only update reached healthy. No Backend/schema change was required. Browser/camera visual acceptance and human review remain pending.
