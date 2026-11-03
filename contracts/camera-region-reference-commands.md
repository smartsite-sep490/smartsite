# Reference-bound Region save/reopen (MF05/MF06 C03)

Additive source transport; legacy Region routes remain available. These commands
record manual image confirmation, not physical camera pose validity, worker ACK,
model quality, access authorization or production readiness.

- `POST /sites/:siteId/cameras/:cameraId/reference-regions`: body has `zoneId`,
  `expectedConfigurationVersion`, `referenceId`, `viewRevision`,
  `confirmReferenceView: true`, and normalized `polygon.coordinates`.
- `PATCH /sites/:siteId/cameras/:cameraId/regions/:regionId/reference-polygon`:
  same body without `zoneId`.

Canonical parsers and schemas reject unknown fields, actor/time claims, unsafe
revisions and invalid polygons. Browser consumers import
`@smartsite/contracts/camera-region-reference` and
`@smartsite/contracts/camera-region-geometry-confirmation`; they do not import the
Node-dependent root barrel for runtime parsing.

Backend reauthenticates the actual Bearer token inside the transaction using
Main's AuthService and requires the exact Site Manager scope. Account/session
locks precede Camera, then existing Zone/Region locks and current view. Admin and
Safety Officer retain read access, without acquiring write permission. The absent
historical authority journal is not installed or claimed by this contribution.

An active camera, current configuration version, same-camera/Site unexpired
reference and current matching view/session/dimensions are required. One successful
save advances Camera and Region revisions, including identical-coordinate
revalidation. A later save needs a fresh reference. On conflict, keep draft points,
refresh the reference and ask for confirmation again; never automatically replay
the mutation or fall back to a legacy write. Client cancellation does not prove a
server transaction rolled back: refresh saved state before another attempt.

Success returns `{ region, configurationVersion }`. The new Region requires
`geometryConfirmation` containing `status`, `referenceId`, `viewRevision`,
`confirmedByUserId`, `confirmedAt`. SDK validates submitted Camera/Region/Zone,
reference/view, configuration increment and returned polygon/state; both bodies
are bounded and use no-store/redirect-error transport.

`UNCONFIRMED` has four null provenance fields. `MANUALLY_CONFIRMED` has all four
valid fields. A known retired view yields `NEEDS_REVALIDATION`, retaining those
fields. Reference TTL expiry does not erase historical confirmation. Read/reopen
uses one scoped batched query for exactly the loaded Region versions, rather than
the latest unrelated revision. Confirmation is optional for legacy callers.

Migration `CameraRegionGeometryRevisions1793577600000` adds retained immutable
`camera_region_geometry_revision` and composite FK scope constraints. Existing
Regions receive current-state cutover baselines with null provenance; earlier
history is not invented. Legacy polygon edits clear provenance; status changes
carry it. History append, Region, Zone link and Camera revisions commit atomically.
Empty rollback is allowed; populated history prevents rollback or truncation.
This source registration does not authorize migrating the website/cloud database.
