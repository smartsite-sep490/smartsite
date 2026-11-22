# Explicit first-source preparation

MF05/MF06 source setup can start with a genuinely unowned Camera. The canonical
state schema is `schemas/v1.1/source-activation-state.json`; its new example is
`examples/v1.1/source-unowned-prepared.json`.

The existing `1.0.0` PREPARED/RUNNING receipt still requires a real generation UUID.
The new `1.1.0` variant is exclusively PREPARED, LIVE, revision zero and explicit
`currentGenerationId: null`. Null never means RUNNING, permission, recovery or an
omitted owner. Unknown fields and other version/state combinations are rejected.
Every successful RUNNING result retains the original real-generation contract.

The Backend rechecks the same assigned Site Manager authority and configured
Site/Camera/host scopes before issuance. Unowned preparation calls the existing
transactional `bootstrapCameraWorkerGeneration`; an existing current, expired or
unsuperseded generation cannot be displaced. Owned preparation still uses guarded
renewal. This adds no role, table, migration, safety policy or AI-selected route.

Bootstrap is not an automatic recovery mechanism. A completed command retry can
return its confirmed RUNNING state without issuing again. If issuance succeeds
but delivery/remote commit is lost, the existing owner must remain intact and a
repeat bootstrap fails closed; operator reconciliation is required. Never create
another generation merely to make a retry succeed or substitute credentials into
pending observations.

Source RUNNING confirms the selected source lifecycle, not AI inference or worker
configuration application. A model-free capture child provides the real reference
image first. The user saves geometry/PPE, then the exact accepted configuration is
resumed through the existing generation/bundle/receipt guards. Supported devices,
exclusive resource lease, clean stop and operational readiness remain requirements
of the explicitly configured operator host.

Deployment order: merge this canonical consumer first, vendor the exact resulting
immutable Main schema/example in `smartsite-ai`, then enable its explicit unowned
producer/operator profile after paired checks. Legacy hosts and default test-only
capabilities remain unchanged. Consumer support alone does not turn on cameras,
grant access to a Site or complete deployed MF05/MF06 acceptance.
