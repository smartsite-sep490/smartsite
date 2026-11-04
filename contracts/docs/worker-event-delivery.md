# Generation-bound event envelope

POST `/api/v1/integrations/ai/worker-events` is the separate opt-in intake path.
The existing service token and exactly one `x-worker-generation-secret` header
authenticate the original generation. Neither credential belongs in the body,
SQLite context, raw observation or report. `AI_WORKER_BOUND_EVENT_ENABLED` and
producer CLI/manifest switches default OFF; source does not activate deployment.
`MF06_ENQUEUE_ENABLED` remains a separate default-OFF switch. Bound LIVE initial
requests use the issued immutable bundle; REVIEW_ONLY events create no automatic
initial jobs. Request, claim and candidate readers explicitly load persisted
admission and verify the original initial-request hash before preparation. The
context digest also fences changes through finalization. Bound retrospective
requests remain unavailable until their own explicit pinning contract exists.

Body: `{schemaVersion:'1.0.0',context:WorkerEventDeliveryContext,event:<original event>}`.
The strict context includes cameraId, workerGenerationId, streamSessionId,
configurationVersion, bundleSha256, viewRevision, receiptCommandId and sourceKind
LIVE/REPLAY. Event session must match. Supported observation shapes are unchanged;
partitioned events still require their own Backend feature gate. Envelope and
event share the existing 1 MiB budget. JSON Schema resolves the known context and
event versions; the parser additionally validates geometry and matching session.

Raw event JCS hash remains unchanged. Binding digest is JCS SHA256 of
`{eventPayloadHash:<raw event digest>,context:<exact original context>}`. Retries
and all frame parts retain original context. Legacy pending events must not gain
a context by using the current credential. Accepted duplicate requires both
original event and context equality; wrong-context reuse must conflict.

Fields are producer claims, not authentication, capture-time proof or permission.
Backend must check original credential, immutable LOADED receipt/bundle/view,
source kind, scope and generation state transactionally, persist admission with
raw event and resolve immutable policy. A replay or expired/superseded historical
claim cannot silently create a fresh LIVE notification from a sender timestamp.
This contract does not enable those semantics or claim deployment completion.
