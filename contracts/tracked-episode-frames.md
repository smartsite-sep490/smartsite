# Tracked episode original observations and frame transport

This additive contract does not register an endpoint or enable tracked ingestion. Existing EVENT_LOCAL episode DTOs and MF08 readers are unchanged. Canonical source must be reviewed and merged before immutable Main provenance can be used for paired AI adoption.

An unregistered candidate `TrackedEpisodeFramesController` implements the bindings below and has been exercised in an isolated Nest HTTP test with real auth/session, PostgreSQL and synthetic JPEG evidence. It is absent from runtime module composition. That test does not establish production bootstrap, deployment or current website route availability.

The pure browser-safe export is `@smartsite/contracts/tracked-episode-frames`. It supplies original-observation page/media types and exact HTTP query parsers. Query parsing establishes shape only; Backend still authorizes the current account/session, Site, episode, finding and original event/PERSON mapping before and after media I/O.

## Planned HTTP binding

- `GET /sites/:siteId/safety-episodes/:id/observations`: optional `offset`, `limit` (1–20), `throughSequence`, `alertId`. Default page size is 20. Offset and limit are canonical decimal HTTP strings converted to safe integers. `throughSequence` remains canonical uint64 decimal text, including values above JavaScript's safe integer limit. Keep the returned first-page fence on subsequent pages to avoid new frames shifting the historical page.
- `GET /sites/:siteId/safety-episodes/:id/findings/:alertId/events/:eventId/frame`: required `personObservationIndex` and `evidenceIndex` (0–255), optional `representation=FRAME|SUBJECT` (default FRAME). SUBJECT is a mechanical crop of the original PERSON box, not Face identity. Responses are bounded JPEG bytes with no-store; HTTP implementation must set media headers and recheck authorization after reading. This path is a binding specification, not an active route claim.

An observation item carries original event ID, original PERSON index, payload hash, exact source sequence, capture timestamp, original PPE observation indexes and frame index/hash descriptors for one finding. Descriptors do not imply file availability; a successful authorized image read must verify bytes/SHA/dimensions. Never substitute the first episode image for a later finding, propagate the anchor's identity decision, expose local storage URIs or treat a technical segment as a Worker/team.

The page is a mapping history, so one event may appear for several findings. The total describes eligible mappings through the upper fence. Clients keep finding/event/PERSON identity together and do not deduplicate only by event ID. Server-side roles and Site scope remain authoritative; no requested query flag can enable a legacy fallback or change rights.

Unknown, duplicate-array, numeric, accessor, symbol and non-plain query fields are rejected. The shared parser does not coerce malformed HTTP values. This module has no Node/schema-loader runtime dependencies.

`parseTrackedEpisodeObservationPage` validates the exact requested episode, offset/limit, optional finding and sequence fence. It rejects unsafe or numeric sequences, contradictory counts/hasMore, duplicate mappings/indexes, unknown metadata and conflicting immutable headers for one event. Returned structures are detached from input. Frame descriptors remain evidence references, not an availability or identity assertion.

`SmartSiteManagementClient.listTrackedEpisodeObservations` uses the shared parser with a bounded 512 KiB JSON response, no-store and redirect-error transport, existing credential handling and request cancellation. This prepared client method does not activate the candidate controller or wire the feature into the current website.

## Original frame and crop integrity

The candidate JPEG route returns `X-Smartsite-Frame-Sha256` (the original FRAME digest), `X-Smartsite-Content-Sha256` (the returned bytes' digest), and `X-Smartsite-Media-Representation` (`FRAME` or `SUBJECT`). These headers are exposed for an already CORS-allowed browser origin; this does not grant any additional origin access. The controller supplies them from the authorized reader result, never from request metadata.

`SmartSiteManagementClient.readTrackedEpisodeMedia` requires the original frame SHA from a validated history descriptor alongside the exact finding/event/PERSON/evidence source. It uses no-store, rejects redirects and streams at most 1 MiB, with bounded error bodies and existing session/timeout/cancellation handling. It checks media type, JPEG start/end signatures, declared length when present, representation and WebCrypto SHA-256 before returning a Blob. Missing digest support or binding headers fails closed. It does not perform full JPEG decoding; that and pixel/dimension checks remain in the Backend reader.

For FRAME, the returned bytes must hash to the descriptor's original SHA. For SUBJECT, the original-frame header must match that descriptor, while the returned crop bytes must hash to the separate content SHA. The crop binding is a trusted Backend assertion over HTTPS, supported by the Backend's original PERSON/provenance checks; it is not independent cryptographic proof of the crop coordinates, a Worker identity, or model accuracy. No Blob URL, fallback image or camera is created by the client method. The route remains unregistered and the current website unchanged.
