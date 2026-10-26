# Camera Region revision history

`CameraRegionGeometryRevisions1793577600000` follows authoring-reference storage
in the explicit release registry. The owner's baseline ERD remains unchanged;
this additive extension has explicit TypeORM mappings.

| Column                  | PostgreSQL type       | Meaning                                                        |
| ----------------------- | --------------------- | -------------------------------------------------------------- |
| `region_id`             | uuid, required        | Region identity; primary key with `geometry_version`           |
| `geometry_version`      | integer, required     | Region version, including activation and Camera-status changes |
| `camera_id`             | uuid, required        | Camera bound to this Region                                    |
| `zone_id`               | uuid, required        | Zone bound to this Region                                      |
| `configuration_version` | bigint, required      | Saved Camera counter                                           |
| `coordinate_space`      | varchar(32), required | `NORMALIZED_0_1`                                               |
| `polygon`               | jsonb, required       | Coordinates at this version                                    |
| `is_active`             | boolean, required     | Region activation at this version                              |
| `is_cutover_baseline`   | boolean, required     | Current-state migration baseline                               |
| `reference_id`          | uuid, nullable        | Authoring reference                                            |
| `view_revision`         | bigint, nullable      | View bound to that reference                                   |
| `confirmed_by_user_id`  | uuid, nullable        | Explicit geometry confirmer                                    |
| `confirmed_at`          | timestamptz, nullable | Confirmation time                                              |
| `recorded_at`           | timestamptz, required | Database time; defaults to `clock_timestamp()`                 |

Confirmation columns are all NULL or all present. Baselines cannot have confirmation
provenance. Times are finite and confirmation cannot follow recording. Versions are
positive; configuration counters remain JavaScript-safe.

The Region/Camera/Zone composite FK prevents mismatched scope. Another composite FK
binds reference/Camera/view, with a separate confirmer FK. All use RESTRICT. Unique
keys on Region and reference support these FKs. The history primary key supports
Region/version lookup; Camera/configuration/Region uniqueness and Zone/reference/
confirmer indexes support the remaining lookups.

Existing Regions receive one current-state baseline with their actual version,
Camera counter and active state. Earlier versions and timestamps are not invented.
A baseline cannot establish permission or geometry validity before cutover.

Legacy create, polygon and activation commands append in the existing configuration
transaction. Camera-status changes record each affected active Region. No-op commands
append nothing. Polygon edits have NULL confirmation; activation/status edits carry
previous geometry confirmation when present. Current confirmation comes from the
revision matching Region.version, avoiding duplicate mutable provenance in legacy APIs.

UPDATE, DELETE and TRUNCATE are rejected. Empty rollback is supported; populated
rollback refuses to discard history. Up/down require a transaction and five-second
lock timeout, acquiring Camera before Region/history locks.

Reference-bound polygon commands, historical policy resolution, worker ACK and
physical camera-motion verification remain separate work. Roles and HTTP responses
are unchanged. Apply this migration before running the updated writer; committing
source does not change any website database.
