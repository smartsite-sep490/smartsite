# MF06 populated history upgrade review — 19 October 2026

## Decision

Keep the website on retained Main66. Do not adopt the private named graph70
as history-compatible yet. The four migrations execute successfully and preserve
the sampled history bytes, but the candidate reader cannot reconstruct a
previously readable V1 epoch in the original unpatched candidate. This is a reproduced compatibility failure, not
data loss or a demonstrated incorrect access decision.

## Actual rehearsal

The correction below is separately qualified; it has not replaced that original
candidate or been applied to the website.

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

## Qualified reader correction

The shared `main-authority-baseline-profile.ts` binds the registry hash to the
immutable stored snapshot masks, then accepts only the exact frozen V1 masks or
the explicitly installed current masks. Existing installed-registry/capture,
snapshot/row hashes, scope, commit witnesses, gaps, revision chains and
SERIALIZABLE READ ONLY requirements remain enforced. It does not grant coverage.
Root's current V1 reader consumes this validation. The separate named-reader
delta is in `mf06-named-reader-compatibility.patch`; `git apply --check` passed
against the original private candidate, without applying it there. The helper
must accompany the patch. This is not an automatic migration/source merge.

Actual evidence under the same root:

- `populated-main66-to70-red-v3/result.json`: the required historical read fails
  before the correction, after the actual four-migration upgrade.
- `baseline-profile-fix-v1`: five profile tests RED→GREEN, ten existing realPG
  reader cases and the populated additive regression pass; full Backend types,
  changed-file lint and formatting pass. Sixteen distinct source cases, not
  sixteen migration/whole-flow acceptances.
- `populated-main66-to70-green-v6/result.json`: original V1 observation remains
  readable under V1 after upgrade and later witnessed team creation; the new
  V2 epoch reconstructs that team creation with18 sources. A V1 epoch queried
  across that team mutation returns `SOURCE_REGISTRY_MISMATCH`. Both protocols
  retain identity/authority coverage false. Baseline bytes, six pre-upgrade fact
  rows and baseline OID match. These are bounded synthetic assertions.
- The qualified private source copy changes only its reader plus the shared
  helper; original private source and all migration bytes remain untouched.
  A fixture ESM packaging failure is preserved separately from the genuine RED.

Writer-closure certification, a real cutover/coverage decision, trusted MF06
WorkPort, independent peer review and complete release acceptance remain open.

## Limits

No website schema, cloud database, roles, MF08 implementation, model or worker
was changed. The temporary schemas were removed. Namespace checks do not prove
every preexisting table byte unchanged. No whole-product or production acceptance.
