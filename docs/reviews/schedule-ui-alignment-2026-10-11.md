# Schedule UI / Backend alignment — 2026-10-11

## Acceptance criteria and changes

- One-week assignment permits only Monday selections. Other weekdays are disabled in the existing shared calendar. Switching from a non-Monday requires an explicit new selection; it does not silently move the date. Preview is blocked until a Monday is selected. Sunday is calculated as Monday + six calendar days. Backend retains its Monday/Sunday validation.
- Shift ranges use each shift's timezone in the form, table, cards and selectors. A transition to the next local calendar date is marked `next day`; a UTC date transition alone does not trigger this label.
- The worker filter loads all API pages, rather than the default first 20 workers. Query caches include the current API/session. Workers and schedules shown in the table match the contractor used by the assignment form.
- Search placeholder is `Worker name or ID`, matching Backend display-name / external-ID search.
- No new contractor selector or assignment permission was added. A dashboard URL contractor must belong to the authenticated scopes. The optional schedule-reader `contractorId` query is UUID-validated and verifies representative ownership and active participation; omitted queries retain existing behavior. Worker reads still retain their own-worker restriction. No schema or migration changes were needed.
- Attendance, lunch-break overlap, gate authorization, assignment creation and historical attendance rules were not modified by this update.

## Verification

- Focused Web regression suite: 13/13 (weekly calendar, explicit Monday selection, unauthorized contractor URL, worker pagination, shared contractor scope and shift timezone/calendar transition).
- `pnpm install --frozen-lockfile`: passed without dependency changes.
- `pnpm peers check`: passed.
- `pnpm --filter @smartsite/mobile check:dependencies`: passed.
- `pnpm --filter @smartsite/backend test:integration`: 126/126 against the dedicated PostgreSQL test database, including allowed and denied contractor filters, missing-role and cross-site reads.
- `pnpm check`: passed lint, types, tests and builds. Backend 283, Web 399, API client 48, contracts 80, scripts 23 tests passed.
- Changed schedule files checked with Prettier; `git diff --check` passed. The shared calendar control received a small targeted change rather than formatting unrelated controls.
- `docker compose -f infra/compose.yaml build backend web`: passed.
- `docker compose -f infra/compose.yaml up -d --no-deps --wait --wait-timeout 120 backend web`: passed. Backend and Web healthy; readiness / health both HTTP 200.
- Served Web bundle contains Monday selection, disabled-weekday configuration, updated search and next-day label. Running Backend compiled service contains the explicit scoped reader filter.

## Manual acceptance remaining

Refresh Schedule Setup with Ctrl+F5, select One week and verify only Mondays can be clicked. Select a Monday, verify Sunday and selected working weekdays in preview, then confirm a valid assignment. Check an overnight shift and a contractor with more than 20 workers. Automated calendar tests and runtime readiness passed; an authenticated browser walkthrough and another team member's code review remain manual acceptance work.
