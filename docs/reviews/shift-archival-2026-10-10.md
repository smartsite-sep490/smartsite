# Shift archival verification — 2026-10-10

## Behavior

MF03/MF07 shift templates now support archival by a Site Manager scoped to the selected Site. The timestamp is stable across retries. Worker schedules, contractor links and attendance/history are retained. New worker/contractor assignments and shift-change targets reject archived templates, including approval of a previously submitted change. Existing schedule swaps retain their existing rules.

The Web setup page has Archive confirmation, Show archived and Archived status. Assignment selectors exclude archived templates. Following UI feedback, the Delete control and dialog were removed from Schedule Setup; Archive is the removal action.

## Evidence

- Frozen offline installation, `pnpm peers check` and Mobile dependency checks passed.
- `pnpm check` passed: lint, types, 270 Backend unit tests, 361 Web tests, 44 API client tests, 80 contract tests, 23 script tests and affected builds.
- `pnpm --filter @smartsite/backend test:integration` passed all 123 tests on the dedicated local PostgreSQL `smartsite_test` database.
- The focused MF07 integration test passed again after adding a concurrent archive/assignment check and rollback protection. The assignment either commits before archival or receives 409; assignments after archival receive 409.
- MF03 integration confirms unchanged raw events, existing worker schedule, day hours, confirmed minutes and anomalies after archive/reconciliation.
- Backend/migration/Web Docker builds passed. The migration was applied once to local PostgreSQL; Backend and Web became healthy and readiness/Web returned HTTP 200.
- Before applying the local migration, a PostgreSQL dump was saved outside the repository at `D:/SmartSite/runtime-backups/before-shift-archival-20261010.dump`.
- UI follow-up removed the Delete action entirely. All three focused ShiftArchival UI tests, Web build and changed-file ESLint passed; Web Docker was rebuilt for this follow-up.

## Review and limitations

All fixtures used by automated tests are synthetic. No production deployment, live Face/QR hardware test, commit or merge was performed. The workspace contains earlier MF03/MF07/team/landing changes; those were preserved. This change still needs another team member's review.

The local migration adds only nullable `shift.archived_at`. Rollback deliberately fails while archived templates exist because removing the field would silently reactivate them. Pending changes targeting an archived template remain readable and may be rejected by their normal reviewer; archival does not automatically change request statuses.

See [operations and manual tests](../operations/shift-archival.md).
