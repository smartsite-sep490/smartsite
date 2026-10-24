# MF06 qualified event-time authority capability

This is implemented private capability, not an active worker or production acceptance.
The real writer review still has completeWriterClosureEstablished=false. No operational
manifest, migration registration, current website migration or runtime activation was made.

## Contract

- MainQualifiedAuthorityReader.prepare verifies the operator-pinned release before
  opening the owned source-fenced SERIALIZABLE READ ONLY snapshot. It reuses the
  existing captured-state reconstruction and immutable archive codec.
- Qualification binds the V2 registry, archive epoch/baseline/manifest hashes, exact
  installed capture profile, DB activation marker, control pointer, commit witnesses,
  event-time window and gaps. No current-permission fallback or Worker identity.
- Returned prepared objects are frozen and instance-attested. A copied/serialized
  object is not a finalization credential. SYNTHETIC_TEST remains non-operational
  and is refused outside the typed test environment.
- revalidate performs no filesystem/resolver I/O and does not call the read-only
  reconstructor from a write transaction. It verifies the original context, archive,
  release and database state, with a bounded2049-row history tail and2048-row limit.
- The caller MUST own a fresh SERIALIZABLE writable transaction and acquire all18
  source SHARE locks plus epoch/control metadata locks before its first SELECT.
  Reuse the ordered20-table MAIN_AUTHORITY_SNAPSHOT_TABLES list. pg_locks cannot establish that order
  retrospectively. The actual WorkPort must supply it before claim/profile/store reads.
- Changes to epoch state, close/gap markers or the relevant fact/witness state require
  re-preparation; an old prepared object is refused. Historical reconstruction can
  still qualify an earlier event after a later gap/close when the newly checked
  window permits it. Existing stored archive bytes are not rewritten.
- Known snapshot-fence errors map to UNAVAILABLE/SNAPSHOT_FENCE_REQUIRED. Unexpected
  programming faults still throw; there is no permissive fallback.
- Release source and loaded-runtime pins now include the snapshot wrapper, captured
  reader, archive codec and qualified reader. Old manifests missing those pins fail.

## Why gapped_at is necessary

The prior unregistered cutover candidate allowed direct GAPPED transitions without
a gap row. A later gap row could not establish when the first gap began; CLOSED
also erased the prior state. Inferring a valid earlier window from that state was unsafe.

The still-unregistered1793059200000 candidate now also adds
authorization_history_epoch.gapped_at: nullable timestamptz, no default. INSERT
requires NULL; the first GAPPED transition records the DB clock. Repeated GAPPED
and CLOSED preserve it exactly. Callers cannot supply, change or clear it. Clock
order constraints fail closed; no synthetic repair/backfill of old history.

Event T at/after this marker is unavailable, even with a later gap row or CLOSED
retirement. Earlier T may qualify only if every other history/release check passes.
STAGING gaps have no activation provenance and cannot qualify. Down is refused
after activation/gap/retirement; unused down restores the frozen predecessor.
Applied migrations and frozen predecessor bodies remain unchanged. Coordinate
these two new epoch columns with the release/ERD inventory before registration.

## Verification and review

Proof directory: SmartSiteData/runs/rea-product-references-20261018-v1/
configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1.

- Guard delta: actual8PASS/4FAIL before gapped_at, then12PASS with forge/clear/rewrite,
  exact timestamp preservation, STAGING gap, partial profiles and unused/adopted down.
  authority-control-red-v5 and authority-control-green-v7 receipts retained.
- Qualified reader: initial fixture failures retained; actual3PASS/4FAIL exposed
  the strict decoder epochId mismatch. Root repaired it and checked9cases, then
  added explicit pooled-connection error handling and exact-gap boundary coverage.
  Final11PASS include exact first-gap boundary, pooled error mapping and pending
  epoch writes. The follow-up10PASS/1FAIL reproduced missing epoch metadata fencing;
  the ordered20-table fix then passed, including refusal of an18-source-only finalizer.
  qualified-authority-red-v3/green-v7. No inference of browser acceptance.
- Affected cutover command:14PASS with expanded source/runtime pins and gap guard;
  original bearer, CAS conflict, concurrent activation, rollback, revocation,
  witness failure and resource/error boundaries. authority-cutover-service-green-v6.
- Dedicated5433 disposable schemas independently absent, prior namespace names
  unchanged after each run; not an audit of all table bytes. No retained website writes.
- Agy P7 implementation/tests and P8 guard/reviews were inspected by Root. Root
  rejected unsupported test API/field/reason assumptions, repaired the missing Zone,
  checked an actual masked subject field, and executed the checks independently.
  P7 final review's fence-error mapping concern was fixed. Its first-read lock-order
  warning remains an explicit Task3 integration requirement, not blanket acceptance.

Event-time selection now uses the unique qualified historical epoch containing the
capture time, never the current control pointer. Actual PostgreSQL follow-up:12PASS,
including a closed historical epoch, invalid/pre-baseline times and wrong Site.
Proof:qualified-authority-green-v8; owned schema absent and prior namespace names
unchanged. These synthetic mechanics do not establish operational writer closure.

Shared synthetic release setup now lives in test/support/qualified-authority-fixture.ts
(149lines); the integration journey is654lines. This retires the earlier707-line
exception without removing its history/security cases. The reader is300lines.

A genuine authority/database re-preparation error now returns the job for a new
lease and fresh preparation, rather than replaying a stale prepared handle through
SQL retries. Existing PostgreSQL serialization/deadlock retry behavior remains.
Four affected worker unit files:31PASS; two new behavioral cases were first RED.
Proof:mf06-authority-reprepare-affected-v3-proof.json. These are unit checks, not
runtime/identity or whole-flow acceptance.

## Next critical path

Original raw timestamps may contain finer precision than the immutable request's
millisecond timestamp. `main-authority-capture-time.ts` preserves up to nine decimal
digits using integer arithmetic. After qualified revalidation in the same fenced
transaction, the bridge accepts only the same millisecond with no intervening
static validity boundary, journal revision, gap, epoch close or future timestamp.
It never rewrites the archive or independently establishes coverage/identity.
An ambiguous interval remains unavailable. Actual owned-PostgreSQL checks:2PASS
after2RED for the missing capability; parser/static-boundary/SQL-result unit
checks:2PASS. Proof:capture-time-green-v1-proof.json and capture-time-unit-green-v1.log.
Unit flag checks do not prove real concurrent revision/gap races. The concrete
WorkPort must bind this helper to the original hashed raw event before appending.

The concrete private MF06 WorkPort is implemented; see mf06-workport-20261021.md.
Actual lifecycle/DI registration still requires valid configuration. Preserve lease/CAS, stable invocation, timeout/drain,
original event/media bindings, consent/profile recheck and trusted identity boundaries.
NONE/PROHIBITED can skip Face only using qualified captured policy. AUTHORIZATION_REQUIRED
cannot promote a correlated Face/profile candidate into a verified Worker.

Independent model/data/video/wearer, real identity/calibration, notification recipients,
allowed browser journeys, deployment/capacity and whole-product acceptance remain open.

## Writer review metadata repair

Root found117 reconciled review rows without fileSha256,although their actual
37 source files still match the frozen index. Reconciliation v3 now attaches each
verified index file pin and rejects conflicting supplied file/body/location pins.
All160 actual AST method bodies match the index;classifications/reasons remain
unchanged. Four adversarial metadata fixtures are rejected without writing proofs.
P5 reviewed the normalization;Root retained the conflicting-body-pin finding and
rejected requiring invented new review semantics merely to fill a derived field.

Evidence:`writer-review-reconciled-v3.json`,
`writer-pin-normalization-root-proof-v1.json`,`writer-review-conflicts-v1-proof.json`
in the proof directory above. completeWriterClosureEstablished remains false;
this repaired metadata is not an operational approval or authority activation.
