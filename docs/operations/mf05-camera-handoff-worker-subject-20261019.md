# Camera handoff and selected enrollment subject

Opening Regions from an active camera row now makes both existing monitoring
links return to that exact authorized Site/camera. Closing the dialog retains
the choice. Other setup actions preserve the existing context; an unloaded or
out-of-scope camera is not silently replaced with another camera.

Representative-assisted enrollment now identifies the selected Worker in its
header and initials. Without a selection it asks for a Worker. The legacy
account-management mode retains its username/account prompts. No role, consent,
Face API, default prop, schema or MF08 behavior changed.

Actual Agy p5 implemented the camera change and p8 the enrollment header. Root
reproduced the camera regression, reviewed the saved code and repaired invalid
test DTO fields. P5 separately reviewed the p8 header delta. Reports are source
reviews, not independent browser or Face recognition evidence.

Evidence under `D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1`:

- Camera regression: 1 failed / 4 passed before the fix; final focused 5 passed.
- Full affected camera set: 263 passed across 33 files.
- Enrollment header: genuine empty-worker regression plus two initially invalid
  selectors reproduced; final corrected 4 cases passed. Mock import/DTO failures
  were retained and corrected rather than treated as product regressions.
- Final combined focused run: 9 passed across 2 files, overlapping the above.
  There are 267 distinct affected cases across 34 files, not one 267-case run.
- Full Web types `mf05-handoff-types-v4` and four-file lint v2 exit0. Earlier
  512MiB typecheck OOM and invalid mock-type errors remain recorded.
- Actual production Vite build exit0: initial static JS graph 475886 bytes.
  The owner-deferred Visitor ExcelJS chunk remains 929569 bytes, so the whole
  bundle budget is not accepted. No dependency was installed.

Scoped LOC exception: existing oversized WorkerEnrollmentView grows by nine
lines for this header-only repair. Root owns this exception; extract the header
when its behavior next expands, rather than refactoring the enrollment workflow
inside a presentation bug fix. The new tests remain below 400 lines.

The build has not been served by the current local website. Backend61 and its
retained database remain active until a compatible guarded update. Browser/UAT,
camera commissioning, model quality and whole MF05/MF06 acceptance remain open.
