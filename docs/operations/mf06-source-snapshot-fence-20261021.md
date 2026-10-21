# MF06 source snapshot fence

An event-time history read can miss an in-flight source writer whose journal time
precedes the event but whose transaction commits after the reader's snapshot.
SERIALIZABLE READ ONLY alone does not drain that writer. The existing low-level
reconstructor still returns coverage=false; it is not an operational qualifier.

`readMainAuthoritySnapshot` owns a fresh SERIALIZABLE transaction. Before any SELECT,
it acquires SHARE locks on all18 frozen V2 source tables followed by the epoch/control
metadata tables in the selected driver
schema, with a1500ms lock timeout and5s statement timeout. It then switches READ ONLY,
rejects any pooled temporary namespace, sets the schema-only search path, validates the selected schema,
and invokes the callback. Failure rolls back; there is no unfenced fallback.
This short lock excludes concurrent configuration writes while reconstruction runs.

## Actual proof

- `authority-snapshot-fence-proof-v1.json`: dedicated5433 synthetic table reproduced
  the stale snapshot; the lock-before-snapshot variant waited for the writer and
  saw its committed value after switching READ ONLY.
- `main-authority-read-snapshot.integration.test.ts`: final four actual canonical70-schema
  cases passed. An actual pending Site insert blocks the reader; all18 source
  locks, SERIALIZABLE/READ ONLY, committed row visibility and write refusal are
  checked. Callback failure releases locks for a subsequent writer. The installed
  function path profile remains valid and a pooled temporary table cannot shadow
  authority metadata or reach the callback.
- Narrow TypeScript and two-file ESLint exit0. Initial test-only DataSourceOptions
  schema-union compile failure is retained, then fixed by the existing typed cast.
- Owned schemas independently absent and prior namespace names unchanged after
  both probes. No full table-byte audit or retained website writes.

Proof files are under SmartSiteData/runs/rea-product-references-20261018-v1/
configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1.

## Remaining integration

This is a Task2 prerequisite, not a completed qualified reader or active runtime.
The Agy qualified-reader candidate must reuse this helper and still pass archive,
scope, cutover, witness, historical window and state-drift checks. A future writable
WorkPort finalizer must acquire its fence before its own first database read; this
read-only wrapper must never be used to conceal a previously acquired snapshot.
Real writer closure, coordinated cutover adoption, identity, model qualification,
browser and full-flow acceptance remain open. No model was trained or applied.

Peer review: P8 independently identified the same source-writer race. Its proposed
pg_locks test alone cannot prove lock-before-first-snapshot ordering; the owned
transaction wrapper supplies that ordering. Do not weaken the reconstructor's
READ ONLY contract or treat possession of a lock as operational coverage.

P8's subsequent profile finding was reproduced (1FAIL/2PASS): appending pg_temp to
the caller path mismatched frozen SET search_path FROM CURRENT function metadata.
The fix preserves the schema-only profile and refuses a pooled temp namespace
before any unqualified metadata query. Final4PASS/3.05s, compile/lint exit0; earlier
2PASS and the actual regression failure remain retained. The low-level reader is
still unqualified and returns coverage=false; this change does not promote it.

Root later reproduced a pending epoch UPDATE missed by the18-source-only fence
(qualified cohort10PASS/1FAIL). Both fresh read and writable-finalizer contracts now
require the ordered20-table MAIN_AUTHORITY_SNAPSHOT_TABLES list before the first
SELECT. The qualified cohort verifies pending epoch writer drain and refuses a
finalizer holding only the18 source locks. Source registry remains frozen18;
metadata tables are lock targets, not new business authority sources.
