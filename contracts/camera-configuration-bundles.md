# Issued Camera geometry/PPE bundles — C03

`GET /integrations/ai/cameras/:cameraId/configuration-bundle` requires the existing
AI service token and Camera allowlist. It reads persisted `CameraConfigurationBundle`
1.0.0, verifies current eligibility and canonical SHA before considering ETags.
The original geometry-only `/configuration` API is unchanged. GET/304 never means
worker enrollment, application ACK, source health, pose validity or model acceptance.

Issuance runs in the transaction that advances the Camera counter. Every active
Region needs matching immutable geometry and a manual reference for the current
view. PPE comes from the same Site's retained Zone policy revision. No read-side
issuance, unknown-bundle fallback, mutable-policy recomputation or bundle backfill.
View replacement preserves old bundles but blocks their delivery until revalidation
produces a new revision. Region and PPE arrays use stable ordering.

Migrations1794441600000/1794528000000 follow Main's Zone scope unique dependency.
They add `zone_policy_revision`, `camera_configuration_bundle` and bindings in
`camera_configuration_bundle_region`. Existing Zone baselines record cutover-current
truth only. Permitted Zone create/policy edits append history atomically; no-op and
rename do not. Linked Zone policy remains locked. New override modes and policy
activation commands remain separate work.

Empty rollback/truncation is allowed; populated history is retained. Bundle/history,
Region and Camera writes commit together. Structural schema does not verify SHA,
polygon semantics or server authority; the parser additionally checks byte bounds,
hash, exact keys, Region uniqueness and geometry. Paired Python vendoring, worker
generation/ACK, UI activation and deployment need separate verification.
