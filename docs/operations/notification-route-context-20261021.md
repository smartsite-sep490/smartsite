# Notification URLs retain their requested alert

## Problem and change

`/incidents?siteId=...&alertId=...&tab=alerts` passed the Site but ignored the URL's
alert ID in favour of in-memory navigation context. Opening a second notification
on the same route could retain the first view's selection.

The four existing route properties now follow Main's `0d206cd` behaviour: prefer
the query alert ID, clear in-memory type/status filters when it is present, and
remount the alert view when that notification URL changes. Existing auth gates,
lazy routes, session scope and shared-session props are unchanged.

This is a scoped local route fix, not a Git merge of Main or an MF08 component,
service, notification contract or migration edit. The current frozen website
was not restarted or updated.

## Verification

- Old route with two new notification cases: actual 2 failures, 38 skipped.
- Corrected candidate: 40 app cases passed.
- Identical bytes applied locally, then actual source without overlay: 40 passed.
- Scoped TypeScript including both changed files, imports and existing Vite
  ambient configuration passed; two-file lint and formatting passed.
- Agy P7 independently inspected the final source and recorded test limits.

The initial candidate was rejected before source application: 22 app imports
and two test imports did not exist in either branch. Its snapshots remain in the
run directory. Root seeded the revision from exact local bytes; Agy then edited
only the four route properties and corresponding test fixtures/cases.

Startup failures remain separate from behavioural RED: first an incorrect
Vitest executable path, then missing inherited config-group variables. A full
Web typecheck exhausted its 384MiB heap; a scoped check initially omitted the
existing Vite ambient configuration, then passed after including it. No claim
of a new full-project typecheck or production build is made.

Proof directory: tooling `main-0dd7d27-integration-20261017-v1/`
`upstream-main-0d206cd-assessment-20261021-v1/`, route logs and P7 review.

The tests use a mocked alert view. Real notification persistence, MF08 selection,
browser navigation, expanded PPE notifications and end-to-end acceptance remain
separate gates. Type/status suppression is inspected, not newly asserted by the
two added cases. Main's core-only notification contract still needs coordinated
compatibility with the local expanded PPE candidates before integration.
