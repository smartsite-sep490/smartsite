# Mobile groups, areas and team calendar

The active Expo project is `apps/mobile` in the main `smartsite` checkout. The previous team-attendance changes have been integrated into this checkout while preserving the existing Gate registry changes.

## Groups

The group list uses compact cards with status, member count and the assigned area. Group detail keeps a clear leader card above two tabs: **Members** and **Zone**. Editing team information and archiving are actions in the group menu.

Member operations start from the action, not from an ambiguous worker/action form:

- **Add member** lists unassigned workers only.
- Each member has **Appoint leader**, **Transfer member** and **Remove from team** actions. The selected member is carried into the confirmation; transfer asks only for the receiving team and reason.
- An existing leader can have their leader role removed without losing team membership.
- Appointment carries the expected team version. Transfer/removal carries the selected membership ID. Corrections and membership changes retain their existing Backend authorization and audit rules.

Membership writes use the PostgreSQL clock and preserve database timestamp precision. Removal closes an interval at or after its join time; transfer starts the next interval at or after the previous interval ends. A slower application clock cannot make these operations violate the membership interval constraint. Repeated removal remains idempotent.

The Zone tab shows the current assignment, validity and actions. Details, editing, revocation confirmation and historical assignments use separate compact sheets. Expired/revoked assignments do not appear as active permissions.

## Areas and sub-tabs

Contractor area management shows the scoped **Zones** list and compact zone details. The individual **Assignments** and **Access** tabs and their forms have been removed from Mobile. Team zone management remains available in group details. Revoked contractor zone grants do not appear in the list.

Worker and Contractor profiles omit device notification settings. Signing out from either profile or the scope selector opens the same compact confirmation sheet; Cancel, close and backdrop dismissal keep the session, and only the explicit Sign out action ends it. The confirmation is translated into Vietnamese and English.
Email appears as a compact row in General settings for both roles in every state. Verified addresses use the same green badge as valid documents; missing or unverified email uses an orange status badge. Tapping the row opens Add, Verify or Change as appropriate. Verification, resend and password-protected changes remain in compact sheets, including changing an unverified address.

Worker area pages remain read only. Data stays scoped to the authenticated Site/Contractor, and the Backend remains authoritative for access authorization. Individual permission effectiveness requires both the assignment and parent grant to be current. All copy is translated into Vietnamese and English.

## Contractor screens and notifications

Contractor request review keeps one primary Shift changes / Leave and overtime selector. Kind and
review state are edited together in a compact filter sheet, with Apply and Clear; draft changes do
not query the API until Apply. Both request groups use the same filter control. Exact notification
details remain independent of list pagination and filters.

Notifications use the same compact list, segmented All/Unread selector and shared detail sheet for
both roles. Mark-read and swipe-delete actions remain available; bulk read/clear actions sit in an
Actions sheet. Resource links retain the current Site/role checks and exact target IDs.

Contractor Workforce groups eight scoped worker rows per page, with search and Add on one row,
small summary counters and status badges. Both account profiles retain the previous visual layout,
including email status badges, scope switching, language, password change and logout confirmation.

## Contractor calendar

The calendar tab displays groups only. It uses the worker calendar's weekly/day layout, markers for scheduled days, shift cards and compact daily details. Filters select a team rather than an individual worker. The assignment action opens group scheduling. Individual attendance review remains in the separate Attendance tab.

`GET /api/v1/sites/:siteId/schedule-assignments/calendar` takes `contractorId`, inclusive `fromDate`/`toDate`, and optional `teamId`. It returns team/date/shift/version and a scheduled member count, without individual names. The range is bounded to 366 calendar days. Authorization reuses schedule assignment read scope.

The query reads actual active worker schedules. A recorded team batch and its schedule IDs take priority. Existing schedules without a recorded team batch, including older individual assignments, are grouped using the membership interval covering the actual shift start in the shift timezone. Current membership is not used to rewrite an earlier day's team attribution. Cancelled schedules disappear; changed shifts and individual exceptions appear in the appropriate group/shift totals. Repeated references to one worker do not increase the count. Unassigned or ambiguous schedules are reported in `unassignedScheduleCount`, with a translated week-level notice, rather than being silently hidden or assigned to an invented team. The Mobile calendar refreshes every 15 seconds while active.

## Worker hours board

The worker hours board uses a compact Today card showing actual latest entry/exit times,
missing scans and the confirmed or provisional total. Its whole card opens the existing daily
detail. Leave/overtime shortcuts are small actions on one row. Period totals place confirmed and
provisional hours side by side, retaining the explicit included overtime and day counts.

History groups eight compact rows per page with date, shift, scheduled time, hours and review
status. Exceptions use a two-line preview; the full day details remain available on tap.
Pagination sits above the rows so switching pages does not require reaching the end of the list.
The custom date filter opens in a compact sheet. Reports remain collapsed until requested.
Vietnamese/English labels, Site/Worker scope and attendance/request rules are unchanged.

## Attendance day details

Worker attendance and contractor attendance review share the same Mobile day-detail layout. The summary shows the worker, localized work date, shift, status and a prominent confirmed or estimated total, with regular and overtime hours separated. Gate sessions have separate entry and exit time cells; missing scans remain explicit. Time displays use the attendance day's site timezone and include a calendar date when an endpoint falls outside the work date, including overnight shifts.

Original scans and calculation/exit details are collapsed disclosures. Exit allowances and deductions use returned day data instead of hardcoded policy text. Correction history separates the proposed interval, reason, status and review note. Worker correction requests still require the API capability, no pending correction and a session that has not been ignored; contractor viewing never exposes the worker request action. Scope checks and the original correction command/version/idempotency handling are preserved. All additional copy is available in Vietnamese and English.

Calendar day sheets also use the redesigned layout through `ScheduleDaySummary`: a localized work date and separate planned start/end times, including an overnight indicator and the shift timezone. Workers see their zone attendance status separately from the planned times, followed by the assigned team and zone. Team leaders retain the existing roll-call and correction actions. Contractor calendar details show the group and scheduled member count, explicitly distinguishing assignment from confirmed attendance; individual worker rows are not added to the group calendar. Both calendar and attendance entry points are covered by focused Mobile tests.

## Date picker and rollout

The shared iOS native picker uses `onValueChange`, preserving draft/Done behavior and removing the deprecated `onChange` callback. Android continues using the existing inline wheels.

Updating the Backend exposes the additive team calendar route. Team leader persistence additionally requires `TeamAttendance1795219200000` (nullable leader column, roll-call table, constraints and indexes). On 2026-11-20, after explicit user approval, this migration was applied transactionally to the remote application database using the matching direct connection. Post-checks verified the column, table, indexes, scope trigger and migration history record. The actual team-calendar SELECT also passed EXPLAIN against this database.

Verification is intentionally sequential because the user reported computer freezes. No Docker or emulator was started for this UI revision. PostgreSQL integration and native device visual verification remain outstanding.
