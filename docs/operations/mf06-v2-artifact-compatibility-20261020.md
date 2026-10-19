# MF06 V2 artifact persistence compatibility

## Source change

The private assessment Store now validates both explicit V1 and V2 archive formats
before database I/O. Unknown formats, mixed payload/envelope versions, invalid
digests and arbitrary source masks remain rejected. Existing request scope,
SERIALIZABLE transaction, lease/revision CAS, replay and immutable-record checks
are unchanged. Format acceptance alone never establishes identity or authority.

V2 source masks reuse Tuấn's supplied `main-team-authority-sources.ts`. The codec
also recognizes the exact earlier Root V2 membership-field order without rewriting
its payload or digest. This compatibility is limited to those two fixed V2 masks;
it does not sort arbitrary fields or widen V1 validation.
New writes use the shared Tuấn ordering; readable earlier metadata is not a claim
that an unchanged V1-only database can persist V2.

Tuấn's original `1792281600000-Mf06TeamAuthorityHistory.ts` already contains the
database V2 guard. That file and its source inventory were copied byte-for-byte as
**unregistered candidates**. A redundant new guard candidate was rejected before
commit; its original failed output is retained outside source. Do not install the
earlier Root additive team-journal candidate alongside this team migration.

The registered graph remains66. Its original V1-only guard correctly refuses V2
until the prerequisite migration is installed. This source change does not mutate
applied migrations, register a migration or apply DDL to the website. Full named70
source/storage integration and historical-reader cutover are separate open gates.

## Executed verification

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/mf06-v2-storage-20261020-v1/`.

- Genuine RED: valid V2 was rejected before DB I/O. After parser support, actual
  canonical66 PostgreSQL still rejected its insert. A separate RED reproduced the
  named candidate's V2 field-order incompatibility.
- New tests:8 unit and6 real PostgreSQL cases pass. The database starts at the
  registered canonical66 graph; the original team migration is invoked manually
  in the owned test transaction. This is not a full named70 rehearsal.
- V1 stored JSONB text/hash/timestamp remains exact across that migration; the
  artifact guard keeps its OID. V2 round-trips and replays through the real Store,
  with server lease CAS and `UNAVAILABLE / AUTHORITY_UNAVAILABLE / SYNTHETIC_TEST`.
  No test records a real person's identity or an accepted business verdict.
- Eight direct-SQL faults cover absent/unknown format, mixed version, wrong Site,
  missing source, extra row field, incomplete Zone mask and row-budget overflow.
  Existing V2 rows reject UPDATE/DELETE/TRUNCATE; forward-only rollback refuses.
- 110 distinct affected cases are green across runs:104 passed in the wider run,
  its5 missing-emitted-helper failures subsequently passed, and1 added byte-
  preservation case passed. This is not a single110-case green run.
- Full Backend TypeScript and source emit build, changed-file lint and formatting pass. Copied source
  hashes still match the supplied candidate. Initial loader, frozen-fixture,
  duplicate-guard, emitter and formatting failures remain in the task evidence.
- Separate read-only SQL confirms all6 identified attempt schemas absent and
  preexisting namespace names unchanged. It is not an every-table-byte audit.

## Remaining integration and acceptance

No production provider, worker, source, model or consent was enabled. The current
website continues serving its frozen prior Backend; these source changes are not
rolled out. Named physical SQL paths, full writer/cutover coverage, original media,
real Safety-purpose consent, the WorkPort and whole MF05/MF06 acceptance remain
open. Browser policy was not retried; no push, merge, cloud change or deploy occurred.

After source commit `2803798`, the original runtime source guard correctly rejects
the changed Store source file. The exact old file was recovered from declared
Backend commit `bd91985` and matches the release's pinned hash. The supplementary
`verify-runtime-with-reviewed-source-transition.ps1` in the evidence root accepts
only that one exact old/new source transition, verifies the archived original,
and retains every other release/artifact/owner/expiry/health check. The immutable
release and runtime Backend were not rewritten or restarted. Its executed proof
is `runtime-preserved-with-source-transition.json`; this is source-review
qualification, not deployment of the new Store.
