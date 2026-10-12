# MF01/MF02/MF03 — Repeated gate scans

## Resulting behavior

Repeated Face/QR verification no longer creates another attendance passage when the same direction has already been recorded for the worker's current workday. Backend returns HTTP 409 with `GATE_PASSAGE_ALREADY_RECORDED` and **Already checked in/out**. It checks current authorization and serializes confirmations with the existing Worker row lock. A repeated scan leaves GateEvent, AttendanceEvent, AttendanceSession and QR consumption unchanged.

An opposite passage permits the next entry/exit. A new workday is permitted despite an unresolved previous-day checkout; overnight shifts and approved overtime use the previous attendance day's end. Existing duplicate records are retained, with the existing Ignore duplicate IN review path.

Security may explicitly confirm a distinct physical passage using `separatePassage: true` and a new review reason of at least five characters. Only a Security Officer scoped to the Site can use this exception. It retains audit/review information and the normal attendance anomaly; no exit is fabricated. The new optional command field requires a real boolean and rejects null/string values.

The Web gate desk displays repeated-scan status, pauses scanning while its verification is pending, and provides Dismiss repeated scan. Security can select the separate-passage checkbox and enter a new reason. Automatic Face confirmation and a manual retry reuse the same idempotency key. Pausing the scan loop no longer invalidates a pending confirmation response; scope changes and camera teardown still invalidate stale results.

## Verified

- 273 Backend unit tests passed. Focused command tests also verified rejection of null/string flags and fabricated authority fields.
- All 123 PostgreSQL integration tests passed on the dedicated local `smartsite_test` database. The QR/gate suites passed again after adding role, missing-scope and cross-site cases for the separate-passage exception.
- Five repeated IN attempts create no additional passages/attendance. Simultaneous Face/QR OUT attempts produce exactly one passage. OUT followed by IN remains valid; explicitly confirmed distinct IN produces the expected review anomaly.
- Four Web gate tests passed: successful automatic confirmation, repeated-scan notification, retry after a lost response, and deliberate separate-passage confirmation with a fresh reason.
- API client tests passed (45), including the new error envelope and command field.
- Frozen offline install, peer checks, Mobile dependency checks and changed-file formatting passed. No dependency or schema migration was added.
- Final `pnpm check` passed: lint, types, tests and builds. Backend has 273 unit tests, Web 365 tests, client 45 tests, contracts 80 tests and scripts 23 tests.
- Backend/migration/Web images were rebuilt and local Compose readiness passed. Backend readiness and Web returned HTTP 200; the running Web bundle contains the separate-passage UI.

## Deployment and manual test

Deploy Backend and Web/client together. Reload the browser with Ctrl+F5. Test IN → repeated IN → OUT → IN on the demo worker. The repeated IN must report Already checked in and create no new Duplicate IN row. Test reloads and a different browser/gate session as well: the Backend holds the authoritative state.

Old duplicate rows remain available for review. Automated tests use synthetic frames and fixtures; actual camera/Face recognition still needs this manual test. Another team member's review is pending. No commit, merge or production deployment was performed. Concurrent Attendance UI edits were preserved.

See [MF03 operations](../operations/mf03-attendance.md).
