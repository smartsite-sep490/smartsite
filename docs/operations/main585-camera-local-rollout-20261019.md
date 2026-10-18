# Main585 and camera workspace: current local release

Local 5181 now serves Web and Backend source `bd91985479eed6d213b69e2bd307af0991c7bdb0`.
This includes Main585, the compact camera workspace, exact-camera Regions and
monitoring handoff, and the corrected selected-worker enrollment header. Main's
LoginScreen blob exactly matches origin/main 585cc263.

Current owner: Node33580, birth 2026-10-19T01:53:05.4695980+07:00. Output:
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/website-software-20261019-015302-695cd159`.
Expiry: 2026-10-19T12:53:22.131Z =19:53VN19Oct. Do not assume it survives reboot
or expiry. Credentials stay in the private output; the demo123 account is kept.
Current process guard is `Confirm-Current-Software-Owner-v14.ps1` in the parent.

## Data and rollback evidence

The dedicated PostgreSQL5433 cluster was retained. No cloud/main-demo5434 action.
Before own STOP, a fresh actual state export, mutable configuration digest and
all prepared release hashes were checked. Old Node31992 exited0 after its STOP,
with HTTP/application closure and a retained-schema shutdown receipt.

All five Main migrations were first executed inside an owned transaction while
the website was stopped, checked against every prior row/column, and rolled
back. The installed61 registry and complete prior89-table state then matched.
Only after that rehearsal were the same five migrations committed to66.
All89 prior table rows/columns and four selections survived; three document
tables were added, giving92 application tables plus the migration table.
The quiesced private pg_dump and before/after snapshots remain on D.

A prior-UI release on the same Backend66 is prepared as a fallback. No database
down migration or schema deletion was used. The separate Tuấn naming candidate
was not silently substituted for this Main66 graph.

## Verification

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/main585-backend-qualification-v1`.

- The new source-only Backend build exits0 and all366 emitted JS files exactly
  match the tested artifact. Its native main recovery journey passed with93
  tables,2 synthetic media files and exact private authenticated reads. Two other
  explicitly gated recovery scenarios were skipped; Windows stop is not Linux
  graceful-shutdown evidence.
- Camera affected263 cases /33files pass. Enrollment4 cases pass. Final focused
 9-case run overlaps those; full Web types, four-file lint and Vite build exit0.
- Actual local HTTP verification v2 passes15 groups and55 exact manifest assets:
  Main entry, ready DB, demo123 login/profile/roles, cookie refresh/logout,
  retained Site/Camera/Zone/Region context and MF06 scoped read APIs.
- Current actual state retains1Site/6Zones/4Cameras/8Regions/four selections.
  HTTP authentication creates/revokes test sessions, not business configuration.
- HTTP v1's incorrect `no-store` expectation for MF06 was preserved; the actual
  contract is `private, no-store`, verified in v2 without a product change.
- Initial JS is475886 bytes. Owner-deferred Visitor ExcelJS remains929569 bytes;
  the whole bundle budget is not accepted.

This is imported AppModule/configureApplication with real retained testPG and
temporary Vite preview, without ConfigService/DataSource overrides. It is not
production main deployment, browser rendering, device, capacity or full-flow
acceptance. AI remains paused/source-mapempty/Python0: metadata ACTIVE does not
mean a live camera is connected. Real source commissioning, model/wearer/identity,
MF06 runtime processing and PPE notification delivery remain open. No push,
GitHub merge, MF08 implementation change or production deployment occurred.
