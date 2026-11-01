# Tracked episode original observations and frame transport

This additive contract does not register an endpoint or enable tracked ingestion. Existing EVENT_LOCAL episode DTOs and MF08 readers are unchanged. Canonical source must be reviewed and merged before immutable Main provenance can be used for paired AI adoption.

An unregistered candidate `TrackedEpisodeFramesController` implements the bindings below and has been exercised in an isolated Nest HTTP test with real auth/session, PostgreSQL and synthetic JPEG evidence. It is absent from runtime module composition. That test does not establish production bootstrap, deployment or current website route availability.

The pure browser-safe export is `@smartsite/contracts/tracked-episode-frames`. It supplies original-observation page/media types and exact HTTP query parsers. Query parsing establishes shape only; Backend still authorizes the current account/session, Site, episode, finding and original event/PERSON mapping before and after media I/O.

## Planned HTTP binding

- `GET /sites/:siteId/safety-episodes/:id/tracked`: no query flags. Returns `TrackedEpisodeDetail`, a distinct TRACKED metadata shape with scoped technical subject, stored summary timestamps/revision/collection state and 1–256 findings. `observationCount` counts original contributor mapping rows, not unique people, video frames or notifications. A finding's initial `alertRevision` is legitimately zero; episode content revisions start at one. The response deliberately has no episode-anchor identity decision or shared evidence list. Original images/history remain on the per-finding observation/media routes below. Existing EVENT_LOCAL DTOs, detail/list/inbox and MF08 readers are unchanged; a unified list/inbox rollout is still a separate integration gate.
- `GET /sites/:siteId/safety-episodes/:id/observations`: optional `offset`, `limit` (1–20), `throughSequence`, `alertId`. Default page size is 20. Offset and limit are canonical decimal HTTP strings converted to safe integers. `throughSequence` remains canonical uint64 decimal text, including values above JavaScript's safe integer limit. Keep the returned first-page fence on subsequent pages to avoid new frames shifting the historical page.
- `GET /sites/:siteId/safety-episodes/:id/findings/:alertId/events/:eventId/frame`: required `personObservationIndex` and `evidenceIndex` (0–255), optional `representation=FRAME|SUBJECT` (default FRAME). SUBJECT is a mechanical crop of the original PERSON box, not Face identity. Responses are bounded JPEG bytes with no-store; HTTP implementation must set media headers and recheck authorization after reading. This path is a binding specification, not an active route claim.

An observation item carries original event ID, original PERSON index, payload hash, exact source sequence, capture timestamp, original PPE observation indexes and frame index/hash descriptors for one finding. Descriptors do not imply file availability; a successful authorized image read must verify bytes/SHA/dimensions. Never substitute the first episode image for a later finding, propagate the anchor's identity decision, expose local storage URIs or treat a technical segment as a Worker/team.

The page is a mapping history, so one event may appear for several findings. The total describes eligible mappings through the upper fence. Clients keep finding/event/PERSON identity together and do not deduplicate only by event ID. Server-side roles and Site scope remain authoritative; no requested query flag can enable a legacy fallback or change rights.

Unknown, duplicate-array, numeric, accessor, symbol and non-plain query fields are rejected. The shared parser does not coerce malformed HTTP values. This module has no Node/schema-loader runtime dependencies.

`parseTrackedEpisodeObservationPage` validates the exact requested episode, offset/limit, optional finding and sequence fence. It rejects unsafe or numeric sequences, contradictory counts/hasMore, duplicate mappings/indexes, unknown metadata and conflicting immutable headers for one event. Returned structures are detached from input. Frame descriptors remain evidence references, not an availability or identity assertion.

`SmartSiteManagementClient.listTrackedEpisodeObservations` uses the shared parser with a bounded 512 KiB JSON response, no-store and redirect-error transport, existing credential handling and request cancellation. This prepared client method does not activate the candidate controller or wire the feature into the current website.

`parseTrackedEpisodeDetail` binds the requested Site and episode, validates bounded distinct findings and stored technical subject metadata, rejects unsolicited identity/evidence fields and detaches the result. `SmartSiteManagementClient.getTrackedEpisode` uses it with a bounded 128 KiB no-store/redirect-error JSON read and existing session/cancellation handling. Metadata is not a claim that any referenced media is currently available, that a worker is identified, or that a technical segment grants access authority.

## Exact-observation manual identity read

The unregistered candidate `GET /sites/:siteId/safety-episodes/:id/findings/:alertId/events/:eventId/identity` takes required `personObservationIndex` and `evidenceIndex` query values from the original media source. It rejects representation flags. It rechecks the current account/session and assigned Site Safety Officer capability; Admin-only media access does not grant identity access. Responses are no-store.

`TrackedObservationIdentity` carries the exact source, original `subjectRef`, revision and nullable latest decision. No stored head returns revision zero and null; CLEAR remains an explicit cleared decision. RESOLVE is a recorded manual association for this original event/PERSON, not face recognition, a Worker profile, team membership or Zone authority. A decision on one frame never propagates to another frame in the same technical segment.

Backend binds the entire stored subject reference to the original canonical observation, including payload hash, exact timestamp text, bounding box and track ID. RESOLVE evidence must match the original FRAME index and SHA. Inconsistent persisted references/decisions fail closed. Existing identity mutation services and protected MF08 readers are unchanged.

`SmartSiteManagementClient.getTrackedObservationIdentity(token, siteId, episodeId, source, expectedPayloadHash, options?)` snapshots and validates the exact source, then validates the response against that source and expected original payload hash. It uses bounded 16 KiB JSON, no-store, redirect-error and existing session/cancellation handling. Shared parsers return detached structures and reject unexpected properties/accessors. Candidate HTTP/real PostgreSQL tests use synthetic manual-decision fixtures; they do not establish actual human identity or current website activation.

## Original frame and crop integrity

The candidate JPEG route returns `X-Smartsite-Frame-Sha256` (the original FRAME digest), `X-Smartsite-Content-Sha256` (the returned bytes' digest), and `X-Smartsite-Media-Representation` (`FRAME` or `SUBJECT`). These headers are exposed for an already CORS-allowed browser origin; this does not grant any additional origin access. The controller supplies them from the authorized reader result, never from request metadata.

`SmartSiteManagementClient.readTrackedEpisodeMedia` requires the original frame SHA from a validated history descriptor alongside the exact finding/event/PERSON/evidence source. It uses no-store, rejects redirects and streams at most 1 MiB, with bounded error bodies and existing session/timeout/cancellation handling. It checks media type, JPEG start/end signatures, declared length when present, representation and WebCrypto SHA-256 before returning a Blob. Missing digest support or binding headers fails closed. It does not perform full JPEG decoding; that and pixel/dimension checks remain in the Backend reader.

For FRAME, the returned bytes must hash to the descriptor's original SHA. For SUBJECT, the original-frame header must match that descriptor, while the returned crop bytes must hash to the separate content SHA. The crop binding is a trusted Backend assertion over HTTPS, supported by the Backend's original PERSON/provenance checks; it is not independent cryptographic proof of the crop coordinates, a Worker identity, or model accuracy. No Blob URL, fallback image or camera is created by the client method. The route remains unregistered and the current website unchanged.
