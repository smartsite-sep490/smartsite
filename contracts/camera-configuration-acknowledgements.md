# Camera configuration acknowledgements — C03

`POST /integrations/ai/cameras/:cameraId/configuration-ack` requires the existing
service token, Camera allowlist and exactly one `x-worker-generation-secret` header.
No enrollment endpoint is exposed to a business user or shared-service-token caller.
The Backend/operator provision/revoke primitives are internal source functions.

Canonical body: commandId, workerGenerationId, streamSessionId,
configurationVersion, bundleSha256, viewRevision, outcome (LOADED or REJECTED).
Only REJECTED may include bounded reasonCode. Unknown fields, sender timestamps,
unsafe revisions, malformed identifiers/hash and bodies over4096UTF8bytes fail.

The transaction locks Camera, then checks the server-issued generation hash,
Camera/Site/session, current/terminal state and lease against database time after
the lock wait. Replay still requires a valid generation. The receipt binds an
issued immutable bundle's exact revision/hash/view; an unknown/retired view,
future or regressing revision cannot create a new effective receipt. Same command
and payload replays the original receipt; a reused command with a changed binding
conflicts. Revocation and supersession are terminal; neither is silently renewed.

Only the hash of a random32byte generation secret is stored. Default ORM reads
exclude it. Internal delivery callbacks must be bounded local credential delivery,
not remote network work under SQL locks; callback failure rolls back replacement.
Actual supervisor delivery/startup is separate work.

Migration1794614400000 follows issued-bundle storage and adds retained
camera_worker_generation and camera_configuration_application_receipt. Empty
rollback/truncation is supported; populated history cannot be discarded. Camera,
generation/session and bundle/view/hash composite foreign keys bind receipt scope.

ACK response records a worker claim with server receivedAt and replayed flag.
It does not report applicationState or prove worker atomic application, camera
pixels, physical pose, identity, authorization or model quality. Management
desired-versus-reported status, paired Python producer and runtime rollout require
their own gates. No existing website/cloud database is migrated by source changes.
