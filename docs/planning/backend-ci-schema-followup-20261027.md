# Backend CI follow-up — 27 October 2026

Application CI 40530102327 on 6f2a724 passed `pnpm check` and migrations, then
failed the Backend database suite: 1276 pass, 5 fail, 5 skip / 1286 total.
The failing counts include parent tests; three leaf assertions failed in two files.

The new expression/partial indexes were absent from TypeORM metadata. The schema
builder proposed dropping `uq_ai_event_frame_part` and `idx_ai_event_source_frame`.
Declare these migration-owned names with `synchronize: false`, as other manually
managed indexes already do. The applied migration and its SQL are unchanged;
this does not enable synchronization or alter a deployed schema.

The worker-generation rehearsal assumed its migration was the latest release
migration. `undoLastMigration()` now correctly undoes the newer frame-index
migration instead, invalidating both its empty-down and populated-history checks.
Target the real worker migration's down/up methods inside actual PostgreSQL
transactions. This tests that migration's preservation/refusal behavior, not
rollback of the entire migration ledger. Runtime and migration registry are unchanged.

The database metadata tests now use file-owned isolated schemas, with cleanup,
instead of depending on shared public state. No public-schema migration or write
was needed for local reproduction.

Local two-file reproduction: 15 pass / 5 fail (including parent failures).
After repair: 20 pass in one run; strict TypeScript, three-file ESLint and formatting,
and diff checks passed. Each logged owned schema was absent afterward; preexisting
namespace names were retained and no new isolated namespace remained.
Logs: `D:/Ky9-FPT/SmartSiteData/runs/backend-ci-schema-20261027-v1/`.

Separate new paired proof uses the actual opt-in Python worker, real JPEG publisher,
SQLite, authenticated HTTP and current AppModule on an owned PostgreSQL schema:
three synthetic frames / ten tracks / three temporally confirmed missing-hardhat
tracks -> four raw events, three alerts (count one each), three notifications at the
correct Site/recipient, none at another Site. Duplicate delivery does not add rows.
Unknown identity stays unknown. Earlier frames truthfully return
`SKIPPED_NO_CANDIDATE`; transport acceptance is not an alert assertion.
Evidence: `D:/Ky9-FPT/SmartSiteData/runs/ai-backend-partition-journey-20261027-v1/`.
This uses fixture ConfigService/DataSource overrides and synthetic capture/detector/
pipeline output: it is not real model accuracy, deployed main/bootstrap, browser,
authorized image retrieval, official vendoring or production acceptance.

Feature PR remains Draft. No Main merge, model adoption, live camera, website,
cloud, 5434, permissions or five-table Phase 1 draft activation.
