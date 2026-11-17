# Tracked Camera PPE observations v1.7

This additive technical-event contract permits PPE observations with `scope: CAMERA` instead of a Region binding. Camera-scoped observations require a matching PERSON with a valid normalized bounding box. A single track cannot mix Camera and Region PPE scope in one event. Existing tracked continuity, coverage, partition, reference and duplicate-subject checks remain in force. Unknown properties and unsupported wire versions remain invalid.

Use `validateTrackedCameraPpeEvent` for this version. Older `validateTrackedEntryOriginEvent` and `validateTrackedObservationEvent` retain their version gates. Validation neither mutates input nor creates an alert: Backend still verifies worker generation, issued historical bundle, Region geometry, effective PPE policy, Site scope and idempotency before admitting/projecting evidence. The detector report is not verified identity, access authority, or proof of an actual safety violation.

The synthetic [single-person example](../examples/v1.7/one-person-camera-ppe.json) demonstrates wire shape only. It is not an issued camera configuration or an admitted production event. Runtime intake, forward migration0011, worker configuration/ACK, model quality and operational adoption are separate gates.

Canonical source must merge in the Platform repository first. Vendor exact resulting Main bytes and provenance to the AI repository afterward; do not invent a canonical SHA from this unpublished candidate. This change alone enables no worker, model or camera.
