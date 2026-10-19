# Safety verdict extraction and MF06 locale verification

Actual Agy p7 extracted the existing result verdict into `PpeResultVerdict.tsx`;
p8 added three MF06 locale cases using the existing shared runtime. Root reviewed
the caller, component, translation branches, modal behavior and saved code.
The verdict is stateless and receives only the existing scalar presentation inputs.
Queries, authorization, snapshot TTL, episode logic and layout classes are unchanged.
The remaining large evidence card is not claimed fully decomposed.

Root executed:

- Existing PPE parent suite:55 PASS, including visible hierarchy/episode behavior.
- Extracted component:6 PASS after correcting test expectations to the actual
  existing EN/VI catalog and replacing an invalid synthetic STALE status.
- MF06 locale suite:7 PASS after respecting the modal's hidden/inert background
  in its queries. The visible dialog continues using ordinary accessible queries.
- Full Web TypeScript, changed-file ESLint/format and production Vite bundle pass.

These are68 distinct cases across separate runs, not one68-case green run. The
first combined run had63 PASS/5 FAIL: four wrong-copy assertions and one test
querying the correctly hidden modal background. The initial type error, config
resolution/missing-group failures and original logs are retained. No production
translation, modal isolation or type was weakened to satisfy those tests.

Evidence:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-mf06-requests-20261019-v1/`.
See `verdict-locale-second-20261020.log`, `verdict-final-20261020.log`,
`locale-correction-v2-20261020.log` and final type/lint logs. The separate
`agy-product-ux-20261019-v1/web-bundle-v8` is a build artifact, not a rollout.

P5's read-only review found no blocking source defect and noted two optional
Refresh-copy/control differences. Its references to tests were source inspection,
not independently executed tests; only the Root runs above are execution proof.
Root took over p7's test correction after its saved implementation; Agy did not
run tests, use a browser, change Backend or commit.

The Access-owned ExcelJS chunk warning remains deferred by the owner. Actual
browser/render/screen-reader and whole MF05/MF06 acceptance remain open. The old
website is absent after reboot; this change neither restarts it nor starts AI.
