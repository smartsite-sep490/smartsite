# MF06 Store namespace binding

## Problem and repair

Store SQL previously used unqualified request/job/assessment/artifact names. Two
real PostgreSQL regressions demonstrate that empty `pg_temp` tables with those
names make initial append and existing-command replay return UNAVAILABLE despite
valid canonical records. This is a demonstrated wrong-namespace read/availability
failure, not proof that a public caller forged an allowed assessment.

All four Store relation names now use the configured driver's quoted schema.
Missing, system, NUL-containing or oversized schema names refuse; there is no
fallback to a pooled `search_path`. Existing validation, command hashes, lease
CAS, isolation, provenance and immutable archive checks remain unchanged.

Append additionally sets a transaction-local path to the selected schema,
`pg_catalog,pg_temp`. The path must remain pinned through COMMIT because deferred
attachment triggers also read these tables. PostgreSQL resets SET LOCAL at the
transaction boundary. Caller-owned finalization must keep this namespace through
commit; it must not restore a shadowing path. No migration or trigger is changed.

## Qualification

Artifacts:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.

- Two new canonical70 pg_temp regressions: actual2RED, then2GREEN. Temporary
  shadow tables remain empty; one canonical assessment exists per request.
- Qualification of table prefixes alone failed the existing artifact insert guard.
  An attempted early path restoration failed at COMMIT with23514 from the deferred
  attachment guard. Both failures are preserved; restoring the path is removed.
- Eight affected PostgreSQL cases across the new namespace file and existing V1/V2
  archive file pass, including immutable data, malformed archive rejection and
  forward-only rollback refusal. Nine unit cases pass separately, including
  refusal of unsafe/missing schema. Counts are separate runs, not one17-case run.
- TypeScript emit and changed-file lint pass. Owned test schemas are independently
  absent afterward and prior namespace names unchanged; no all-row audit claim.

Agy p5 reviews the saved repair. Its first report concerns an intermediate
restoration version, not the final implementation; Root follows the real COMMIT
failure instead of adopting that earlier proposal. Other Agy writer inventories
are source-only candidates and remain subject to Root verification.

The existing Store remains below500 physical lines; this bounded security repair
preserves its persistence responsibility. No speculative service split or extra
dependency is introduced.

No retained website/schema, MF08, model, camera worker, push, merge or deployment
is changed. The real WorkPort, trusted identity/authority cutover and complete
MF05/MF06 product acceptance remain open.
