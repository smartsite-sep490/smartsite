# Recorded assessment history: reviewed source changes

## Behavior

- A transient initial history/detail failure followed by Retry exposes a polite busy
  state while the new request is pending. It does not claim an empty result.
- History filters returned records to the selected Site, using case-insensitive
  UUID comparison. A filtered page does not hide Load more when subsequent raw
  pages remain. Selection validation uses the same UUID comparison.
- Camera and Zone references precede the lower-level assessment/request/event
  references in the detail dialog. Technical reference values remain unchanged.
- Retry, refresh, pagination and record controls retain visible keyboard focus.
  Hard access errors retain their existing revocation behavior.

## Verification

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.

- Four new regression cases fail against exact original source at `673b1e9`.
  Reviewed working source is restored byte-exact after that check.
- The first independent affected run had 33 PASS / 2 FAIL: the new tests expected
  refresh copy during an initial retry and inspected a detached Retry element.
  Root corrected the expectations to initial-loading copy and removal of Retry
  while pending; it did not change product behavior to satisfy those assertions.
- Final history/detail/binding/locale affected run: 89 PASS across nine files.
  A separate earlier six-file run passed 35 cases; these counts overlap.
- Web TypeScript passes after Root fixes a nullable Site comparison inside a
  callback. Initial TypeScript failure is preserved. Three changed files pass lint.

## Boundaries

This is source, DOM-test and type/lint evidence, not a new served release or
browser/device/screen-reader acceptance. Other pending Camera/Zone FE work is
excluded from this commit. No API, role grant, DB migration, AI worker/model,
production rollout, push or merge occurs in this slice. The existing large history
and detail files are retained; this is a bounded change, not a large-file rewrite.
