# MF07 Web notifications

Notifications are personal, durable records for shift changes and swaps. Existing scheduling
contracts remain compatible; the notification APIs are additive and do not affect AI contracts.

Example: a coworker receives `SWAP_REQUESTED` with an unread notification and a typed target
`{ siteId, requestType: "SWAP", requestId, tab: "schedule", view: "coworker" }`.
After contractor approval the request becomes `APPLIED`; both workers receive `REQUEST_APPLIED`.
Coworker refusal uses `SWAP_DECLINED`, distinct from contractor `REQUEST_REJECTED`.

Authenticated APIs:

- `GET /api/v1/me/notifications?readStatus=ALL|UNREAD&offset=0&limit=20`:
  `{ items, total, unreadCount }`, newest first, maximum limit 100.
- `PATCH /api/v1/me/notifications/:id/read`: returns `{ id, readAt }`; idempotent.
- `PATCH /api/v1/me/notifications/read-all`: returns `{ updated }`; idempotent.
- `GET /api/v1/sites/:siteId/shift-change-requests/:requestId` and
  `GET /api/v1/sites/:siteId/shift-swap-requests/:requestId`: scoped request details for deep links,
  including older requests outside the first list page.

Recipients are active linked workers or eligible contractor representatives. The actor is excluded,
as is the original requester from contractor approval tasks. All APIs recheck current role,
Site/Contractor scope and worker linkage. Losing scope hides the record and its unread count.
Reading a notification never confirms or approves its request. Notification expiry is not
implemented. The Web polls every 15 seconds while visible, and refetches on focus/reconnect.
Delivery while the app is closed, mobile push, email and other business events are outside v1.

Deploy the `Mf07Notifications1791417600000` migration, then Backend, run
`pnpm --filter @smartsite/backend notifications:backfill`, then Web. Backfill locks each still-pending
request and inserts the same deduplicated event as live processing; repeated runs are safe.
It includes pending coworker/contractor tasks only, not old outcomes or future role assignments.
Notification inserts and scheduling transitions commit or roll back together. Failures must not
be swallowed. Operational logs contain event/request identifiers and counts, not notification text.

For rollback, deploy the previous Web and Backend first. Preserve the notification table unless an
explicitly reviewed migration rollback is necessary; reverting its migration removes notification
history. Validate migrations and notification behavior on the dedicated PostgreSQL test database.

## Shift request queues and date policy

`GET /api/v1/sites/:siteId/shift-requests?view=WORKER&offset=20&limit=10` returns
`{ items, total, pendingCount, incomingCount, pendingScheduleIds }`. Items are a discriminated
union of the existing change/swap responses with `requestType: "CHANGE" | "SWAP"`.
The additive endpoint preserves the existing per-type APIs and does not change AI contracts.
Worker views are `WORKER` (all related requests) and `INCOMING` (pending coworker confirmations);
assigned Contractor Representative views are `REVIEW` (pending review) and `HISTORY` (outcomes).
Optional `requestType=ALL|CHANGE|SWAP` and `search` (worker names/reason, maximum 100 characters)
are applied before mixed ordering and paging. Limits are 1–100, default 20; offset defaults to 0.
Ordering is `createdAt DESC, id ASC, requestType ASC`; total/count/page share one PostgreSQL
statement snapshot. Polling can move records between offset pages as new requests arrive; this is
not a frozen historical export. Multiple current contractor mappings are supported for review.

Creating, confirming and applying a change/swap requires current Worker/Contractor eligibility.
Revoked or expired participation denies commands, discovery and request reads. An unavailable
permission database fails closed. Worker and Representative roles do not substitute for linkage
and Site/Contractor scope. Denied or failed commands do not update schedules or emit outcomes.

Only a **past calendar work date**, calculated in each affected shift's timezone, blocks changes.
Today remains editable even after the shift has started. Backend returns HTTP 409 with
`SHIFT_WORK_DATE_PASSED` and `This shift's work date has passed. Changes are no longer allowed.`
when creating/confirming/approving a past shift. Invalid timezone data fails closed with HTTP 503
`SHIFT_DATE_UNAVAILABLE`. Requests that age while pending remain pending and may be rejected;
automatic expiry is not implemented. The Web uses the same date policy, reloads server pages,
offers Retry for failed reads/discovery, and displays allowlisted English error messages.
Outcome notifications are Backend-owned; the old localStorage outcome banner is not used.
Absence/replacement/understaffing, direct schedule edit/delete, Mobile and push are out of scope.

No new database schema or migration is needed for this hardening. Deploy Backend (including the
new read endpoint/error codes) before the updated Web; existing clients remain compatible.

## Delete read notifications

`DELETE /api/v1/me/notifications/read` has no body or filters and returns `{ "deleted": 3 }`.
This additive personal API dismisses all currently accessible, already-read notifications owned
by the authenticated account, including records beyond the loaded page. Unread notifications,
other accounts, revoked Site/Contractor scope, scheduling requests and schedules are untouched.
A repeated command returns `{ "deleted": 0 }` when nothing else has been read. Errors fail closed.

The Web's All tab offers **Delete read notifications**, followed by confirmation. Success reloads
from the first page; failure retains the records with an English error and allows retry.
Deletion sets `deleted_at` rather than removing the database row: delivery/backfill keeps the
existing unique event/recipient key, so a dismissed event cannot reappear on replay. Deleted rows
are excluded from list/count/read APIs. This is inbox dismissal, not personal-data erasure.

Deploy the reviewed `Mf07NotificationDeletion1791504000000` migration first, then Backend, then
Web. No response shape or AI contract changes; existing clients continue to work. Roll back Web
and Backend before reverting the migration; dropping `deleted_at` makes dismissed records visible
again. The migration adds a nullable timestamp and a constraint requiring deleted rows to be read.
