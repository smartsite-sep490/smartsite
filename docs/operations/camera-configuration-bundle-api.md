# Reading an issued camera configuration bundle

`GET /api/v1/integrations/ai/cameras/:cameraId/configuration-bundle` returns the
persisted `CameraConfigurationBundle` version `1.0.0`. Its canonical fields and
hash rules are defined in [the contract](../../contracts/src/camera-configuration-bundle.ts).
This is a separate route from legacy `/configuration`, whose payload is unchanged.

The caller needs the existing server-side AI service bearer token and an exact
camera entry in `AI_CONFIGURATION_CAMERA_IDS`. A user login token cannot replace
that credential. Never embed the service token in Web/Mobile code. Possessing this
read credential does not establish exclusive worker ownership or enroll a generation.

The reader uses one PostgreSQL `REPEATABLE READ` snapshot. It requires an active
camera, a stored header for the current desired configuration counter and a
matching current view. It reconstructs polygon/PPE fields from immutable revisions,
checks their authoring provenance and agreement with current desired Regions,
then validates the canonical payload/hash. Current mutable rows only detect drift;
they never replace missing immutable content. Binding/Region queries are bounded
at the versioned 64-Region limit, with one extra row to detect overflow.

| Result | Meaning                                                                   |
| ------ | ------------------------------------------------------------------------- |
| 200    | A valid issued bundle exists in that consistent snapshot                  |
| 304    | The same validated bundle matches `If-None-Match`                         |
| 401    | Missing or wrong service credential                                       |
| 404    | Invalid/unlisted camera, or unknown camera after an authorized read       |
| 409    | Camera inactive, no issued current bundle or its view was replaced        |
| 503    | Storage unavailable or inconsistent/malformed/hash-invalid stored content |

Success includes `Cache-Control: no-store` and `ETag: "sha256:<bundleSha256>"`.
Exact, weak and wildcard conditional ETags are accepted only after authorization
and the current domain read succeeds. An old ETag cannot turn an unavailable
configuration into `304`. Errors use the existing safe envelope without SQL or
connection details.

GET never issues a bundle, writes a receipt, changes configuration, captures an
image or starts inference. A `200`/`304` proves neither worker application nor
physical camera pose, image freshness, model accuracy or camera health. A concurrent
command may commit after the read snapshot; future ACK validation must compare
the enrolled generation and latest desired bundle again. Generation enrollment,
ACK persistence/readiness and runtime adoption remain separate work.
