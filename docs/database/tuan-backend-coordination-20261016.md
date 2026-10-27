# Backend coordination for Tuấn — 16 October 2026

Status: prepared for the owner to forward; not sent to Tuấn and not acknowledged.

## Shared baseline

- Repository: `smartsite-sep490/smartsite`.
- Working branch: `feat/mf05-mf06-main-sync`; PR61 is open and **not merged**.
- Pushed checkpoint before this repair: `675d29ee5b30f1bc0c00902ece5e10a48c44311d`.
- Integrated Main: `3ce035888d18b61f8b70bd7c1eada4ae8d799d74`.
- Use `git fetch origin`, then inspect your actual branch, base and local changes
  before integrating. Do not reset/clean an existing working tree.
- Earlier v4 handover is an immutable historical snapshot. Its older baseline
  does not describe the current Main integration; do not use it as latest source.

## ERD rule from the project owner

The supplied [ERD](ERD-Logical.dbml) governs implementation. Its SHA256 is
`0971e449f309bd6fad35b0dbf7a66876ef0e2677f2a9fbcbff15a332b734f370`.
It contains70 tables/735 columns. Required business tables may extend it.
The repository copy has formatting-only LF/comment-whitespace normalization;
see [baseline provenance](README.md) for both hashes. The original is unchanged.
An exported diagram of the current code is **not** an approved replacement.

Current observed extensions include17 `mf06_` tables, two Safety consent tables
and seven extra columns on existing tables. Naming and semantic conformance
remain under repair; preserving baseline identifiers is not full conformance.
Use business names for new entities/tables, not flow numbers alone.
Never rewrite applied migration names, hashes or DDL to disguise a rename.
A physical rename needs a forward migration, data/trigger compatibility and
upgrade/rollback proof. Retired `zone_authority_*` objects can collide with a
naive prefix replacement, so do not independently global-replace these names.

## CI and temporary repair ownership

Run38883967571 completed with852 passed,180 failed and5 skipped Backend database
tests. Migrations, Mobile dependencies and the evidence Compose gate passed.
The180 failures are test cases, not180 established independent database defects.

Root is repairing the Main-integration slice. Before parallel Backend edits,
coordinate these hotspots with Root:

| Slice | Root repair scope | Tuấn coordination |
|---|---|---|
| CI/runtime fixtures | `apps/backend/scripts/run-tests.mjs`, source-root regression, portable evidence paths, migration counts | Avoid overlapping harness edits |
| Schema profiles | Current Main versus pinned legacy integration fixtures | Identify historical tests; do not weaken assertions or add retired release migrations |
| Public writers | Current controllers/services versus authority journal contracts | Preserve actor attribution and fail-closed behavior; agree one owner before implementation |
| ERD names | Supplied baseline, extension map, entity imports and future forward migration | Review business names and report unmerged schema work before changing DDL |

Current repair also touches the active `workforce/access` read-route wiring,
`workforce/site-access-setup-query.service.ts`, the guard on raw legacy directory
writers, `common/configuration/main-configuration-authority.ts` account-first
serialization, four renamed `database/entities/zone-entry-*` classes and their
imports. Root owns these integration corrections until a checked commit is
published; coordinate before editing the same files. MF08 implementation stays
unchanged. The exact class/storage map is in [schema extensions](schema-extensions.md).

Tuấn retains the assigned remaining Backend T0–T5 work: configuration/evidence,
authority/Face-consent provenance, assessment pipeline, migrations/recovery and
runtime readiness. This note does not claim those tasks are complete or already
started. MF08 implementation stays with Tuấn; Root does not modify it.

## Reply needed before parallel Backend changes

1. Your branch, exact base SHA, current dirty files and any unpushed commits.
2. The one Backend slice you are actively implementing and its file allowlist.
3. Any migration or DTO changes already prepared, so they can be reconciled
   before Root finishes the shared migration/contract map.

Keep API permissions, machine enums/event IDs and Face consent trust unchanged
unless the owner approves a business change. No production database migration,
merge or deployment is authorized by this note. AI remains paused; Agy owns
Frontend/UI/UX only.
