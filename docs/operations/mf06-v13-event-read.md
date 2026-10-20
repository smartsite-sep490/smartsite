# MF06 explicit v1.3 stored-event and frame reading

This private source supports reading a separately admitted immutable v1.3 event.
It does not enable ingestion, a producer, a registered worker or an identity model.
Canonical Main publication/provenance remains a separate pending step.

## Changed boundary

- MF06 owns `mf06-observation-event.ts`: v1.3 uses the explicit eight-family
  validator, while legacy versions retain the existing observation validator.
- `readConsistentMf06RawEvent` accepts an own data property for `rawPayload` and
  descriptor-snapshots its JSON before schema/hash checks. Nested or row-level
  getters are refused without execution. It matches the persisted event ID,
  camera external ID, stream session, captured time and canonical payload hash.
- Stored request inspection uses that same safe snapshot for Zone/PERSON selection
  and original captured time. Existing request/processing-status/camera checks stay.
- Frame selection admits only digest-bearing v1.2/v1.3 with the existing exact
  event/session/URI/digest/ambiguity rules. Legacy events still have no frame reference.
- Candidate finalization revalidates a consistent raw snapshot and the stored FRAME
  digest for both versions before looking up the current profile/consent. A foreign
  frame with a self-consistent crop/invocation cannot pass as that stored event.
- Shared MF08/identity event/subject/evidence files were not modified. MF08's existing
  observation validator still rejects v1.3; its rollout cannot be inferred from MF06.

## Actual bounded proof

- Root observed two failures/one pass for initial v1.3 request/getter cases, then
  four passes/one failure exposing the missing final v1.3 FRAME check.
- Agy's review identified a second raw-payload read concern. Root reproduced an
  own-property getter being accepted, refused such descriptors and revalidated the
  second raw snapshot against the persisted event hash before the version guard.
- Final 23 focused new/affected cases passed in 3.13 s, using private contracts
  compiled from local67e1aea. This is not a claim that those bytes came from Main.
- One actual canonical-70 PostgreSQL v1.3 claim case passed in 2.92 s on guarded
  dedicated5433: active lease binding, wrong token/revision refusal, unchanged job
  and request/job temporary-table shadow resistance on a single-connection pool.
- The executed test-owned schema was independently confirmed absent afterward;
  the verifier performed no deletion. Three shared ownership files' SHA values
  were independently unchanged. Compile and eight changed TypeScript files' lint
  passed. Initial failures and earlier pre-review checks remain in the evidence.

These are synthetic JSON/metadata and tiny JPEG checks, not actual Worker identity,
human consent, calibrated model accuracy, eight-family ingestion/persistence or
real camera/video/browser acceptance. Real WorkPort/authority coverage and the
producer/model/evaluation/full-flow gates remain open. No model/capture, website
restart, migration, new role, cloud write, push, merge or deployment occurred.
