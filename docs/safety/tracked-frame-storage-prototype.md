# C04 tracked-frame storage prototype

This source is unregistered. It does not enable v1.5 HTTP intake, a migration at startup, camera/model processing, or notification delivery. It depends on the canonical tracked-frame contract candidate in PR #133; that candidate is not yet immutable Main provenance for the AI repository.

The prototype adds one technical `ai_subject_segment` table and nullable typed fields to existing raw event storage. It preserves original event bytes, hashes, receipts, decimal uint64 sequences and original PERSON positions. Pending raw receipts do not imply a sealed frame or a business episode.

Raw staging authenticates each original receipt and retry. Server-injected limits bound pending frames, parts, payload bytes and original deadlines. Explicit bounded recovery expires orphan/predecessor work without inventing part zero or requiring an AI retry. It never changes sealed outcomes.

Technical admission checks source ordering, exact predecessor/head, scope, capture gap/rewind, forks and permanent retirement. Empty capture alone retires nobody. Explicit qualified orphan retirement creates a tombstone without a fabricated PERSON. Original raw nanoseconds govern chronology; SQL copies the original persisted capture timestamp for head references.

The required projection port runs in the same transaction as provisional seal and technical head writes. Failure rolls everything back; it is not a production business projector. Healthy/empty PostgreSQL fixtures use an explicit synthetic port. A new generation/scope stays pending until a trusted transition fence classifies old work and retires old heads.

`TrackedScopeTransition` is an unregistered Backend-control prototype for that fence. It reauthenticates a stored original coordinator against the currently issued LIVE generation/bundle/profile, checks the exact expected old scopes and explicit row bounds, and uses the same camera lock as staging/admission/expiry. It terminalizes old pending work and permanently retires old active heads atomically. Sealed coordinators and their original nonzero members stay unchanged. Original raw/context/receipt/deadline/head history stays intact. Retirement provenance names the server command and authenticated target; it does not fabricate a captured EXIT or an empty frame. A command ID is correlation only, not a durable command receipt; repeated application is state-idempotent. No worker-token endpoint or automatic call to this class is installed.

The same unregistered candidate migration adds an immutable `EVENT_LOCAL`/`TRACKED` discriminator and segment/scope reference to the existing `safety_episode` table. Existing episodes default to EVENT_LOCAL with null tracking fields. TRACKED anchors require an original sealed PERSON claim and a composite segment/scope/Site/camera FK. One segment can have only one episode; the original event/PERSON unique key remains. Tracked raw cannot enter the EVENT_LOCAL path, subject kinds cannot be rewritten, and tracked episode history cannot be deleted. This is storage support only; no healthy episode is created by technical admission and no business projector is installed. The entity columns require this migration: do not deploy this candidate entity against a database where it has not been explicitly applied. The migration remains outside the runtime registry.

## Verification scope

Meaningful tests are in `tracked-frame-parts.test.ts`, `tracked-head-plan.test.ts`, `tracked-storage-migration.test.ts`, and the four `integration/*tracked*` / subject-storage fixtures. They cover immutable retries, reverse parts, scoped bounds, deadline concurrency, predecessor recovery, original nonzero PERSON, atomic rollback, tombstones and capture rewind. Integration tests use the dedicated isolated test DataSource; never point them at website/demo or production databases.

The migration remains absent from the runtime registry. Reversal refuses tracked history. No existing raw history is backfilled as TRACKED.

## Open release gates

- Actual TRACKED episode/finding/evidence/recipient projector and scoped business storage integration.
- Integration of the trusted transition prototype with a reviewed Backend control plane, durable supervisor/scheduler and actual restart checks.
- Public raw ACK contract, reviewed canonical Main SHA and exact paired AI vendoring.
- Qualified tracker/profile, measured clock/gap/capacity policies, query plans and operational performance.
- Actual camera/browser, evidence/notification journeys and production acceptance.

`FIRST_COMMITTED_CAPTURE` and numeric policies are explicitly injected prototype choices, not qualification of unseen earlier frames. Coarse legacy raw processing status plus `TRACKED_RAW_STORED_NO_PROJECTION` must not be interpreted as business admission. Only the scoped typed state and committed transaction describe this prototype's technical outcome.
