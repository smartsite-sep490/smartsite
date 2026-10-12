# Team and worker schedule assignment review

Implemented acceptance criteria:

- Contractor Representatives choose a team/current active subset or an individual, a granted shift, a schedule version, daily/weekly/finite weekly repeat dates and working weekdays.
- Backend preview returns current members, actual dates, worker-day count and conflicts. Create revalidates scope, membership, shift/version and preview fingerprint; all schedules are inserted atomically. Same command/request ID replays safely, and competing commands cannot create duplicate active worker-days.
- Individual exceptions can be excluded from a team assignment or edited within its batch. Changes support one day/from-date and all original members/one worker. Cancellation retains inactive rows; started shifts, attendance and linked pending/approved scheduling requests are protected.
- Team changes do not automatically rewrite schedules. Membership success offers a scoped link, and the batch action preselects new current members for explicit remaining-date preview. Existing schedules from a transferred worker's prior team appear as conflicts and require an explicit future cancellation.
- Attendance and gate policies remain unchanged: generated schedules are ordinary per-worker schedules; breaks still subtract only actual presence overlap. Historical attendance and raw scans are retained.

Shared types/client, authenticated HTTP controller, application service, batch-history entity/migration, Web form/history and operational guide were updated together. The old single-worker endpoint remains compatible. No runtime dependencies changed.

Validation on 2026-10-11:

- Frozen installation, peer checks and Mobile dependency checks passed.
- `pnpm check` passed: whole-repository lint, type checks, tests and builds. Backend unit tests: 283; Web: 394; contracts: 80; API client: 47; script tests: 23.
- PostgreSQL integration suite: 126 passed. New coverage includes finite repetition, denied/cross-site/missing scope, stale membership preview, concurrent identical retries, competing distinct requests, conflicts with atomic rollback, individual shift exceptions, protected attendance, explicit new-member assignments and rollback refusal for populated history. The complete existing migration/metadata and attendance/gate suites passed.
- Focused Web form/dashboard tests: 14 passed, including request-ID reuse after response loss, conflict blocking, invalidated preview after edit, new-member subset and one-worker future cancellation. Shift archival regression also passed in the full Web suite.
- Final changed-file ESLint, Web typecheck, Prettier and Git whitespace checks passed. The initial concurrent-retry test caught JSONB object-key ordering in command replay; hashing now canonicalizes object keys.
- Standard Compose Backend, migrate and Web images built. Local DB backed up to `D:/SmartSite/runtime-backups/before-team-schedules-20261011.dump` (311778 bytes), then migration `ScheduleAssignmentBatches1791849600001` applied. New history table exists and has zero runtime rows; synthetic tests ran only in the dedicated test database.
- Backend/Web containers restarted and are healthy; both readiness endpoints returned HTTP 200. Served Web bundle contains preview, bounded weekly repeat and new-member actions.

Limits: 366 calendar days and 5000 worker-days per command. No indefinite recurrence or automatic membership propagation is introduced. The batch summary preserves original creation metadata; the main schedule table reflects active/inactive rows. The operational guide explains transfer conflicts and protection of started shifts.

No production deployment, commit, PR or automatic historical repair was performed. Human review and authenticated manual browser acceptance remain pending.
