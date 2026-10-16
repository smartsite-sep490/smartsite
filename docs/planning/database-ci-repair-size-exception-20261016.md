# Scoped size exception — database CI repair

Owner/reviewer: Root,16 October2026. Scope: the ERD/Main integration repair on
`feat/mf05-mf06-main-sync`; not permission for further feature growth.

Existing oversized files grow only at the following repaired boundaries:

| File under `apps/backend/` | Before → after LOC | Reason |
|---|---|---|
| src/modules/workforce/directory/contractor-operations.service.ts |592→601| Refuse raw legacy writes once Main authority is installed |
| src/modules/workforce/directory/workforce-configuration.service.ts |757→763| Same guard on raw legacy entrypoints |
| test/contractor-operations.service.test.ts |1782→1784| Explicit legacy-schema query in the existing fake |
| test/integration/account-face-templates.integration.test.ts |786→799| Current authenticated command context replaces obsolete raw fixture writer |
| test/integration/main-public-zone-permission.integration.test.ts |985→993| Real Site Manager fixture and current active controller token |
| test/integration/mf06-assessment-storage.integration.test.ts |777→778| Exact constructor import after business rename |
| test/integration/mf06-enqueue.integration.test.ts |745→749| Mechanical wrapping after longer business class names |
| test/integration/mf06-ingestion-enqueue.integration.test.ts |1160→1163| Mechanical wrapping after longer business class names |
| test/mf06-assessment-entities.test.ts |750→752| Mechanical wrapping after longer business class names |
| test/integration/mf01-onboarding.integration.test.ts |1457→1475| Existing end-to-end fixture calls the attributed Main creation/assignment commands |
| test/integration/mf06-assessment-store.integration.test.ts |1284→1288| Explicitly register frozen B2 projections in the historical fixture that installs B2 |

The new production guard is a separate small file. No test assertions were
compressed or removed to meet a line limit; frozen migration/entity snapshots
were not reformatted. Splitting every inherited service/large fixture during a
CI integration repair would obscure authorization and history changes.

Follow-up: Root and Tuấn should split future implementation work by public writer,
read projection and fixture purpose when that specific area is next changed.
Do not use this exception to append unrelated behavior or rewrite MF08.
