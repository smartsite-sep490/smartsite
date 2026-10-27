# Partitioned observation frames — candidate v1.4.0

Status: canonical schema/explicit validator and Backend candidate implemented locally. **Backend admission defaults closed (`AI_PARTITIONED_FRAME_ENABLED=false`); not vendored/adopted by AI or deployed.** Existing v1.0–v1.3 behavior remains unchanged. This extends v1.3 vocabulary and content-hash evidence; it does not qualify new PPE models or grant authority to identify a Worker.

Crowded frames may exceed256observations. Splitting transport events without shared frame context can invoke one Backend grouping key twice and inflate detection_count. A timestamp is not a source-frame ID. Keep each transport event bounded and retain exact part-local person/evidence references.

The v1.4 envelope adds REQUIRED `framePartition`:

| Field          | Contract                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------- |
| frameId        | lowercase UUID, stable for one exact camera/session/source sequence and all parts/retries |
| sequenceNumber | canonical decimal string, unsigned64-bit range; never convert through JavaScript Number   |
| partIndex      | integer0..1023 and less than partCount                                                    |
| partCount      | integer1..1024, immutable for the frame                                                   |

Use `validatePartitionedObservationEvent` explicitly. JSON Schema enforces shape, formats, bounded arrays and fields; the shared validator additionally enforces uint64 range, index/count relation, normalized geometry and exactly one same-part PERSON per track. Every PPE, Zone entry or identity candidate must have its PERSON in that part. Contradictory identity observations remain data for existing ambiguity handling; they do not become established identity.

Each part has its own eventId and immutable JCS payload hash. Frame metadata is included in that hash. Retain the original raw capturedAt, streamSessionId, frameDimensions, evidence SHA and part-local observation indices. No old archive is rewritten to claim frame correlation.

Before enabling the version, Backend must serialize frame admission and verify sibling camera/session/sequence/exact capturedAt/dimensions/count and part uniqueness/content. `frameId` alone is untrusted input. Repeated subject context cannot change meaning across siblings. An accepted part is not proof all parts arrived.

The candidate implementation locks both scoped frame ID and source sequence in sorted order, checks stored raw hashes and exact sibling metadata, rejects repeated subject/region groups in another part and conflicting subject/identity context, and uses existing event/mapping rows for per-frame grouping. One partial unique frame-part index and one source-sequence lookup index are added by `ObservationFrameParts1794009600000`; no new table. Historical payloads are not rewritten. Normal application writers must use admission; direct administrative SQL is not authenticated source-frame truth.

Where FRAME evidence is present, every full-frame digest within a part and across admitted siblings must agree. Part-local URIs may differ because they bind different event IDs; crops/snapshots may legitimately have different digests. A part without FRAME evidence remains admissible as unavailable media and does not acquire a usable image or safety conclusion from another part. Schema/JCS validity alone does not prove JPEG bytes; actual reads retain SHA checks.

Actual isolated PostgreSQL verification covers concurrent/reverse-order parts, unchanged retry, conflicting metadata/part receipts, same-timestamp different source frames, separate sessions/cameras, late parts after alert close, and one subject with385observations across64active regions: six alerts/count1, six scoped notifications, twelve event mappings. This is service/database evidence, not HTTP auth/browser/camera/model acceptance.

The MF06 candidate path now uses its own strict raw-event reader for enqueue. An actual isolated PostgreSQL journey verifies1.4parts → separate requests/jobs → lease/claim context → uint64-frame/subject media → honest UNAVAILABLE assessment → scoped historical frame query. Wrong Site and sibling event bindings are rejected. The temporary1.4assessment-enqueue503guard is removed from source; the general missing-enqueue-service503guard remains. This proves neither a successful AI identity/authority result nor HTTP/browser acceptance.

MF08 evidence readers and the AI producer remain on their current contracts. Keep admission off for rollout until those consumers are compatible and the paired release is verified. MF06 delivery completeness is now projected separately below; enabling admission is not an automatic production switch.

Under the grouping lock, one admitted frame/grouping key must increment once and notify only on the existing permitted lifecycle transition; every part still maps its own evidence to the result. Later parts of the same frame must not reopen a closed alert. Different frames sharing a timestamp must remain independent. Actual PostgreSQL concurrency/retry/conflict and authorized evidence/recipient tests are required before admission/rollout.

Canonical-first release: review/merge the Platform contract, then vendor the exact immutable schema bytes/provenance into AI and enable explicit producer/consumer compatibility. This document and passing validator tests are not that release or whole MF05/MF06 acceptance.

## MF06 delivery projection

MF06 assessment list/detail responses may include optional `frameDelivery`: `frameId`, exact uint64 decimal `sequenceNumber`, `partCount`, `receivedParts`, and `status` (`PARTIAL` or `COMPLETE`). Backend derives it from distinct validated persisted parts within the same camera/session/frame snapshot. It describes delivery only; assessment outcome, media availability, identity and authority remain separate. Missing metadata never means complete. Legacy responses omit this field. Publish the compatible shared contract/client before enabling partitioned producers; older strict response parsers reject the added field.

The feature branch has isolated AppModule HTTP checks for this optional projection, including scoped access and session revocation, plus separate shared-client parser tests. These do not verify an AI publisher, browser UI, deployed endpoint or model accuracy. The Backend source changes and migration are separate from publishing this contract package.
