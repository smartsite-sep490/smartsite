# MF06 history refresh — bounded software verification

The recorded-assessment tab now provides manual refresh through the existing scoped
client query. Pending refresh retains authorized rows and blocks duplicate clicks.
Both assessment history and request history retain a busy status region when an
already-empty list is refreshed. No polling, endpoint, role or worker was added.

Hard 401/403/404 responses still revoke displayed records and refresh controls;
only 401 invokes the existing sign-out callback. Initial and transient error retry,
scope/token isolation, cancellation and detail-dialog binding remain unchanged.

## Evidence

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-mf06-requests-20261019-v1`.

- Root history regression: five new cases failed before implementation; all29
  history cases passed afterward, including pending rows and access revocation.
- Agy p8 request regression: the exact HEAD component fails the pending status
  assertion under the new test; the current component passes. The original-source
  transform is confined to the regression test configuration, not product code.
- Final affected run:112 cases/10files PASS. Web TypeScript and four-file lint PASS.
- Agy p5 read-only review found no actionable issue in these saved deltas. Root
  independently inspected the callers, existing client guards and actual changes.

Preserved non-acceptance failures: an earlier request assertion checked redundant
explicit `aria-live` rather than its implicit role semantics; an abandoned Agy
test had an undefined Site fixture. They are not evidence of product defects.
The separate wrong-Site-page suggestion was rejected after inspection showed the
real client already rejects that response; no pagination/API behavior changed.

These are DOM/client-call, source and compiler checks. They do not establish
screen-reader rendering, browser acceptance, worker completion, identity,
permission coverage, model quality or production acceptance. The running local
website has not yet been rolled forward to this source change.
