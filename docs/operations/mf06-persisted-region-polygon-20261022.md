# MF06 camera API Region polygon archive compatibility

The actual registered worker received three HTTP events and completed three jobs, but all assessments were AUTHORITY_UNAVAILABLE; an independent actual reader returned MALFORMED_ARCHIVE.

Agy independent review caught a qualification mistake in Root's first fix/probe: synthetic seeding used `{points:[{x,y}]}`, while CameraConfigurationService validates and persists `{coordinates:[[x,y]]}` through contracts/schemas/v1/camera-region-configuration.json. The former probe only demonstrated synthetic seed mechanics, not API-configured Regions. Prior code/proof/failures remain preserved and are superseded for API compatibility.

Final fix accepts the strict API coordinates envelope (3..64 normalized tuples) plus already supported retained tuple arrays (3..256), with no transforms, archive/hash changes, new schema, policy/identity or capture-mask changes. Unsupported point-object envelopes remain rejected. The canonical positive regression also passes the actual shared camera configuration parser before seal/decode assertions. Invalid/extra/non-finite/out-of-range/oversized values remain rejected.

Final wholecodec20cases, focused TypeScript and changed-file lint pass; actual canonical API geometry worker probe remains required. Root will replay with helper geometry independently checked by the real shared parser. No live website/operational authority/model/browser acceptance follows.
