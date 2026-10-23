# Event-local episode subject foundation

Status: ingestion now uses the canonical helper to persist exact-person provenance on each new alert/event mapping. Episode persistence, new inbox/routes and notification cutover remain unimplemented.

`resolveEventLocalEpisodeSubject(eventId, observations, personObservationIndex)` returns an `EventLocalEpisodeSubject` or null. Import it from `@smartsite/contracts`.

Call only after canonical event validation, payload consistency verification and Backend source/Site/camera authorization. The helper does not replace those checks.

- The index addresses the original immutable `observations` array, not a filtered PERSON list. Preserve original order when storing and reading evidence.
- Exactly one PERSON may own the selected track. Repeated PPE observations are allowed; duplicate PERSON tracks make the association ambiguous and return null.
- Two people in one frame have separate subject references. Hat and vest evidence for one person may share that person's reference while retaining independently reviewable findings.
- A new event always creates a different event-local reference even if the track number is reused. This is not proof of cross-frame continuity or Worker identity.
- UUID case is normalized. Invalid UUID/index/track values fail closed; track zero is valid.

Current observation schemas carry no trusted tracking generation. Do not invent generation=1, infer identity from clothing, or promote this reference into a tracked subject. A future tracked contract must handle source/session ownership, reset/discontinuity, ambiguous association and verified policy/geometry context.

Do not generate one new notification per event-local reference in a live camera loop. That would produce frame-by-frame duplicates. Episode persistence and a single delivery route remain gated on reviewed continuity/admission, deduplication, permissions and migration contracts. Existing alert delivery is unchanged.

Backend stores `alert_detection_mapping.person_observation_index`, a nullable SMALLINT limited to0..255, after resolving actual evaluated candidates against the original event. The existing mapping's eventId supplies the other half of the subject reference. All candidates returning the same alertId must agree on one resolved subject; any missing/ambiguous/conflicting association stores NULL. No historical backfill occurs on migration or duplicate ingestion. An alert may span several events with different indices; never treat the alert alone as an event-local subject or assign it to a new episode based on this column.

Apply migration `AlertDetectionSubject1793404800000` before deploying the new ingestion code. Older ingestion can coexist with the additive nullable column. Reverting application code retains provenance; schema downgrade refuses to erase non-null values. This source change does not migrate the running demo or production database.

Validation: the focused contract test covers original-array indices, repeated PPE, two people, three flagged people among ten, cross-event track reuse, duplicate PERSON tracks, invalid values and immutable input. These synthetic checks do not qualify tracker accuracy or prove end-to-end notification delivery.
