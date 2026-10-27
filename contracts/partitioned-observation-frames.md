# Partitioned observation frames v1.4

Explicit library API: `validatePartitionedObservationEvent`, with exported `ObservationFramePartition`. Existing v1.0 and explicit v1.3 admission remain unchanged. This package publication does not enable Backend ingestion or an AI producer.

A part adds required `framePartition`: lowercase UUID `frameId`, canonical decimal uint64 string `sequenceNumber`, integer `partIndex` 0..1023 and `partCount` 1..1024. Index must be smaller than count. Sequence is checked using BigInt, never converted through JavaScript Number. Each transport part retains the existing256observation bound and its own eventId/JCS hash.

Every observation track must have exactly one PERSON observation in that same part. Identity ambiguity remains evidence; a track is not a Worker. Schema plus semantic geometry remain enforced, and evidence retains required lowercase SHA256. Hashes bind part metadata as well as observations.

This validator checks one envelope. It cannot prove that siblings came from one physical frame, that all parts arrived, that a subject did not occur in multiple parts, or that retries/grouping/notifications are idempotent. Those require coordinated Backend admission under locks with exact camera/session/source sequence/raw capture time/dimensions/count, sibling hash/content and uniqueness checks. An accepted part never means COMPLETE delivery or confirmed identity.

Consumers must separately verify image bytes and Site authorization. Empty evidence is permitted and does not imply available media. Crowded-scene model accuracy, camera throughput and wearer attribution are separate gates.

Schema and validator behavior are extracted from preserved PR61 head0d432c806b5f0e21d6d2563d6e5ec4df3025cd50. The dependent Backend admission/migration, read APIs, shared client and paired AI producer remain separate pending integrations. Canonical Platform Main must be established before immutable-schema vendoring in AI; no rollout or model substitution is part of this change.
