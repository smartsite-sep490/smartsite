# MF06 populated history upgrade review — 19 October 2026

## Decision

Keep the website on retained Main66. Do not adopt the private named graph70
as history-compatible yet. The four migrations execute successfully and preserve
the sampled history bytes, but the candidate reader cannot reconstruct a
previously readable V1 epoch. This is a reproduced compatibility failure, not
data loss or a demonstrated incorrect access decision.

## Actual rehearsal

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/`.

- `populated-main66-to70-v2/rehearse.mjs` uses the frozen Main66 production
  TypeORM options, actual private named70 options and migrated PostgreSQL5433.
- A synthetic Admin/Site/Zone produces one witnessed baseline and a subsequent
  policy command. The original reader reconstructs that epoch with identity and
  authority coverage both false.
- All four pending migration classes execute; the migration count becomes70.
- The baseline and five revision JSONB text rows match exactly before/after;
  the baseline relation OID is retained. This is a bounded fixture, not an audit
  of every history/table or a capacity benchmark.
- The candidate reader returns `UNAVAILABLE / BASELINE_INTEGRITY_UNAVAILABLE`
  for the same epoch/time. Its registry-integrity expression compares the old
  baseline registry hash against the expanded installed18-source registry.
- `result.json` retains exact checks and hashes. The original attempt's wrong
  fixture table name failed before upgrade and is preserved under v1.

The Root additive candidate is separately covered by
`zone-team-authority-populated.integration.test.ts`: populated V1 baseline,
facts, registry and relation identity remain unchanged, and the old observation
reconstructs to the same source/baseline payload after installing that candidate.
It remains unregistered, with identity/coverage false. One integration case
passed; this is additional coverage of existing behavior, not a new RED→GREEN
implementation claim.

## Required integration correction

1. Preserve explicit V1 and team-aware protocol profiles in the history reader.
   A stored V1 registry hash must be validated against its frozen V1 profile,
   rather than silently reinterpreted against today's registry.
2. Preserve exact historical source masks and witnessed revision replay. A new
   team-aware baseline/cutover must never manufacture prior team coverage.
3. Test old V1 reads before/after populated upgrade, new team-aware reads, writes
   spanning cutover, membership deletion/transfer, and unsupported mixed profiles.
   Incompatibility must remain explicit and fail closed.
4. Reconcile this with Tuấn's team writer migration before merging or registering
   either candidate; do not independently install two competing cutover systems.

## Limits

No website schema, cloud database, roles, MF08 implementation, model or worker
was changed. The temporary schemas were removed. Namespace checks do not prove
every preexisting table byte unchanged. No whole-product or production acceptance.
