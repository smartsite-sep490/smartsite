# Attendance correction submission and review

Acceptance: each worker/site may have only one pending correction, regardless of session/day filters. A new request is permitted after approval or rejection. Contractors see recorded and proposed intervals plus the worker's reason. Approval requires no note; rejection requires a nonempty reason shown only after choosing rejection.

Backend retains the existing worker row and advisory transaction locks, checks pending requests across all of that worker's sessions, and preserves identical request-ID replay before the pending check. No migration or attendance calculation change is required. Approval still refreshes reconciled attendance using the current presence, shift and break rules. Raw gate events and existing correction history are preserved. Existing duplicate pending requests are not automatically resolved.

The overview adds optional `hasPendingCorrection` independently of its selected-day filter. Web disables the correction fieldset while pending and displays a waiting message. Contractor review displays recorded/proposed intervals, approves directly, and opens a request-specific rejection form with confirm/cancel actions.

Verification on 2026-10-11:

- Frozen installation, peer checks and Mobile dependency checks passed.
- `pnpm check` passed: lint, all workspace type checks, tests and builds.
- Focused Web correction/attendance interaction tests: 17 passed.
- PostgreSQL integration suite: 125 passed. Regression covers pending duplicate submissions, request-ID replay, pending status outside the day filter, approval without a note, mandatory rejection reason and resubmission after review. Existing role/scope, stale version and raw-event preservation checks remain.
- Changed-file Prettier and Git whitespace checks passed.
- Backend/Web Compose images built and services updated locally. Both readiness endpoints returned HTTP 200; served Web bundle includes the pending-review message and rejection confirmation.

An initial integration run overlapped the unit runner, which deletes their shared `.test-build` directory, causing missing-module errors. It was rerun after the backend unit runner finished; the complete integration suite passed.

No historical data repair, production deployment, commit or PR was performed. Human review and manual browser acceptance remain pending.
