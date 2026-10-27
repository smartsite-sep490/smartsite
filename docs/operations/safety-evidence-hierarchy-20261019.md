# Safety evidence hierarchy, 19 October

Actual Agy p7 moved the existing PPE scope/identity context and result before the
PPE checks, with Track/confidence below. Warning titles and current-frame statuses
stay visible; longer explanations use native disclosures. Raw/paused branches,
evidence selection and expiry logic are unchanged. This applies the reviewed
prototype's hierarchy, not a claim to have cloned or rendered a reference site.

Actual Agy p8 kept request status, Camera/Zone and timestamps visible while moving
Request/Event/Assessment IDs into a native disclosure. The existing detail action
remains outside it with the same bound target. Opaque scope keys close disclosures
on token/client/Site changes; no new endpoint or polling was added.

Root inspected actual saved changes and repaired two test fixtures: the PPE test
expected a Site caption where its fixture supplies `Zone (CAM-01)`, and the
request rerender had omitted its QueryClientProvider. Original failures remain.
Agy p5 independently reviewed both source deltas and identified that provider
fixture issue; its source review does not establish visual acceptance.

## Executed evidence

Task evidence is under
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-mf06-requests-20261019-v1`.

- PPE hierarchy test RED before implementation; corrected fixture GREEN. All55
  existing/new component cases pass afterward.
- Request disclosure test is RED against exact5eb3949 source, then all32 request
  cases pass with the corrected provider fixture.
- Affected run:340PASS/1fixtureFAIL across29files. That sole failed file then has
  all32PASS:341 distinct affected cases verified across runs, not one green341-run.
- Combined Web typecheck and four-file lint PASS. Separate Vite bundle v7 exits0;
  the existing Access-owned ExcelJS929.56kB warning remains deferred to its owner.
- Canvas mock warnings remain; no browser was invoked and no screenshot exists.

File-size exception and follow-up:
`docs/planning/2026-10-19-safety-ui-size-exception.md`.

The bundle is built but not yet served. Current running website/source owner and
DB configuration have not been changed by this slice. Browser/assistive-technology,
trusted MF06 WorkPort/authority cutover, notification coordination and independent
model/whole-product acceptance remain open. No model, DB, MF08, push, merge or
deployment action was performed.
