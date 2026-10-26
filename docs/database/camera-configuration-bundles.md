# Immutable camera configuration bundles

`CameraConfigurationBundles1793750400000` adds two business tables after Zone
policy history. The owner ERD baseline and applied migration bytes stay unchanged.
The additive mapping is also recorded in `camera-configuration-bundles.dbml`.

| Header column         | Physical type          | Meaning                                                 |
| --------------------- | ---------------------- | ------------------------------------------------------- |
| camera_id             | uuid, required         | Composite primary key                                   |
| configuration_version | bigint, required       | Composite primary key; positive JS-safe saved counter   |
| site_id               | uuid, required         | Scope of the issued view                                |
| camera_external_id    | varchar(128), required | Exact external ID included in the hash                  |
| view_revision         | bigint, required       | Positive JS-safe captured-view revision                 |
| issued_at             | timestamptz, required  | Finite DB time round-tripped through a millisecond Date |
| bundle_sha256         | char(64), required     | Lowercase canonical SHA256                              |

| Region binding column | Physical type     | Meaning                                 |
| --------------------- | ----------------- | --------------------------------------- |
| camera_id             | uuid, required    | Composite primary key and header FK     |
| configuration_version | bigint, required  | Composite primary key and header FK     |
| region_id             | uuid, required    | Composite primary key and geometry FK   |
| geometry_version      | integer, required | Exact immutable Region revision         |
| zone_id               | uuid, required    | Scope shared by geometry and policy FKs |
| policy_revision       | bigint, required  | Exact immutable Zone policy revision    |

The header FK binds `(camera_id,view_revision,site_id)` to `camera_view_revision`.
Bindings reference the header, geometry `(region_id,geometry_version,camera_id,zone_id)`
and policy `(zone_id,policy_revision)` with RESTRICT. A supporting unique key is
added to geometry history; its rows are not rewritten. FK prefixes are indexed.
There is no bundle backfill or fabricated view. Both new tables reject UPDATE,
DELETE and TRUNCATE. Empty rollback succeeds; populated rollback refuses.

Only actual Camera/Region writes that advance the saved counter can issue a
bundle, inside the same transaction and Camera lock. The camera must be active,
have a current captured view and all active Regions confirmed on that view.
Current immutable policy must match the permanently locked linked Zone; missing
or inconsistent policy fails the command and rolls everything back. A camera
with a captured view and zero active Regions can issue an explicit empty bundle.

Reference/legacy configuration GETs never issue or recompute bundles. View
replacement preserves an old bundle; only subsequent reference-bound writes
can establish eligibility for a new saved counter. Bundles store references to
immutable polygon and PPE revisions, not duplicate polygon/PPE JSON. Reconstruct
Regions by UUID order and PPE items by lexical order; retain the recorded issue
time and external ID, then validate the canonical contract/hash again.

Saved authoring confirmation is not physical camera-pose confirmation. Issuance
does not mean a worker loaded anything, the camera is online, a model is accurate
or historical events are admitted. The legacy worker endpoint remains unchanged;
bundle delivery, enrolled worker generations and ACK/readiness are separate tasks.
No website/cloud migration or rollout is performed by this source change.
