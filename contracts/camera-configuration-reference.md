# Camera authoring image and reference

The additive `configuration-image` and `configuration-reference` GET endpoints under
`/sites/:siteId/cameras/:cameraId` use the existing scoped camera configuration role.
They read an already-owned upstream source; they do not start capture or inference.
Source origins must be explicitly configured by camera external ID in
`SMARTSITE_AI_PREVIEW_SOURCES` (default `{}` denies reads). Responses are no-store.

The image contract validates bounded JPEG bytes/dimensions, digest, exact camera/Site,
LIVE/REPLAY kind, session, sequence text and a short freshness interval. The persisted
reference additionally binds an opaque UUID to its camera, Site, view revision,
configuration version, image digest, issuing actor and expiry. No raw camera address
or credential is returned. Worker generation authentication is a separate boundary.

Views begin `UNCONFIRMED`. A reference is authoring provenance, not camera-pose
confirmation, current applied geometry or worker readiness. Session/dimension changes
retain the old view and create a revision. A mismatched context read that raced a
new committed view is rejected with409; the caller must fetch a fresh image. This
optimistic check does not establish ordered capture across all devices or detect
physical camera movement.

Immutable reference/view history is kept; an empty additive migration can roll back,
but populated provenance refuses downgrade. The old image/configuration endpoints
and historical records retain their meaning. Versioned polygon writes, geometry
confirmation, policy bundles and worker acknowledgement are separate subsequent
features; do not report APPLIED or enable verified geometry from this reference alone.

Contract tests use marker-only synthetic JPEGs; service tests use fake upstream images
and PostgreSQL tests establish scoped persistence/concurrency/rollback behavior.
None proves visual decode, real camera responsiveness, pose or production acceptance.

Shared-client `getCameraConfigurationImage` and `getCameraConfigurationReference`
use a three-second default request deadline, no-store/error-on-redirect transport,
bounded JSON bodies (including failures), scoped response parsing and cancellation.
They close a discarded401 body before an existing Web-session refresh retry.
Other client methods retain their existing transport defaults.

Token-only UI consumers must handle401 directly or register/unregister their opaque
provider scope with `registerSessionCredential`/`unregisterSessionCredential` and
filter session-expiry events by that scope. New bounded image methods do not emit
unscoped global expiry events. Cookie-session adapters retain their existing
refresh/onUnauthorized behavior. This contribution does not change the Web provider
or claim that all legacy expiry events have been migrated.

## Additive storage

Migration `CameraConfigurationReferences1793491200000` adds `camera_view_revision`
(retained session/source/dimension revision, with at most one current revision per
camera) and `camera_configuration_reference` (immutable authoring image metadata and
issuing actor). It does not backfill old cameras or rewrite any previous migration.
Reference metadata is linked to the same Site/view through a composite foreign key.
This source registration requires a separate deployment/migration decision before
changing any existing website/cloud database. Empty downgrade is supported;
populated history must be preserved rather than discarded.
