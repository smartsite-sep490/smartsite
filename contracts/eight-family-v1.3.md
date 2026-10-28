# Eight-family observation contract v1.3

`validateEightFamilyObservationEvent` is an explicit, version-specific library validator. It accepts schemaVersion `1.3.0` and validates schema plus cross-field bounding-box geometry. `validateObservationEvent` retains its current v1.0 admission; publishing this API does not enable Backend ingestion, alerts or model capability.

PPE families: HARD_HAT, SAFETY_VEST, GLOVES, BOOTS, GOGGLES, MASK, FULL_BODY_HARNESS and LANYARD_HOOK. Harness and hook permit only PRESENT evidence: attachment, fit and safety are not established by object visibility. Other families require explicit PRESENT/MISSING; UNKNOWN must not be emitted as a violation. Missing detections are not proof of MISSING.

Every FRAME/CROP/SNAPSHOT evidence reference requires exactly 64 lowercase hexadecimal SHA256 characters. Consumers must authorize Site scope and compare that digest with actual served bytes separately. URI/schema validity alone proves neither byte integrity nor safe storage access.

PERSON tracks and PPE observations remain technical evidence, not confirmed Worker identity or authorization. Multiple observations, including contradictory PPE statuses, may be structurally valid; business grouping and review remain downstream responsibilities. This version does not establish partition completeness or cross-camera person identity.

The schema is extracted from preserved PR61 head0d432c806b5f0e21d6d2563d6e5ec4df3025cd50. JSON formatting is normalized; parsed schema content is unchanged. Consumer adoption requires its own coordinated verification; no runtime rollout is part of this library change.
