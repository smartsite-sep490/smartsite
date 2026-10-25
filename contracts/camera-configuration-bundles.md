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

## Configuration acknowledgement — transport preparation

`parseCameraConfigurationAcknowledgementPayload` validates a proposed worker ACK
body from a JSON string or UTF-8 bytes, bounded to 4096 bytes. The root package
exports its type, parser and `MAX_CAMERA_CONFIGURATION_ACK_BYTES`. It creates no
endpoint or receipt. It does not extend the legacy configuration response.

The body contains exactly these seven fields:

```json
{
  "commandId": "11111111-2222-4333-8444-555555555551",
  "workerGenerationId": "22222222-3333-4444-8555-666666666662",
  "streamSessionId": "33333333-4444-4555-8666-777777777773",
  "configurationVersion": 3,
  "bundleSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "viewRevision": 2,
  "outcome": "LOADED"
}
```

All three UUIDs use lowercase canonical spelling, versions are positive safe
integers, and the hash is lowercase 64-character hex. `outcome` is `LOADED` or
`REJECTED`. A `REJECTED` body may additionally contain `reasonCode`, an uppercase
ASCII identifier of 1–64 characters: first character A–Z, then A–Z, 0–9 or `_`.
This is an untrusted diagnostic code, not an authorization decision or display
message. A `LOADED` body cannot contain a failure reason. Empty/null reasons,
unknown fields, unsupported outcomes, malformed JSON/UTF-8 and oversized payloads
are rejected using the existing validation issue codes.

There is no sender timestamp or `schemaVersion` in this proposed command body.
The server must record receipt time itself. The eventual endpoint/version
negotiation and canonical JSON schema must be reviewed before Python integration.

Passing this parser proves shape only. Backend still must authorize the camera,
validate the enrolled generation and stream ownership, match the issued immutable
bundle/view, enforce freshness and command idempotency, and persist the receipt.
An old or unknown generation, a hash not issued by Backend, or an older ACK cannot
advance current application state merely because its body parses. `LOADED` means
configuration installed; it does not prove camera health, a processed frame or
model quality. No application badge or worker sender is activated in this slice.

## Structural JSON schemas

The additive draft 2020-12 resources are
[`v1/camera-configuration-bundle.json`](schemas/v1/camera-configuration-bundle.json)
and [`v1/camera-configuration-ack.json`](schemas/v1/camera-configuration-ack.json).
Register the unchanged `v1/camera-region-configuration.json` locally before
compiling the bundle schema: its relative references reuse the existing source,
version, coordinate and polygon definitions. No network lookup is needed.

These schemas check structure. They cannot verify the bundle's canonical hash,
unique region IDs across differing objects, polygon area/intersection, raw UTF-8
or payload byte limits. Use the existing parsers for those checks. Tests explicitly
show schema-valid tampered hashes, duplicate IDs and invalid polygon geometry
being rejected by the bundle parser. Neither schema validates enrollment,
permissions, issuance, receipt freshness or successful application.

Schema files on a feature branch do not satisfy the immutable Main-provenance
gate. Python vending, paired producer/consumer qualification and runtime use stay
pending until the reviewed canonical Main commit is available.
