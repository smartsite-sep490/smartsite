# Camera / region setup handoff

## Behavior

Changing the camera inside Regions now updates both monitoring destinations.
The dialog and its initial camera key remain stable, preserving editing state.
When the chosen camera was loaded only in the Regions list, a scoped `getCamera`
query verifies its ID, Site and active status before exposing a return target.
Pending, refused, mismatched or inactive results omit the camera target instead
of retaining the old one. Direct URL-only selection still uses the existing
explicit Load more behavior. Current role rules remain unchanged.

Logout/session/Site changes cancel the lookup.401 signs out once;403/404/503 do
not sign out or expose stale metadata. Parent base errors hide the return target.
A camera explicitly selected while active is removed from return links if
refreshed parent metadata marks it inactive.

After saving a region, the reference image keeps its original configuration
version, timestamps and bytes. Continued edits use the updated mutation CAS
version separately. Starting a new region/Zone still requires a fresh matching
reference. An EN/VI hint explains a changed configuration; no automatic capture,
TTL extension or stale-image promotion was added.

## Verification

Root reproduced the wrong-camera handoff, the later-page edge, relabelled-image
badge and missing fresh-image hint before the fixes. Agy implemented the FE
changes; Root reviewed and repaired cancellation/metadata edges. P5 read-only
reviews identified the later-page and inactive-row concerns. Its claim that the
old direct-URL behavior always filtered inactive rows was rejected against Git.

Actual affected suite:241PASS/28files before the final inactive-row edge.
Final focused journey:12PASS, including first/later pages, logout/late result,
401/403/404/503, wrong Site, inactive response and later deactivation. Together
these cover242 distinct affected cases; there was no single242-case run.
Final TypeScript, seven-file ESLint and Vite build exit0. The existing owner-
deferred Visitor Excel chunk remains above500kB; it is not changed or accepted.

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`:
`camera-dialog-return-red-v2.log`, `camera-dialog-return-page-red-v1.log`,
`reference-version-red-v{1,2}.log`, `camera-dialog-deactivation-red-v2.log`,
`camera-region-handoff-affected-v2.log`, `camera-dialog-final-green-v2.log`,
`camera-region-handoff-{types,lint}-v3.exit.txt`, `web-camera-region-handoff-v3.log`.
Initial caption/role fixture and immediate-render timing failures are retained.
The original proposal to promote an old image's revision was rejected and saved.

## Scoped file-size disposition

Root approves bounded edits to existing large files for this defect:
`ZonePpeSetupPanel.tsx`1261lines forwards one callback;
`ZonePpeCameraRegionPanel.tsx`1042lines preserves the existing scope/drawing flow;
`ppe-catalog.ts`2043lines adds one EN/VI key. Their unrelated code is unchanged.
The region test1987lines reuses its hoisted reference mocks/canvas fixtures;
the real setup journey548lines retains one actual composition fixture instead
of duplicating it. Owner Root: extract shared test fixtures at the next substantial
region-test change, and split production panels when their responsibilities
change. Do not rewrite legacy code merely to satisfy a line count.

## Limits

DOM/client mocks and bundle checks do not prove browser rendering, hardware
availability, AI accuracy or full MF05/MF06 acceptance. No Backend, database,
permission, Main login or MF08 implementation changed in this patch.
