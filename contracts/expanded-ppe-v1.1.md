# Expanded PPE observation wire schema v1.1

The versioned JSON schema describes explicit PRESENT/MISSING observations for
HARD_HAT, SAFETY_VEST, GLOVES, BOOTS and GOGGLES. It preserves the v1 envelope,
strict fields, region/version context and evidence shape. UNKNOWN is represented
by withholding a supported conclusion, not by inferring MISSING from no detection.

This change publishes the schema asset and its validation checks only. The
existing validateObservationEvent runtime still admits v1.0 only. No Backend
consumer, notification CHECK, model, worker or deployment is enabled here.
Unsupported consumer versions must remain rejected until their coordinated
admission/business changes are reviewed. The schema is a technical wire format,
not proof that a model can determine whether a person wears an item.

As with v1, JSON schema validation must be combined with the existing semantic
geometry validator: numeric coordinate bounds alone do not establish x1<x2 or
y1<y2. The focused tests exercise this separation and unchanged legacy admission.

The schema bytes are extracted unchanged from preserved Platform PR61 head
0d432c806b5f0e21d6d2563d6e5ec4df3025cd50. Future AI vendoring must reference the
immutable canonical Main commit after review/merge, never this feature head.
