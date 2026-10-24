# MF06 request/history/detail client composition

## Verified behavior

`Mf06ZoneAssessmentPanel.api-client.test.tsx` composes the real request panel,
history, detail dialog and `SmartSiteManagementClient`. Only HTTP fetch is mocked.
Synthetic records have distinct request, event and assessment IDs.

- Opening request 1 shows only its bound assessment.
- Closing it and opening history record 2 shows record 2, without stale IDs.
- Changing Site, token and credential scope aborts pending list/detail requests,
  closes the old dialog and clears the old Site's visible records.
- Strict mocked routes require the expected Site, pagination and bearer context.

Actual final focused run: 1 case passed; TypeScript and changed-file ESLint exit0.
Agy authored the test; Root executed checks and reviewed the saved code and p5
review. An initial close-button caption fixture failure is retained in evidence.
The final test removes an unused route, redundant spy assertion and redundant
detail refetch identified in review.

## Evidence and limits

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`.
Read `mf06-api-client-journey-v3.log`, `mf06-api-client-types-v2.exit.txt`,
`mf06-api-client-lint-v2.exit.txt`, `p5-mf06-api-client-review-v1.md` and
`p8-mf06-api-client-journey-v2.md` together.

This is DOM/client/parser composition proof, not a live Backend, browser or
identity/authorization acceptance. Held fetch promises do not resolve after
abort; this file proves cancellation and clearance, not late-response execution.
The existing parent/history regression suites cover late-response isolation.
No production source or current website release changed for this test.
