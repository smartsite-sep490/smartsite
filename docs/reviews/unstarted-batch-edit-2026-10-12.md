# Edit unstarted assignment schedules — 2026-10-12

User request: correct all dates whose shifts have not started without selecting one day at a time, even when the same assignment batch contains started or attendance-protected days.

## Behavior

- Assignment batches offer **Edit unstarted schedules**, defaulting to Change shift. Representatives can change or cancel all eligible batch schedules, or restrict the action to one original worker, with a required reason.
- The additive `UNSTARTED` scope selects active schedules by their actual shift start in the configured timezone. Today is eligible before its start; equality at start is protected. The required `workDate` stays in the command for compatibility but is ignored for this scope. Started schedules and worker-days with attendance are excluded without changing raw evidence or snapshots.
- Responses and audit records include changed/skipped schedule counts. Identical command replay preserves those counts and does not apply the change again. No eligible rows produces a conflict without a version increment.
- Current Contractor/Site authorization, batch version, worker/schedule locks and transactional update remain. Replacement shifts must be available, granted to the contractor and not already started. Linked requests on eligible schedules and replacement-history conflicts still abort the command; they are not silently skipped. Existing DAY/FROM_DATE commands retain their atomic protection behavior.
- Shared types/client, validated Backend DTO, UI, operations guide and manual case 07-29 agree. No migration or new dependency is required; deploy Backend before Web.

## Verification

- `pnpm install --frozen-lockfile`, `pnpm peers check`, Mobile dependency check: PASS.
- `pnpm check`: PASS for lint, types, tests and builds. Backend 283, Web 401, client 49, contracts 80, root scripts 23 tests passed.
- Dedicated PostgreSQL integration: 126/126 PASS. The batch regression verifies a mixed selection updates 37 future/unstarted rows and skips 3 protected rows, including attendance snapshot preservation and a shift today before start; one-worker cancellation changes 19 and skips 1; retries preserve outcomes; a started replacement aborts and all-protected selection leaves version unchanged. Cross-site and wrong-account commands are denied.
- UI regressions cover the bulk button, hidden date input, replacement/cancel selection, one-worker scope, changed/skipped feedback, conflict retention and stable retry ID. Client test verifies command transport and response counts.
- The first direct focused integration attempt encountered an empty test schema after the local test service restart. It was stopped and rerun through the standard migration-aware integration runner; the full suite then passed. Application database was not used for synthetic tests.
- Changed-file formatting and Git whitespace checks passed. The manual checklist received formatting after its new case was added.
- Standard Compose Backend/Web builds passed. Backend was updated before Web with `--no-deps --wait`; both reached healthy. Backend readiness and Web health returned HTTP 200. Served `/assets/index-BCtzKMY1.js` contains the bulk button, UNSTARTED scope and skip summary; running Backend compiled service contains UNSTARTED handling.

## Remaining acceptance

Authenticated browser walkthrough and another team member's review remain pending. Runtime verification read health/artifacts only and did not alter the user's schedules or attendance. No commit, PR, merge or production deployment was performed. Existing unrelated working changes were preserved in the checkout.
