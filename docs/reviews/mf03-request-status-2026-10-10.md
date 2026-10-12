# MF03 request submission feedback — 2026-10-10

The previous form only cleared the reason and displayed a short success message after submission, leaving the form open. Contractor approval buttons were disabled until the existing required review note was entered, without explaining the requirement.

After a successful command, the Worker now sees a submitted-request card in place of the form. Its status is fetched from the existing scoped time-request API by the acknowledged request ID and original request kind, independently of queue filters. Pending approval, Approved and Rejected are displayed with the request details and review note. Status refreshes every 15 seconds; unavailable data is not invented as Pending. New request explicitly opens the form without automatically sending another command. After a page reload, existing requests remain in Time Requests.

Contractor sees an explicit note-required explanation and disabled-button tooltips. The existing Backend nonempty-note requirement, current Site/Contractor scope, before-start overtime approval and idempotency rules remain unchanged. No request was approved on the user's behalf.

Focused tests: 15/15 passed, including Pending→Approved and Pending→Rejected refresh without reopening the form, explicit New request and required-note approval. Final `pnpm check` passed with Web 377/377, Backend 273/273, client 45/45 (unchanged tasks may use cache). Frozen offline install, peers, Mobile dependency, changed-file Prettier and diff checks passed. Docker runtime verification is reported in the task response; browser/camera acceptance and human review remain separate.

Standard Compose Web build and Web-only update succeeded. Container reached healthy; served bundle `index-ByUwe4HA.js` includes the review-note guidance. Local Web and Backend readiness returned HTTP 200.
