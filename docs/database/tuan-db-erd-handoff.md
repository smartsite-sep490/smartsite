# Database integration handoff — 18 October 2026

This is Root's integration cover for Tuấn's supplied 17 October package, not a
replacement for the owner's ERD or an approval to execute migrations.

## Source and decisions

- Reviewed Root source: `d2b32c58cacef171ace40d22b6961ca4ecfc1a85`.
- Reviewed Tuấn source: `9b960e6aaf98319ad9db6bf534ce296f6e99d883`.
- The source-only virtual merge was conflict-free; it was not merged into the
  working branch, deployed, or used to migrate the website.
- The supplied [mapping](tuan-db-erd-mapping.csv) contains 38 rows: 17 table
  renames, two unchanged consent tables, and 19 column mappings. All 17 rename
  pairs match the reviewed Tuấn source.
- `owner_decision` and `proposal_scope` in that supplied CSV describe Tuấn's
  conversation and inherited Main decisions. They are not Root/leader approval.
  Leader approval of the 17 names is still pending. The column mappings and
  broader ERD semantics are not approved merely by approving those names.
- The packet's `7bb4501` HEAD is its precommit snapshot, not the reviewed remote
  tip above. Keep that provenance distinction when quoting its test receipts.
- Main fetched on 18 October: `eb56d141221222d6857a839a00e93df53b095ea5`.
  That newer Main source is not covered by this candidate's qualification.

## Preserve the design baseline

Keep [the owner ERD](ERD-Logical.dbml), [baseline notes](README.md),
[extension inventory](schema-extensions.md), and
[the historical coordination record](tuan-backend-coordination-20261016.md).
Those records describe their original checkpoints; they are not current rollout
acceptance. The observed-schema export must never replace the owner ERD.

The initial virtual merge removed all four files above. The integration must
retain them. `node --test scripts/owner-erd.test.mjs` verifies the reviewed ERD
hash, required handoff files, and portable links. It does not compare live SQL
semantics or approve the proposed schema extensions.

## Migration and recovery boundaries

The reviewed metadata registry has 65 migrations, `transaction: all`,
`synchronize: false`, and `migrationsRun: false`. No migration was executed in
Root's source qualification. Do not cherry-pick a naming migration out of the
notification bridge sequence:

1. `1792010000000-PrepareNotificationCompatibility`.
2. Inherited pending Main/Checklist/Team migrations in registry order.
3. `1792368000001-CompleteNotificationCompatibility`.
4. `1792454400000-ZoneEntryPhysicalStorage`.

The new down paths refuse unsafe reversal. Before operational rollout, drain old
writers and qualify synchronized DB/private-media backup and forward recovery;
unchanged HTTP DTOs do not make old and new storage binaries compatible.
Use the [migration runbook](../operations/mf06-main-migration-rollout.md) and
[recovery drill](../operations/mf06-recovery-drill.md), respecting their explicitly
historical profiles. They are not commands to migrate an unspecified database.

## Evidence and remaining acceptance

Root independently compiled the candidate's full Backend source/tests and Web
source/tests. Full Backend units: 867 cases, 866 passed, one skipped, zero failed.
The skip requires explicit test connection metadata. These are software/source
checks, not PostgreSQL migration, browser, identity, or production acceptance.

Tuấn's PostgreSQL/Linux totals remain reported handoff evidence until independently
qualified for the exact integrated source. Pending work includes leader naming
approval, final independent review, owned test-schema fresh/populated upgrades,
notification preservation/rollback, OID/history/replay and new command capture.
Later rollout still requires qualified recovery, current Main integration,
deployment gates, and real user journeys. No website/cloud write, AI activation,
push, merge, or deployment is authorized by this document.
