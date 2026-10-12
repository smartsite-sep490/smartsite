# Shift archival (MF03/MF07)

Site Managers may archive a shift template using `POST /api/v1/sites/:siteId/shifts/:shiftId/archive` or **Schedule Setup → Shifts → Archive**. No reason is required. Repeated requests return the same archive timestamp; only a Manager assigned to the selected Site can perform the command.

Archived templates are hidden by default in Schedule Setup. **Show archived** displays them with an Archived badge. Shift lists still include these templates so historical schedules can resolve their names and hours. `ShiftResponse.archivedAt` is a nullable RFC 3339 timestamp, optional for compatibility with older servers.

Schedule Setup offers Archive as the template removal action; it has no Delete control.

Archival prevents new worker schedules, new contractor assignments and selection as the target of a shift change. Approval rechecks the target: a pending change cannot apply a template archived after submission. Commands lock the template until their transaction completes, serializing new assignments against archival.

Existing active/future schedules, contractor links, change/swap requests, raw attendance events, attendance day snapshots and confirmed minutes remain. Archival does not cancel assigned work or alter a shift's clock times. Swaps of already assigned schedules retain their existing team, deadline and scope rules. A worker can still request a change from an archived template to an available template. Hard deletion continues to reject referenced shifts.

## Deployment

Apply migration `ShiftArchival1791763200000` before deploying the new Backend, then deploy Web. The migration adds nullable `shift.archived_at`; all existing templates initially remain available. `synchronize` and automatic startup migrations remain disabled. Rollback refuses to remove the column while any archived template exists, avoiding silent reactivation.

## Manual test

1. As a scoped Site Manager, archive a template that already has contractor links and worker schedules. Confirm the dialog; its card disappears.
2. Enable **Show archived**. Confirm the badge, preserved contractor links and absence of the Archive/Assign actions on that card.
3. As its Contractor Representative, verify the archived template is absent from new-assignment selectors. A direct assignment API call must return 409.
4. Open an existing worker schedule and its attendance day. Names, hours, events and confirmed minutes must remain available; no `SCHEDULE_CHANGED` anomaly should appear solely from archival.
5. Submit a change to an available target, archive that target, then try to approve the pending request. Approval must return 409 without changing the worker schedule. The request remains available for rejection.
6. Repeat the archive API request; the timestamp must be unchanged. Worker, Admin, Representative and a Manager scoped to another Site must receive 403.
