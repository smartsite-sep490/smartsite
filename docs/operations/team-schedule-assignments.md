# Team and worker schedule assignments

Contractor Representatives open **Schedule Setup → Worker Assignment**. Only active, scoped Site/Contractor representatives can preview, create, list or change assignments. Site Managers still configure shift templates, unpaid lunch breaks and schedule versions; contractors may use only shifts granted to their contractor.

## Assign and preview

1. The form uses the authenticated contractor scope (or an authorized contractor from the dashboard link). Select **Team** or **Worker**, schedule version and shift. A team loads all active current members; uncheck members needing a different shift. There is no contractor selector that grants access to another contractor.
2. Select **One day**, **One week**, or **Repeat weekly until an end date** (inclusive dates plus selected weekdays). In **One week**, only Mondays are selectable; the end date is the following Sunday. Switching from a non-Monday clears the start date and requires an explicit Monday selection.
3. **Preview assignments** shows members, actual work dates, total worker-days and existing conflicting schedules.
4. **Confirm assignments** is enabled only for a preview with no conflicts. Changing form details invalidates the preview. Backend checks the current members, shift, version, permissions and conflicts again before saving the entire batch in one transaction.

Example: a team of ten workers, Monday–Friday over four weeks, creates 200 individual `worker_schedule` records. No background recurrence job is required: the finite range is materialized immediately. Each worker continues to see their own schedule, and gate/attendance calculations continue to use it. Shift breaks are not copied into new business rules; attendance still snapshots the configured shift and deducts only break overlap with valid presence.

Ranges are limited to 366 calendar days and 5,000 worker-days per request. Empty teams, inactive or unscoped workers, archived shifts, ended shifts and dates outside the schedule version are rejected. Week selections that include already ended shifts must be moved to a future week or have those weekdays excluded. Existing active schedules are conflicts even when their shift matches; inactive rows retaining the same unique historical key are also shown as conflicts. Nothing is silently overwritten or partially saved.

## Membership and individual exceptions

- Team membership is captured when assigning; changing membership does not retroactively rewrite attendance or existing schedules.
- After adding/transferring a member, the contractor gets **Choose whether to apply remaining team schedules**. It opens assignment setup scoped to that site/contractor/team and selects that worker.
- In **Assignment batches**, **Apply remaining dates to new members** selects current members absent from the original batch and fills its original shift/weekdays and remaining range. Review the dates and shift before previewing. Ended ranges cannot be applied.
- If a transferred worker already has future schedules from their old team, the preview reports those conflicts. Explicitly cancel the old batch's future schedules for that worker before assigning the new team's shift; completed/started attendance stays protected.
- Exclude an individual when initially assigning the team, then assign the individual separately. Alternatively use **Edit or cancel schedules → Affected workers** to choose that individual.

## Change or cancel

Open an assignment batch, choose **Change shift** or **Cancel schedules**, **This day only** or **From this date onward**, a date, all original members or one worker, and a required reason. Cancellation deactivates schedules and retains the rows/history. The main schedule table shows **Active / Inactive**.

Started shifts and days with attendance cannot be changed/cancelled through this feature. Pending or approved linked leave/OT/change/swap requests also block modifications. A batch version prevents stale changes, request IDs preserve retries, and creation/change actions are audited. A conflict aborts all changes in the command. Changes are limited to schedules owned by that batch and the current contractor scope.

Use **Edit unstarted schedules** to correct an entire batch without selecting individual dates. Choose Change shift or Cancel schedules, all original members or one worker, and a reason. Backend selects active batch schedules whose original shift has not started, including today when its start is still in the future. Started schedules and worker-days with attendance are skipped; success reports changed and skipped schedule counts. Counts refer to worker-schedule rows, not distinct calendar dates. If none are eligible the command reports a conflict and makes no changes. A replacement that has already started, an unavailable shift, linked requests on eligible rows, or a schedule-history conflict still aborts the command. The existing day/from-date modes continue to fail atomically if their selection includes protected schedules.

API compatibility example: `scope: "UNSTARTED"` on the existing change command selects all unstarted batch schedules; the required `workDate` is retained for compatibility but ignored in this mode. Responses add optional `changedCount` and `skippedCount`, also preserved for identical request-ID retries. No schema migration is required. Deploy the updated Backend before Web; older clients keep their existing DAY/FROM_DATE behavior.

## API

Shift times use each template's timezone and display **next day** when the end is on the next local calendar day. The main worker filter loads all pages within the authenticated scope. Search matches worker name or external ID. The form and main table use the same contractor; the optional `contractorId` query on `GET /sites/:siteId/worker-schedules` is backward compatible and checked against representative ownership and active participation by Backend.

Shared contracts: `contracts/src/schedule-assignment-api.ts`. All endpoints are under `/api/v1/sites/:siteId/schedule-assignments` and require user bearer authentication.

- `POST /preview`: `ScheduleAssignmentInput` → members, dates, conflicts and fingerprint.
- `POST /`: preview input + stable `requestId` + `expectedFingerprint` → batch summary.
- `GET /?contractorId=...&offset=0&limit=20`: scoped, paginated batch history.
- `POST /:id/change`: stable `requestId`, `expectedVersion`, action, scope, work date, optional worker/replacement shift and reason.

Example preview:

```json
{
  "contractorId": "11111111-1111-4111-8111-111111111111",
  "scheduleVersionId": "22222222-2222-4222-8222-222222222222",
  "shiftId": "33333333-3333-4333-8333-333333333333",
  "target": "TEAM",
  "teamId": "44444444-4444-4444-8444-444444444444",
  "mode": "REPEAT",
  "fromDate": "2030-10-07",
  "toDate": "2030-11-01",
  "weekdays": [1, 2, 3, 4, 5]
}
```

`DAY` requires identical from/to dates. `WEEK` requires a Monday from-date and Sunday to-date. ISO weekdays are Monday=1 through Sunday=7. `selectedWorkerIds` optionally chooses a nonempty subset of a team; worker targets use `workerId` and omit team fields.

## Deployment and rollback

Back up the database and apply `ScheduleAssignmentBatches1791849600001` before Backend/Web updates. It adds a history table without altering old schedules or attendance. `synchronize` remains false. Rollback refuses to remove a nonempty batch history table; do not drop recorded history. Existing single-worker API remains compatible, and the new Web form uses preview/batch endpoints for both targets.
