# Five-family PPE Backend compatibility

The shared observation validator admits v1.0/v1.1/v1.2. Legacy v1.0 vocabulary stays unchanged; explicit v1.3/v1.4 APIs remain separate. Zone commands accept HARD_HAT, SAFETY_VEST, GLOVES, BOOTS and GOGGLES, reject duplicates/unsupported items, and preserve existing Site Manager scope and policy-lock rules.

An explicit MISSING observation creates its matching subtype only where that item is required. PRESENT, absent observations and unsupported families do not become a missing-PPE candidate. The existing persisted-alert transaction invokes the same notification writer; active, password-ready Safety Officers at the same Site remain the only recipients. Retry/deduplication and transaction rollback semantics are retained.

The forward migration adds three allowed notification subtypes to the existing CHECK. Applied migrations are unchanged; no new table or role is created. Upgrade retains existing notification IDs/content/timestamps. Down refuses if expanded history exists rather than deleting or invalidating that history. Migration execution remains transactional and requires an explicit deployment decision.

Because shared admission now includes v1.2, ordinary and identity image readers also enforce the v1.2 declared SHA against actual bytes. Newer version compatibility cannot bypass Site/session/raw-header integrity. A valid format or notification is not proof of detection accuracy, wearing, Worker identity or safe access.

This is compatibility for the existing per-kind alert model. Multiple missing items may still yield separate legacy alerts/notifications; it is not acceptance of the planned person/episode inbox. Episode grouping, multi-Site triage and final FE remain separate open requirements. Do not roll out this intermediate slice as completion of that product flow.

Focused source tests and owned-schema PostgreSQL journeys cover policy/admission, candidate subtypes, five notification kinds, history-preserving upgrade, guarded rollback, recipient scope, retry/grouping and atomic failure recovery. Synthetic observation payloads are injected into real Backend services; no model, camera worker, HTTP auth/browser journey or production deployment is verified here.
