# Region configuration image

This read boundary supplies a frozen reference for Region authoring. It is
separate from analyzed monitoring evidence and never starts camera capture,
inference, a tracker or a model. An explicitly owned source must already exist;
otherwise the route reports unavailable. Source lifecycle and physical camera
ownership require separate qualification before enabling capture.

## HTTP and authority

`GET /api/v1/sites/:siteId/cameras/:cameraId/configuration-image`

- Existing active global Admin only, matching Camera/Region configuration rights.
  Monitoring permissions for Site Managers and Safety Officers do not grant this
  image. Password-change-required sessions cannot use it.
- No query configuration, caller URL, source credential, redirect or cache.
- Revalidate authentication after the first camera lookup, upstream I/O and final
  camera lookup, including failure paths. Revoked identity/roles take precedence
  over upstream availability and revision conflicts.
- Match active Site/camera IDs, source external ID, allowlisted origin and camera
  configuration version before returning pixels. A revision change is409; an
  unavailable or changed source is503. Admission is one read per camera and four
  total; excess is429. These limits are bounds, not a capacity benchmark.
- Server-side upstream fetch and body budget is2s. Client defaults to3s and honors
  caller cancellation. Shutdown cancels owned reads. Ignored cancellation must
  not leave a late response body open.

## Canonical payload

The authoritative parser/types are
`@smartsite/contracts/camera-configuration-image`. Source fields are exactly
`schemaVersion:1`, `purpose:REGION_CONFIGURATION`, `sourceKind:LIVE|REPLAY`, `frame`.
Frame fields are `cameraExternalId`, `sessionId`, `sequenceNumber`, `capturedAt`,
`width`, `height`, `imageDataUrl`, `imageSha256`. The Backend adds `siteId`,
`cameraId`, `configurationVersion`, `referenceExpiresAt`. Unknown/model/detection
fields are rejected. REPLAY must remain visibly distinct from LIVE.

JSON is bounded to1,500,000 bytes. JPEG is canonical base64, at most1MiB, with
dimensions64..1280. The Backend independently hashes the decoded bytes. JPEG
marker validation is not a full decoder: the Web must decode the image and match
its natural dimensions before displaying it. Unit marker fixtures do not prove
browser-decodable pixels.

## Authoring lifetime

The image must be no more than2s old at return, with at most1s future clock skew.
The authoring reference expires at most5minutes from capture, capped against the
server clock. This does not change monitoring/evidence5s TTLs.

The editor must freeze the reference revision for both create and update. Expiry
preserves draft coordinates but disables drawing/saving until explicit reference
review. Changing image/source/revision must never silently reattach a draft.
Physical camera movement without a metadata revision is not automatically
detected; manual viewpoint review is a separate product gate.

Canonical Main contract merge precedes exact-byte AI vendoring. Do not hand-edit
vendored contracts or claim cross-repository completion from this local change.

## Verification boundary

Contract, shared-client and Backend unit/guarded HTTP tests use synthetic JPEGs
and fake source metadata. They verify software boundaries, not physical capture,
model quality, browser interaction, deployed capacity or full MF05/MF06 acceptance.
Full AppModule/PostgreSQL wiring, Web integration and source/browser qualification
must remain separately evidenced until executed.
