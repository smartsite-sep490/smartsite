# Mobile attendance and face status

The timesheet shows the first unique review reason and a remaining count. Opening
the day exposes a compact disclosure containing every unique reason. A pending
leave replaces the redundant generic pending-request reason. The day summary
groups its hours, and explanations, gate evidence and multiple missing shifts are
collapsed; authorized correction/review actions remain available. No attendance
calculation, confirmation or access rule changes.

Worker Profile → General settings displays face-recognition status. The additive
`GET /api/v1/sites/:siteId/workers/me/face-status` uses the authenticated user's
Worker in that exact Site and requires the Worker Site role. It accepts no Worker
identifier and returns only `{ "status": "ACTIVE" }`, for example. Other values
are `NOT_ENROLLED`, `REVOKED`, `NEEDS_REENROLL`, `DELETED`. The latest persisted
profile determines the status; only an absent profile means `NOT_ENROLLED`. A
missing Worker is a 404; authorization and database errors remain errors.

The row supports Vietnamese/English, loading, unavailable and retry states; it
refreshes on mount and every minute while mounted. An active account does not
prove face enrollment. Contractor representatives do not request this own-Worker
endpoint. Existing face management permissions are unchanged. No camera capture,
enrollment, template delivery, model startup or schema migration is added.

Deploy the additive Backend endpoint before the Mobile client. Older Backends
produce the unavailable state rather than an invented enrollment result. Physical
device layout and font-size acceptance still require a device check.
