# MF03/MF07 — Configurable unpaid shift break

Verified on 2026-10-10 in the existing working checkout. This change adds one optional unpaid break when a scoped Site Manager creates a shift. It does not add shift editing or paid leave / off-site work policies.

## Behavior

- Both break timestamps must be supplied together, ordered and within the shift. No configured break means no automatic deduction.
- Regular work time is the union of presence intervals clipped to the shift, minus the overlap with the union of the configured break and approved unpaid leave. Temporary exits and duplicate scans cannot produce duplicate deductions or hours.
- Provisional and confirmed totals use the same exclusions. Approved overtime outside the regular shift retains its existing calculation.
- Shift-local clock times and calendar offsets are resolved for the assigned work date, including overnight shifts. Attendance days preserve their break snapshot; a changed template is detected rather than silently rewriting historical hours.
- Web shift creation, shift listing and attendance day views expose the configured interval. Request/response fields are defined through the shared contract/client.

## Acceptance evidence

For 08:00–17:00 with a 12:00–13:00 break:

| Presence                                    |    Work minutes |
| ------------------------------------------- | --------------: |
| 08:00–17:00                                 |             480 |
| 08:00–11:00, 11:30–17:00                    |             450 |
| 08:00–12:00, 13:00–17:00                    |             480 |
| 08:00–12:30, 13:00–17:00                    |             480 |
| Open session from 08:00, evaluated at 12:30 | 240 provisional |

PostgreSQL integration covers confirmed timesheet totals, provisional time, snapshot preservation and invalid database intervals. Unit tests also cover overlapping leave, duplicate intervals, no overlap, presence entirely during the break, overnight mapping, malformed/incomplete/outside intervals, denied roles, missing/cross-site scope and unavailable persistence. A Web interaction test verifies manager configuration and the transmitted timestamps; a shared client test verifies transport.

## Checks executed

- `pnpm install --frozen-lockfile`: passed.
- `pnpm peers check`: passed.
- `pnpm check`: passed (lint, typecheck, tests and builds). Backend 278/278; Web 380/380; API client 46/46; contracts 80/80; root scripts 23/23.
- `pnpm --filter @smartsite/mobile check:dependencies`: passed.
- `pnpm --filter @smartsite/backend test:integration`: passed, 124/124, including zero metadata drift.
- Changed-file Prettier check and `git diff --check`: passed.

The first integration run exposed two legacy schema fixtures that deliberately apply migration groups out of chronological order. Those fixtures now defer or exclude the new dependent migration; the MF03 fixture explicitly verifies its upgrade and refusal of a lossy downgrade. The final full run passed. An initial Web typecheck failure in the new test fixture was corrected; final typecheck passed.

Non-failing output includes the existing Web bundle-size warning, jsdom canvas limitations and pg concurrent-query deprecation warnings. No dependency or runtime configuration was changed.

## Deployment and remaining verification

Apply `ShiftBreak1791763200001` before the updated Backend, then update Web. Existing shift/day rows retain null break timestamps and are not retroactively assigned a break. Downgrade refuses to discard populated break configuration or attendance snapshots.

The initial implementation was verified on the dedicated test database. At the user's subsequent request on 2026-10-10, the local application runtime was also updated:

- Confirmed Backend and migrator target the local Compose `postgres:5432/smartsite` database.
- Saved the pre-migration backup outside the repository at `D:/SmartSite/runtime-backups/before-shift-break-20261010.dump` (295,100 bytes).
- Standard Compose builds for Backend, migrator and Web passed with frozen lockfile installation.
- Ran the new migrator successfully, then `docker compose -f infra/compose.yaml up -d --wait --wait-timeout 120 backend web` passed.
- Verified `ShiftBreak1791763200001` in the application migration history and all four break columns on Shift and Attendance Day.
- PostgreSQL, Backend and Web are healthy. Backend readiness, Web health and Web root return HTTP 200. The deployed Web bundle includes the lunch break controls and API field.
- Local Web is available at `http://localhost:5173`. Site Manager creates a new shift and enables **Include an unpaid lunch break** to configure the interval. Existing shifts retain their original configuration.

Browser/camera acceptance and another team member's review remain pending. Runtime smoke checks did not create artificial shifts or attendance in the application database. Existing unrelated working changes were retained; no commit, PR, merge or production deployment was made.
