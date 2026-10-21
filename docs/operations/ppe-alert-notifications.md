# PPE alert notifications

## Behavior and contract

Only a newly persisted `PPE_VIOLATION` alert creates personal inbox records. Grouped frames do not notify again. The existing unique key enforces one item per recipient, request type, persisted alert ID and event. A new alert can notify again, including after cooldown/closure or a new tracking/stream identity. This is not physical-person deduplication across cameras or tracks.

Storage: `request_type=SAFETY_ALERT`, `event=PPE_ALERT_CREATED`, `request_id=safety_alert.id`, `site_id=safety_alert.site_id`. Both contractor and worker are null in this shape; CHECK constraints still require a contractor for old types. `worker_id` describes a Worker recipient, never the person observed by a camera.

Recipients are active users, not blocked by a password-change requirement, with a current Safety Officer assignment at the alert's Site. Admin, Manager and Contractor roles alone do not receive PPE items. Online presence is not required. Identity UNKNOWN does not suppress valid PPE evidence; unknown/unobservable PPE itself must not be fabricated as MISSING.

The response target is `{ siteId, alertId, tab: 'alerts' }`. Web uses the existing Safety workspace at `/incidents?siteId=...&alertId=...&tab=alerts`. Structured `safetyAlert` metadata contains Backend configuration names/IDs for camera and optional Zone, plus the candidate subtype. It contains no identity assertion, raw image, storage location, RTSP URL or credential. English/Vietnamese text asks Safety to review the observation.

Reading/deleting affects only the recipient's inbox. It does not verify or close an alert/Incident. Completed/dismissed alerts remain accessible under current permissions. A revoked Site assignment, disabled user or revoked session prevents subsequent authorized API reads; Web hides cached detail and removes scoped child evidence/identity/work-context caches when detail refresh receives 401/403/404.

## Atomicity, gaps and retry

The existing ingestion transaction saves raw event, groups/saves alert, inserts inbox records and maps detections. The connector uses the same EntityManager. An inbox persistence error rolls everything back and follows the existing retryable ingestion error path. No network call or new Backend queue/outbox is added.

If no eligible Safety exists, the transaction can commit the alert without inbox records. A structured warning records `action=safety.ppe.notification.gap`, `siteId`, `alertId`, and `recipients=0`. It describes an observation inside the transaction, not a committed delivery acknowledgement. Do not count it as a sent notification. No historical backfill occurs after adding Safety or retrying a previously accepted event; authorized Safety can still inspect the alert backlog.

The supervised AI runtime in `smartsite-ai/src/smartsite_ai/runtime/assembly.py` uses the existing SQLite event outbox and dispatcher. Retryable HTTP/network failures reschedule the same event; malformed acknowledgements also retry idempotently. This was checked with synthetic outbox tests, not a real camera. The separate preview/realtime path must not be assumed to provide the same persistence guarantee. Existing Backend event-age/clock rules still apply to delayed retries; the notification connector does not change them.

## Safe local rehearsal

Use only the dedicated PostgreSQL test service. No command below targets runtime/Neon or production.

1. Start `postgres-test` only: `docker compose -f infra/compose.yaml --profile test up -d postgres-test --wait --wait-timeout 60`.
2. Provide a local TEST_DATABASE_URL using the existing `.env.test` convention or process environment. The test guard requires localhost, user `smartsite_test`, database `smartsite_test`, a password and no URL query/fragment. Do not print real connection credentials.
3. Run `pnpm --filter @smartsite/backend test:integration`. The dedicated test runner migrates this test database before sequential suites. Do not substitute the runtime migration CLI/DataSource.
4. The PPE integration fixture creates synthetic Sites, camera/Zone, current/foreign/disabled recipients and observations. Its HTTP test logs in test users, ingests an event, reads the inbox, opens the alert and serves an exact synthetic JPEG through the guarded evidence endpoint.
5. Confirm grouped/retried/concurrent observations do not duplicate items; a valid new alert does. Confirm no-recipient gaps, rollback on injected inbox failure, per-user read state, logout/account disable/role removal and cross-Site denial.
6. For Web QA use test accounts and approved synthetic evidence. Open a target URL, switch to a second alert, reload at a narrow viewport, then revoke permission and refresh. The target detail must open immediately on mobile; denied refresh must remove prior sensitive content/actions. Keyboard activation of the bell item must navigate correctly.

The bell polls every 15 seconds while the Web app is active; it does not promise browser-closed or background push delivery. No email/SMS, escalation, person tracking changes or automatic incident decisions are included.

## Migration and eventual rollout review

`PpeAlertNotifications1792886400000` is new and must be applied before enabling the updated Backend; update Web after Backend supports the new response. Review the slot against other developers' pending migrations before eventual merge. Existing migration files are unchanged. `synchronize` remains disabled.

`down` refuses to run if any PPE notification exists, including soft-deleted records. This preserves history rather than deleting it to force old NOT NULL/CHECK constraints. The rollback owner must retain/export that history under an explicitly reviewed procedure, or keep the compatible schema and roll back application behavior only. No production data deletion or migration is authorized by this runbook.

The checked-in plan and verification ledger identify actual test results and any pending checks. Human/team review and deployment approval remain separate from local implementation. All implementation changes are intentionally left uncommitted/unpushed for the user's review.
