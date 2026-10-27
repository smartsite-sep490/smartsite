# Same-observation findings

Owner: Root. Baseline `deada76`. Implements C01/C04's EVENT_LOCAL evidence grouping.

Ruling: expose a read-only group for the selected alert's exact person in one immutable event.
Cross-frame episode admission remains unqualified; changing notification delivery now could
either merge different people or send one notice per frame. This slice changes neither.

## Contract and reach

`GET /sites/:siteId/safety-alerts/:alertId/detections/:eventId/findings?offset=0&limit=20`
returns `{ subject, items, total }`. Subject is EVENT_LOCAL or null. Each item contains only
alert ID, type/subtype, Zone ID, current status and revision. No Worker identity is inferred.

- Reuse current user/Safety Site guards and validate UUIDs/pagination/unknown query fields.
- Read in one repeatable-read transaction. Require the anchor alert/mapping in the Site.
- Require persisted non-null person index, canonical payload/hash/context and unique PERSON.
  Null/ambiguous/contradictory provenance returns an unresolved empty group, never a guess.
- Only include mappings with the same event and exact person index and alerts in the Site.
  An event mapped to conflicting Sites is unresolved. Never match track IDs across events.
- Preserve independent finding status/review and legacy alert history. Read-only grouping
  does not imply an alert contains exclusively this frame or establish a Worker identity.
- Shared client carries cancellation/auth/errors. Web loads only on explicit expansion;
  displays concise finding rows and opens existing individual review. No bulk confirmation.
- Hide stale findings on failed refresh or changed session/Site/event; support retry and
  explicit next-page loading. Show unknown grouping and older-server unavailability honestly.

## Checks and delivery

Use one isolated real PostgreSQL journey for three flagged subjects among ten, two findings
for one subject, pagination, legacy null, repeated track in another event, cross-Site and
ambiguous/hash-invalid data. Focused client/UI checks cover lazy loading, navigation and errors.
No migration/runtime cutover, identity change, policy/grant change or delivery change.
Requires existing migration75 provenance; older records remain unresolved, with no backfill.
