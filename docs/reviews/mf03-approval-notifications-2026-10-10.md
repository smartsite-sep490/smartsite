# MF03 approval and notification recipients — 2026-10-10

User decision: approving an overtime/leave request is a direct action; rejecting opens a reason form. Only the contractor representative receives the request-created notification. The Worker receives the decision, not an approval-queue notice for their own submission.

## API compatibility

`POST /sites/:siteId/attendance-time-requests/:kind/:id/review` accepts approval `{ "approve": true }` and rejection `{ "approve": false, "reviewNote": "No additional work is needed" }`. Nonempty approval notes from older clients remain accepted. A dedicated shared time-review command and validated Backend DTO keep correction/day-confirmation note rules unchanged. Missing, whitespace-only or malformed rejection reasons and forged authority fields fail validation. Existing role, Site/Contractor scope, self-review exclusion, timing, row locks and idempotency checks remain in place. No schema migration is required; deploy Backend before Web.

## UI and delivery

Contractor Approve sends directly without a shared note. Reject opens an inline, request-specific form with Confirm rejection and Cancel rejection. Empty/whitespace-only reasons cannot be sent; cancel sends no command.

New attendance TIME_REQUESTED events skip Worker delivery. Existing Worker copies are excluded by the Backend's shared list/count/read visibility policy, preserving physical records. TIME_APPROVED and TIME_REJECTED still notify the Worker. Other attendance warnings and scheduling/Safety workflows retain their scope policies.

## Verification

Backend unit tests: 274/274 passed, including HTTP-pipe/use-case validation of the new command. PostgreSQL integration: 123/123 passed, including note-free leave/overtime approval, idempotent retry, correctly scoped request delivery, hidden legacy Worker notices and Worker decision notifications. Focused Web tests: 17/17 passed, including direct approval, rejection reason/cancellation for overtime and leave, and unchanged early-departure notes. Client consumer test verifies `{ approve: true }` on the wire. Full workspace checks and runtime readiness are recorded in the task response. Human review and real-device/browser acceptance remain separate.

Final `pnpm check` passed: Backend 274/274, Web 379/379 and API client 45/45, with lint, typecheck and workspace builds successful. Frozen offline install, peers, Mobile dependency, changed-file Prettier and diff checks passed. No unrelated role or notification decision was relaxed.

Standard Compose Backend/migrate/Web builds completed. Backend was updated before Web, both reached healthy, and local readiness/Web returned HTTP 200. Served bundle `index-CoxcHsVl.js` contains the rejection form. No runtime migration or request approval was performed.
