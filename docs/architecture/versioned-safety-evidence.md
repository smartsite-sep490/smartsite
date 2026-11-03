# Versioned Safety evidence readers

Historical evidence remains authorized through the persisted Alert/Site mapping, including the absence of a conflicting mapping into another Site. Current Camera ownership cannot replace historical scope. The HTTP controller and identity-review use cases retain their existing actor/session checks; this change grants no role.

The ordinary reader for v1.2/v1.3/v1.4 checks the immutable raw payload hash and stored event/camera/session/capture-time headers, binds the URI to the source session, and compares the actual JPEG-byte SHA256 to the event declaration. Identity review keeps its expected event hash, FRAME-only and active-camera binding. A deleted Camera may leave historical images readable but does not permit active identity review.

For v1.4, URI sequence digits must exactly equal the validated canonical uint64 decimal string. No JavaScript Number conversion is used. Legacy v1.0 safe-integer URI behavior is retained. Shared admission supports v1.0/v1.1/v1.2 with coordinated five-family Backend compatibility; v1.3/v1.4 ingestion remains separate and no producer is started.

Wrong scope or unavailable media keeps the existing NOT_FOUND response; contradictory versioned raw evidence or content digest returns CONFLICT. Private filesystem checks, bounded JPEG size, symlink restrictions and generic public errors remain in force.

This supports individual historical evidence reads. It does not establish complete frame delivery, physical camera pose, Worker identity, PPE wearing, access authority or model quality. Focused tests use mock repositories and bounded JPEG-envelope byte fixtures; they do not replace PostgreSQL, image-decoder, HTTP authorization or browser acceptance.
