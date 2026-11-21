# Mobile groups, areas and team calendar

The active Expo project is `apps/mobile` in the main `smartsite` checkout. The previous team-attendance changes have been integrated into this checkout while preserving the existing Gate registry changes.

## Groups

The group list uses compact cards with status, member count and the assigned area. Group detail keeps a clear leader card above two tabs: **Members** and **Zone**. Editing team information and archiving are actions in the group menu.

Member operations start from the action, not from an ambiguous worker/action form:

- **Add member** lists unassigned workers only.
- Each member has **Appoint leader**, **Transfer member** and **Remove from team** actions. The selected member is carried into the confirmation; transfer asks only for the receiving team and reason.
- An existing leader can have their leader role removed without losing team membership.
- Appointment carries the expected team version. Transfer/removal carries the selected membership ID. Corrections and membership changes retain their existing Backend authorization and audit rules.

The Zone tab shows the current assignment, validity and actions. Details, editing, revocation confirmation and historical assignments use separate compact sheets. Expired/revoked assignments do not appear as active permissions.

## Areas and sub-tabs

Contractor area management has three compact tabs: **Zones**, **Assignments**, and **Access**. The access tab appears only when Backend grants the capability. Each row opens details. Granting from a specific assignment carries that assignment into the form; it does not ask the user to choose the same worker again. Revocation identifies the selected worker and area and requires confirmation. Revoked permissions are hidden until requested.

Worker area pages remain read only. Data stays scoped to the authenticated Site/Contractor, and the Backend remains authoritative for access authorization. Individual permission effectiveness requires both the assignment and parent grant to be current. All copy is translated into Vietnamese and English.

## Contractor calendar

The calendar tab displays groups only. It uses the worker calendar's weekly/day layout, markers for scheduled days, shift cards and compact daily details. Filters select a team rather than an individual worker. The assignment action opens group scheduling. Individual attendance review remains in the separate Attendance tab.

`GET /api/v1/sites/:siteId/schedule-assignments/calendar` takes `contractorId`, inclusive `fromDate`/`toDate`, and optional `teamId`. It returns team/date/shift/version and a scheduled member count, without individual names. The range is bounded to 366 calendar days. Authorization reuses schedule assignment read scope.

The query reads actual active worker schedules. A recorded team batch and its schedule IDs take priority. Existing schedules without a recorded team batch, including older individual assignments, are grouped using the membership interval covering the actual shift start in the shift timezone. Current membership is not used to rewrite an earlier day's team attribution. Cancelled schedules disappear; changed shifts and individual exceptions appear in the appropriate group/shift totals. Repeated references to one worker do not increase the count. Unassigned or ambiguous schedules are reported in `unassignedScheduleCount`, with a translated week-level notice, rather than being silently hidden or assigned to an invented team. The Mobile calendar refreshes every 15 seconds while active.

## Attendance day details

Worker attendance and contractor attendance review share the same Mobile day-detail layout. The summary shows the worker, localized work date, shift, status and a prominent confirmed or estimated total, with regular and overtime hours separated. Gate sessions have separate entry and exit time cells; missing scans remain explicit. Time displays use the attendance day's site timezone and include a calendar date when an endpoint falls outside the work date, including overnight shifts.

Original scans and calculation/exit details are collapsed disclosures. Exit allowances and deductions use returned day data instead of hardcoded policy text. Correction history separates the proposed interval, reason, status and review note. Worker correction requests still require the API capability, no pending correction and a session that has not been ignored; contractor viewing never exposes the worker request action. Scope checks and the original correction command/version/idempotency handling are preserved. All additional copy is available in Vietnamese and English.

Calendar day sheets also use the redesigned layout through `ScheduleDaySummary`: a localized work date and separate planned start/end times, including an overnight indicator and the shift timezone. Workers see their zone attendance status separately from the planned times, followed by the assigned team and zone. Team leaders retain the existing roll-call and correction actions. Contractor calendar details show the group and scheduled member count, explicitly distinguishing assignment from confirmed attendance; individual worker rows are not added to the group calendar. Both calendar and attendance entry points are covered by focused Mobile tests.

## Date picker and rollout

The shared iOS native picker uses `onValueChange`, preserving draft/Done behavior and removing the deprecated `onChange` callback. Android continues using the existing inline wheels.

Updating the Backend exposes the additive team calendar route. Team leader persistence additionally requires `TeamAttendance1795219200000` (nullable leader column, roll-call table, constraints and indexes). On 2026-11-20, after explicit user approval, this migration was applied transactionally to the remote application database using the matching direct connection. Post-checks verified the column, table, indexes, scope trigger and migration history record. The actual team-calendar SELECT also passed EXPLAIN against this database.

Verification is intentionally sequential because the user reported computer freezes. No Docker or emulator was started for this UI revision. PostgreSQL integration and native device visual verification remain outstanding.
