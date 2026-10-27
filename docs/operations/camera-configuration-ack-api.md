# Camera configuration application receipts

`POST /api/v1/integrations/ai/cameras/:cameraId/configuration-ack` records a
canonical worker claim against an issued immutable bundle. It requires both the
existing AI service bearer token / camera allowlist and exactly one
`x-worker-generation-secret` header containing the credential issued to that
generation. User JWTs and the shared service token alone cannot acknowledge work.
Never send generation credentials to Web/Mobile, put them in URLs or log them.

The body follows [the canonical ACK contract](../../contracts/src/camera-configuration-ack.ts):
`commandId`, `workerGenerationId`, `streamSessionId`, `configurationVersion`,
`bundleSha256`, `viewRevision`, `outcome: LOADED|REJECTED` and optional bounded
`reasonCode` for REJECTED only. No client timestamp, camera/site override or
additional fields are accepted. The canonical payload limit is 4096 UTF-8 bytes.

Under the Camera lock, Backend reads database wall time, explicitly selects the
stored credential digest and compares it in constant time. Generation, camera,
Site and session must agree; revoked/superseded, expired or future-issued
generations fail before command replay. The Camera must still be active.

An identical command retry returns the original receipt and `replayed: true`;
changed reuse of its ID returns 409. A new receipt requires the exact issued
bundle hash/view, a still-current captured view and a version no newer than
desired or older than a prior receipt from this same generation. A new generation
does not inherit its predecessor's application. It can truthfully report an older
issued version for audit; that cannot make a newer desired version ready.

Success is HTTP 200 with `Cache-Control: no-store` and only `commandId`,
`configurationVersion`, `outcome`, server `receivedAt` and `replayed`. The stored
outcome is the worker's application claim, not a computed current readiness state.
A replay is an immutable command receipt; it is not a fresh lease or a renewed
application confirmation. A separate status reader must re-check current desired
version, generation/session, view, expiry and freshness before showing readiness.

Failures: 400 invalid canonical body; 401 missing/invalid service or generation
credential, including duplicate generation headers; 404 invalid/unlisted/unknown
Camera; 409 stale generation, inactive Camera, reused command, mismatched/unissued
bundle, retired view or version regression; 503 unavailable storage. Public error
messages do not include SQL or credentials. Existing HTTP logging omits request
headers/bodies and redacts structured secret keys; callers must not log secrets as
free text.

The server-issued generation functions and storage are described in
[worker generations](../database/camera-worker-generations.md). A trusted operator
provisioning CLI, actual worker credential injection, atomic bundle application and
ACK sender, heartbeat/lease renewal and management status UI are separate remaining
work. This route does not start inference, verify physical camera pose or establish
model accuracy, camera health or whole MF05/MF06 production acceptance.
