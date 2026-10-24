# MF06 camera API Region polygon archive compatibility

The actual registered worker received three HTTP events and completed three jobs, but all assessments were AUTHORITY_UNAVAILABLE; an independent actual reader returned MALFORMED_ARCHIVE.

Agy independent review caught a qualification mistake in Root's first fix/probe: synthetic seeding used `{points:[{x,y}]}`, while CameraConfigurationService validates and persists `{coordinates:[[x,y]]}` through contracts/schemas/v1/camera-region-configuration.json. The former probe only demonstrated synthetic seed mechanics, not API-configured Regions. Prior code/proof/failures remain preserved and are superseded for API compatibility.

Final fix accepts the strict API coordinates envelope (3..64 normalized tuples) plus already supported retained tuple arrays (3..256), with no transforms, archive/hash changes, new schema, policy/identity or capture-mask changes. Unsupported point-object envelopes remain rejected. The canonical positive regression also passes the actual shared camera configuration parser before seal/decode assertions. Invalid/extra/non-finite/out-of-range/oversized values remain rejected.

Final wholecodec20cases, focused TypeScript and changed-file lint pass; actual canonical API geometry worker probe remains required. Root will replay with helper geometry independently checked by the real shared parser. No live website/operational authority/model/browser acceptance follows.

Corrected canonical-geometry probe completed: authority-reviewed-release-20261022-v3/owned-worker-probe-20261022005644510-91824a5c/proof.json. The helper first passes actual parseCameraRegionConfigurationPayload with its coordinates envelope. Actualmain3HTTP202/3automaticjobs at1attempt returned NONE→ALLOWED, PROHIBITED→DENIED, AUTH_REQUIRED→IDENTITY_UNAVAILABLE, allSYNTHETIC_TEST. Tampered manifest refused startup and left pendingjob untouched. Ownschema absent and namespace names exact. No API region creation, realcamera, liveidentity, operational release or website adoption is inferred.
