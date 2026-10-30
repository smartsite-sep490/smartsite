# PPE requirements at a camera location

The browser-safe `@smartsite/contracts/camera-ppe-policy` subpath exports
`parseCameraPpePolicy`, `parseRegionPpePolicy` and `resolvePpePolicyAtLocation`.
Invalid parser input returns `null`; the resolver rejects invalid runtime input.

Camera default supports `EXPLICIT` (nonempty supported `requiredPpe`) or
`DISABLED` (nonblank reason, at most 500 characters). A polygon binding also
supports `INHERIT`. No containing bindings means camera-default scope. Otherwise
union each containing binding's contribution: inherited camera default, explicit
items, or empty for disabled. For example, a helmet camera default and overlapping
EXPLICIT vest + INHERIT + DISABLED bindings require helmet and vest. EXPLICIT vest
alone requires vest; DISABLED alone requires nothing in that polygon.

The resolver returns stable sorted requirements and detached contributions with
the supplied binding index and camera-default versus region source. The index is
local explanatory lineage, not a persisted binding ID or historical revision.
Backend must establish complete polygon membership, authority, immutable revision
bindings and approved disabling. Requirements are not detections or violations;
unsupported or unobservable PPE remains UNKNOWN.

This new-mode contract does not migrate legacy empty Zone requirements or modify
linked Zone PATCH, bundle v1, event contracts, access policy, runtime or database.
Camera-default findings outside polygons require their own canonical event scope;
do not create a synthetic full-frame Zone or attribute them to an arbitrary Region.
Persistence, versioned editing, worker transport and FE activation remain pending.
