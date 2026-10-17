# Canonical MAIN/Safety migration graph

Current local graph65, physical naming and notification compatibility are recorded in the [17/10 database handoff](../database/tuan-db-erd-handoff.md). Use its migration order and current test results; transaction `all` is required across the notification bridges. New migrations refuse unsafe downgrade and require verified DB/media recovery.

Historical qualification below covers the pinned MAIN35/Safety39 checkpoint. The [Main-sync integration record](2026-10-16-tuan-main-sync-merge.md) records the earlier merged59 registry and populated56 Checklist upgrade refusal; it is not the current implementation result.

The application/CLI registry is approved MAIN35 from `2e98619ac94be775ef43f4cb3076f00a59b88df1` plus reserved Safety slots0001–0004. All35 MAIN migration bodies are retained byte-for-byte. Seven missing baseline files were restored verbatim; no MF08, notifications, attendance or Workforce business service/UI was rewritten.

`synchronize` and startup `migrationsRun` remain false. Merely building this source never upgrades the current website or a cloud database. A production migration needs the normal reviewed rollout, backup and owned-target gates; no script in this change authorizes cloud writes or runs on an unspecified schema.

## Upgrade and history boundaries

- Fresh canonical schema applies39 migrations. Existing MAIN35 applies four additional migrations. No baseline table/data reset occurs.
- An already migrated legacy24 database applies16 missing canonical migrations and retains40 migration-history records:39 canonical plus the previously applied legacy history migration. Legacy tables, explicit DENY rows and prior journal records are preserved, not erased or relabeled. A migration record is never stamped without executing its migration.
- The original MAIN `ErdFaceConsent` deliberately converts legacy `NEEDS_REENROLL` profiles to `REVOKED` with a revocation time, and cancels pending/collecting enrollment sessions. That approved behavior remains. Other original fixture columns are compared exactly across the upgrade. Do not describe the specified conversion as all fields staying unchanged.
- Safety revision metadata is database-owned. Legacy consent stays `LEGACY_UNVERIFIED`; empty Safety consent storage does not certify consent. There is no model/template copy, enrollment call or identity inference.
- Candidate authority tables/control are installed with no active epoch. Existing rows are not backfilled as trusted historical facts. Writer coverage, commands, gaps, cutover and captured-time authority must be established separately; schema readiness is not authority READY.
- Previously executed legacy flat-history code and archived payloads are distinct from the MAIN journal protocol. Never reinterpret those as MAIN captured-time authority or promote legacy ALLOW to anchored permission. Current permission still retains anchored MAIN ALLOW plus independent explicit DENY.

## Verification scope

The canonical registry test compares all35 source files against the immutable approved Git baseline, requires every reserved slot exactly once and rejects registration of the legacy history migration. Real dedicated5433 integration scenarios exercise fresh, populated MAIN35 and populated legacy24 upgrades, preserved old column values and explicit DENY, rerun with zero pending migrations and database readiness. Historical re-enrollment conversion is checked separately from preserved fields.

Actual compiled `main` uses the canonical schema without provider overrides for startup/health, existing bootstrap/login/password-change/logout and Site/Camera/Zone/Region configuration. MAIN management integration fixtures explicitly select the canonical graph. Backup/restore tests capture canonical39 plus the incomplete MAIN37 predecessor, completed synthetic assessments and private evidence; synthetic history remains hidden.

Historical branch-only integration fixtures explicitly retain a frozen24 test-only list. They cannot prove MAIN39 correctness; neither that list nor its database helper is imported by production code. Runtime readiness, schema upgrade, API behavior and history trust remain separate assertions.

All destructive operations in these tests target only freshly owned synthetic schemas. Forced Windows child cleanup is not graceful production shutdown. No current website restart, cloud/Neon migration, AI execution, browser proof or whole-product acceptance follows from passing these checks.

Before operational adoption, capture and qualify every latest current business row and private file, verify exact owner and target, account for other writers and secrets/keys, and preserve a forward-recovery path. Do not automatically revert populated immutable histories. Retention/RPO/RTO, full writer closure/cutover, trusted history reading, production schema/role drift, deployment/TLS/capacity, browser and human journeys remain independent gates.
