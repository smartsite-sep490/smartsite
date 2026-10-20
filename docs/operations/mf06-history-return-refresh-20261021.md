# MF06 history refresh on return

An operator could load an empty history, open Requests and see a newly succeeded
request, then return to history within the global30-second fresh-cache window.
With a stable injected API client, history reused the empty cached page and did
not fetch the new assessment. The focused DOM regression reproduced this as one
actual failure before the source fix.

History now explicitly uses TanStack Query `refetchOnMount:'always'`. Returning
to the tab refreshes its own exact API/client/Site/credential/token-nonce key.
There is one deliberate history GET on return, no auto-polling or cross-cache
invalidation. Existing disabled/hard-error guards, opaque credentials, paused
banner, tab keyboard behavior and shared API/status contracts are unchanged.
Previously authorized same-scope cached rows may remain visible while the
refetch is pending; a failed base refresh hides them as before.

Root rejected Agy's first whole-file candidate: it used stale props/status names,
removed existing accessibility/paused behavior and assumed a nonexistent4-second
poll. The current Requests implementation uses manual refresh. The corrected
read-only Agy review confirms the local-cache/error boundaries; its stale HEAD
label is not current-source provenance. Root's exact source diff and test output
are authoritative. No whole-file candidate was copied into source.

Verification: focused regression RED1FAIL then GREEN1PASS; complete affected
History/Panel/new-regression suites62PASS across3files in one run. Narrow
TypeScript and two-file lint exit0. The new case also checks foreign cache state
is untouched, the refreshed request uses the current token/Site and no extra
Requests call starts. This is DOM/query behavior, not browser/device/model proof.

Initial tool-path/env-config startup failures are retained. First green attempt
reached the new refetch but used the wrong case for the existing English caption;
the corrected assertion uses `Identity Unavailable`. The first typecheck selected
obsolete Main0dd contract declarations; the corrected config points to the existing
current compiled contract declarations, without suppressions or source changes.

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1`.
See `mf06-history-refresh-red-v4.log`, `mf06-history-refresh-green-v2.log`,
`mf06-history-refresh-affected-v1.log`, `mf06-history-refresh-types-v2.log`,
`mf06-history-refresh-lint-v1.log` and `mf06-history-mount-review-p5-20261021-v1.md`.

Scoped size exception: Root accepts the one-line addition to the grandfathered
`Mf06AssessmentHistory.tsx` because it changes one query option; extracting unrelated
rendering would enlarge this fix. Revisit its independent responsibilities during
a separately scoped History refactor. New regression is a separate small file.

No runtime restart, retained database change, AI/model action, push or deployment.
Real MF06 worker/history qualification, independent model/identity/authority and
allowed browser/release acceptance remain open; this closes only history return
freshness after an assessment becomes available.
