# Immutable camera configuration bundle — transport preparation

This is a separate resource from the existing `CameraRegionConfiguration` v1.0.0
endpoint. No endpoint, persistence, policy mutation, worker admission or application
receipt is activated by these exports. The existing JSON schemas remain unchanged.

`parseCameraConfigurationBundlePayload` accepts UTF-8 JSON strings or bytes, up to
262144 bytes, and returns the existing `isValid`/`issues` result with `value` only
after successful validation.

The bundle contains exactly:

- `schemaVersion: '1.0.0'`, `cameraId`, `cameraExternalId`;
- positive safe-integer `configurationVersion` and `viewRevision`;
- server-issued `issuedAt` in canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ`;
- lowercase `bundleSha256` and `regions` (0–64 entries).

Camera, region and Zone UUIDs use lowercase canonical spelling. Each region has
the existing `regionId`, `geometryVersion`, `coordinateSpace` and `polygon`, plus
`zoneId`, positive safe-integer `policyRevision`, and `requiredPpe`. Region IDs
must be unique. Polygons use the existing normalized-coordinate, simple-polygon
validator; they do not introduce a second geometry convention.

`requiredPpe` is the resolved effective policy: a unique subset of the five
canonical `PPE_ITEMS`. An empty array is valid here. This does not authorize an
empty `EXPLICIT` policy command or cancel overlapping requirements. Required PPE
does not assert that the current model can observe it.

The checksum is the existing RFC 8785 canonical SHA256 of the complete parsed
bundle **excluding `bundleSha256`**. Array order is preserved and contributes to
the checksum. Unknown fields, malformed UTF-8, unsafe versions, duplicate IDs,
invalid dates, invalid geometry and mismatched checksums are rejected. Parser
validation does not normalize or re-sign a client-supplied bundle.

A checksum is integrity information, not authentication. Backend still must issue
and persist the camera/Site/view/policy provenance, check the requesting source
and current permissions, and match the persisted bundle. Worker `APPLIED` requires
a validated generation-bound receipt after successful application; fetching or
parsing this object is insufficient. Historical evidence must retain its original
bundle rather than resolve against current policy.

Before any Python producer/consumer or schema vending changes, publish the
canonical JSON schema with immutable Main provenance and complete the remaining
C03 persistence, reference and worker-admission steps. No new browser or API
client should activate a speculative route from this transport definition.
