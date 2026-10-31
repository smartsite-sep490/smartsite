# Safety episode ingestion routing

This is source preparation. `SAFETY_EPISODE_PROJECTION_ENABLED` defaults to `false`.
Do not enable it in an operational environment until migration, writer coordination,
and rollout are separately qualified. EVENT_LOCAL projection creates no recipient
or notification; it does not qualify tracking continuity or the full Safety flow.

## Persistence and compatibility

`SafetyEventRoutes1794873600000` adds nullable Backend-owned `safety_route_mode` and
`safety_route_epoch` to `ai_observation_event`. This is an explicit scoped ERD
extension of the existing event table, not an additional episode table. Historical
rows are not backfilled: NULL/NULL keeps legacy semantics. Route values are absent
from the AI payload and its canonical hash. Every UPDATE preserves the recorded
choice; direct SQL cannot change either column. Rollback locks the event table and
refuses to remove any explicit route history, including explicit LEGACY history.
Apply the migration before running a binary that inserts these columns. Reverting
the binary does not require removing the additive route history.

## Selection

With projection disabled, ingestion retains the existing legacy writer and records
NULL/NULL. Enabling projection requires an explicitly configured UUID
`SAFETY_EPISODE_ROUTE_EPOCH`. The Backend chooses and inserts the route in the same
transaction as the raw event, before any finding is created:

- EPISODE_EVENT_LOCAL requires a PROCESSED event, an admitted camera, nonempty PPE-only
  candidates and one unambiguous original PERSON index for every candidate.
- Partitioned physical frames and any raw ZONE_ENTRY observation retain LEGACY,
  including allowed Zone entries that produce no restricted-zone alert.
- Other ineligible events retain LEGACY. Both explicit choices record the configured
  epoch. This epoch is audit metadata, not an enforced fence between server processes.

The branches are exclusive. Episode production reserves subjects in original PERSON
order, groups canonically re-evaluated findings by episode/subtype/Zone, records the
exact mapping, then attaches findings in the owning transaction. Projection failure
returns unavailable and rolls back the event; it never falls back to legacy delivery.
Duplicate IDs preserve the committed event and route even after configuration changes.
Legacy alert IDs, keys, review states and non-Safety notifications remain unchanged.

## Remaining activation gates

- Coordinate one active writer/configuration epoch across all Backend instances; the
  persisted epoch alone does not provide this guarantee.
- Qualify the versioned continuity/reset and policy/geometry context before TRACKED
  aggregation or automatic episode notification delivery. EVENT_LOCAL is insufficient.
- Verify current recipient scope, revision inbox, single-route delivery, failure and
  rollback with actual permitted cameras before claiming a product journey.
- Keep independent detection, wearer association, identity, UI and production gates
  separate from source tests and database readiness.
