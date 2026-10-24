# MF06 scope selection layout

The restricted-zone header still allocated four desktop columns after Region and
Version controls had moved elsewhere. The three remaining children were Site,
Camera and the setup/read-only action group. This left an unused track and mixed
scope selection with navigation.

Existing Agy p5 made exactly three reviewed replacements in
`RestrictedZoneView.tsx`: two equal selector columns, a separate full-width
wrapping action row, and the corrected comment. Source line count is unchanged.
Root compared the complete file against baseline fa45d65 with only those exact
replacements permitted. Handlers, labels, i18n, roles, queries, drafts, geometry,
runtime and evidence/session semantics were preserved.

## Verification

- Eight affected MF06/navigation files: 75 tests passed in one run.
- Full current Web source/test typing passed under a 768MiB heap / 1GiB RSS guard;
  actual peak RSS897.8MiB. Changed-file lint passed, peak RSS643.7MiB.
- Actual production Vite bundle v28 passed; both intended class strings occur in
  compiled JavaScript. Initial static JS473196bytes remains below500000.
- No class-name snapshot test was added. Existing behavior tests remain intact.

Evidence root: `D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/`.
Read `mf06-scope-layout-proof-v1.json` and the named test/type/lint/build logs.
The initial missing test-group failure, Windows import-URL failure and 256MiB
lint OOM remain preserved. Final checks did not suppress assertions or warnings.
Existing jsdom canvas/navigation warnings and the Access-owned Excel chunk above
500kB remain; Access implementation was not edited.

The source and bundle are verified, not yet served by the current local website.
No browser rendering, responsive-device or screen-reader acceptance is claimed.
Browser policy restrictions remain in force. No API/DB/AI/MF08 change, dependency
installation, remote push or deployment occurred for this layout change.
