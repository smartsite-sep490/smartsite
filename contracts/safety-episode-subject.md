# Event-local episode subject foundation

Status: canonical helper only. No ingestion, episode persistence, new inbox, route or notification cutover uses this helper yet.

`resolveEventLocalEpisodeSubject(eventId, observations, personObservationIndex)` returns an `EventLocalEpisodeSubject` or null. Import it from `@smartsite/contracts`.

Call only after canonical event validation, payload consistency verification and Backend source/Site/camera authorization. The helper does not replace those checks.

- The index addresses the original immutable `observations` array, not a filtered PERSON list. Preserve original order when storing and reading evidence.
- Exactly one PERSON may own the selected track. Repeated PPE observations are allowed; duplicate PERSON tracks make the association ambiguous and return null.
- Two people in one frame have separate subject references. Hat and vest evidence for one person may share that person's reference while retaining independently reviewable findings.
- A new event always creates a different event-local reference even if the track number is reused. This is not proof of cross-frame continuity or Worker identity.
- UUID case is normalized. Invalid UUID/index/track values fail closed; track zero is valid.

Current observation schemas carry no trusted tracking generation. Do not invent generation=1, infer identity from clothing, or promote this reference into a tracked subject. A future tracked contract must handle source/session ownership, reset/discontinuity, ambiguous association and verified policy/geometry context.

Do not generate one new notification per event-local reference in a live camera loop. That would produce frame-by-frame duplicates. Episode persistence and a single delivery route remain gated on reviewed continuity/admission, deduplication, permissions and migration contracts. Existing alert delivery is unchanged.

Validation: the focused contract test covers original-array indices, repeated PPE, two people, three flagged people among ten, cross-event track reuse, duplicate PERSON tracks, invalid values and immutable input. These synthetic checks do not qualify tracker accuracy or prove end-to-end notification delivery.
