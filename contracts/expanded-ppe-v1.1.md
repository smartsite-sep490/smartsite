# Expanded PPE observation wire schema v1.1

The versioned JSON schema describes explicit PRESENT/MISSING observations for
HARD_HAT, SAFETY_VEST, GLOVES, BOOTS and GOGGLES. It preserves the v1 envelope
fields, strict bounds, region context and evidence shape, with a new version.
PPE observations have no UNKNOWN status in this wire schema. Producers must
withhold unsupported PPE conclusions and must not infer MISSING from no detection;
schema validation alone cannot enforce or prove that producer rule. Identity
candidate UNKNOWN/UNAVAILABLE states are separate and remain supported.

`validateObservationEvent` admits v1.0/v1.1/v1.2 with the coordinated five-family Backend policy, candidate, notification and evidence-reader changes. The original v1.0 vocabulary remains strict. Consumer compatibility is source behavior, not deployment or model qualification; unsupported PPE must remain UNKNOWN at the producer instead of becoming a fabricated violation.

As with v1, JSON schema validation must be combined with the existing semantic
geometry validator: numeric coordinate bounds alone do not establish x1<x2 or
y1<y2. The focused tests exercise this separation and preserved legacy v1.0 vocabulary.

The schema bytes are extracted unchanged from preserved Platform PR61 head
0d432c806b5f0e21d6d2563d6e5ec4df3025cd50. Future AI vendoring must reference the
immutable canonical Main commit after review/merge, never this feature head.
