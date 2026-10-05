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
Reading a notification never confirms or approves its request. No notification deletion or expiry
is implemented. The Web polls every 15 seconds while visible, and refetches on focus/reconnect.
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
