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
