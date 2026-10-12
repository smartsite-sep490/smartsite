# MF03/MF07 — Gate schedule denial and attendance workday boundary

## Result

OUT on a new workday no longer closes yesterday's unresolved attendance session, even when the new day has no earlier passages. A still-running overnight shift or approved overtime retains its originating workday. Legacy sessions without a day ID are also checked against their effective entry date; an unknown or different date never becomes an implicit match.

An unmatched OUT is still recorded as a physical departure, with a `MISSING_IN` session for the corresponding new day and no invented work hours. Yesterday's session retains its original event references, effective times and version. Previously recorded application data is not rewritten; corrections remain subject to approved reconciliation.

IN now requires an active assignment for the current date in the shift timezone, or an ongoing overnight shift / approved overtime period. Historical and future schedules do not count as today's assignment. Existing role, identity, account, Contractor, Site and Gate checks remain in force. Entry outside the hours of a shift assigned for the same day retains the existing Security review rule; this change does not impose a new early-entry cutoff.

Face, QR and manual verification use the same Backend evaluation. `NO_SCHEDULE` produces DENIED and cannot be overridden with a Security note or QR fallback. Schedule availability is rechecked under transaction locks at passage confirmation. If a previously verified schedule has been removed, the denial, audit and Worker warning commit before returning `WORKER_NO_SCHEDULE`.

Workers receive `ENTRY_DENIED_NO_SCHEDULE` with the affected date and instructions to contact their Contractor Representative. Delivery is scoped and deduplicated per Worker/Site/day across Face/QR/manual scans. The notification opens the Worker schedule and does not fabricate an attendance day. Gate Desk explains the reason and removes confirmation controls if authorization changes after a scan.

## Verification

- `pnpm install --frozen-lockfile`: passed.
- `pnpm peers check`: passed.
- `pnpm --filter @smartsite/mobile check:dependencies`: passed.
- `pnpm check`: passed (lint, typecheck, tests and builds). Backend 281/281, Web 383/383, API client 46/46, contracts 80/80, root scripts 23/23.
- `pnpm --filter @smartsite/backend test:integration`: passed, 125/125, zero schema drift.
- Focused Web Gate Desk test: 5/5; reason/state helper test: 15/15; notification navigation test: 1/1.
- Regression cases include the first OUT on a new unassigned day, legacy open sessions without day IDs, historical/future schedules, approved overnight/overtime work, missing/unavailable scope data, QR retry deduplication, manual override rejection and removal of a schedule between verification and confirmation.
- Migration fixture verifies the new notification event and refusal of a downgrade that would discard denial history.

Initial integration failures identified existing fixtures that assumed entry without a schedule, a new fixture missing its Contractor FK and a regression fixture advancing the shared worker into November before an October lunch scenario. The fixtures now provide real synthetic schedules where entry should succeed, include the required Contractor and run in chronological order. Final full suites passed. The shared API client's error catalog was updated together with the Backend's new public code after typecheck identified the missing entry.

## Local deployment

- Confirmed Backend uses local Compose `postgres:5432/smartsite`.
- Saved backup outside the repository: `D:/SmartSite/runtime-backups/before-gate-schedule-fix-20261011.dump` (308,770 bytes).
- Standard Compose Backend/migrator/Web builds passed using frozen lockfiles.
- Ran `GateScheduleDenial1791849600000`, then Compose `up -d --wait --wait-timeout 120 backend web` passed. PostgreSQL, Backend and Web are healthy.
- Migration history contains the new migration. Backend readiness, Web health and Web root return HTTP 200. Deployed Web bundle contains the new denial handling.
- Read-only evaluation against the deployed Backend and actual `worker.demo01` context returned IN = DENIED / NO_SCHEDULE and OUT = ALLOWED / EXIT_RECORD_ONLY. Smoke checks did not create synthetic gate or attendance records in the application database.

Web: `http://localhost:5173`; refresh the browser before testing. Downgrade refuses while the new notification history exists; keep the expanded schema when rolling back application images. No raw gate/attendance history was repaired automatically.

Real Face/QR device acceptance and another team member's review remain pending. Non-failing warnings include pg concurrent-query deprecation, jsdom canvas support and Web bundle size. Existing unrelated working changes were retained; no commit, PR, merge or production deployment was made.

## Gate result wording follow-up

At the user's request, the missing-schedule result now keeps **Access Denied** and shows **You have not been assigned a work shift for today.** as its main explanation. It omits the generic Backend-policy paragraph and secondary reason line for this case. Unknown reason codes now use a safe explanation rather than exposing `Decision code: ...`. Backend authorization and notification delivery rules were not changed.

Focused Gate Desk and reason-helper tests passed 21/21. They cover direct denial and schedule removal after scanning, including absence of the technical label and generic policy text. Changed-file ESLint, Web typecheck, Prettier and `git diff --check` passed. The first full check encountered a duplicate-text test assertion, which was corrected and verified by the focused rerun. The final `pnpm check` attempt was blocked at lint by `NotificationBell.tsx:48` (`react-refresh/only-export-components`), outside these four modified Gate Desk/helper files; that file was not changed in this follow-up. Full-repository gates therefore are not claimed passing for this follow-up.

The Web image was rebuilt successfully and deployed with Compose `up -d --no-deps --wait --wait-timeout 120 web`. Web is healthy and returns HTTP 200. The served bundle contains the English missing-shift sentence and no longer contains the technical `Decision code:` label. Refresh the browser to load this version. No Backend/database deployment was needed for the wording change.
