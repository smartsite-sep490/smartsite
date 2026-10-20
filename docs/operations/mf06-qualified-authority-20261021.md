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
  source SHARE locks before its first SELECT. pg_locks cannot establish that order
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
  Final10PASS/6.63s include exact first-gap boundary and pooled error mapping:
  qualified-authority-green-v5. No inference of browser acceptance.
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

The integration test file intentionally keeps one synthetic release/history journey
and the atomic rollback helpers together (under700lines;400-line target exceeded).
No formatting compression or security cases were removed to meet a count. Owner:
Root; split shared fixture setup if another consumer needs it. The reader is under300lines.

## Next critical path

Implement the concrete MF06 WorkPort and its actual lifecycle/DI registration only
with valid configuration. Preserve lease/CAS, stable invocation, timeout/drain,
original event/media bindings, consent/profile recheck and trusted identity boundaries.
NONE/PROHIBITED can skip Face only using qualified captured policy. AUTHORIZATION_REQUIRED
cannot promote a correlated Face/profile candidate into a verified Worker.

Independent model/data/video/wearer, real identity/calibration, notification recipients,
allowed browser journeys, deployment/capacity and whole-product acceptance remain open.
