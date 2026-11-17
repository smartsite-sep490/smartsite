# Optional tracked camera runtime

The Backend can stage authenticated v1.6 camera parts, recover complete frames into person episodes, and serve original evidence. This is separate from detector accuracy, Worker identity and permission decisions. Source integration does not enable camera processing or establish production readiness.

## Configuration

Both `AI_TRACKED_FRAME_RUNTIME_ENABLED` and `SAFETY_TRACKED_HISTORY_READ_ENABLED` default to `false`. `AI_TRACKED_FRAME_RUNTIME_ENABLED` registers worker intake/result routes, starts the bounded recovery timer, and also enables tracked history/media reads (`SafetyModule` enables the history reader when either `AI_TRACKED_FRAME_RUNTIME_ENABLED` or `SAFETY_TRACKED_HISTORY_READ_ENABLED` is `true`). `SAFETY_TRACKED_HISTORY_READ_ENABLED` enables tracked history/media reads alone without registering worker intake routes or starting recovery.

Enabling either requires:

- `SMARTSITE_DB_MIGRATION_PROFILE=tracked-v16` and an explicit reviewed `DATABASE_SCHEMA` (`^[a-z_][a-z0-9_]{0,62}$`, excluding `pg_*` and `information_schema`). The separately reviewed `tracked-v16-identification` profile includes this same tracked foundation plus the two optional C02 tables; see the [identification workflow guide](safety-identification-workflow.md).
- The approved target schema must already exist and contain the optional migrations (`1795046400002-WorkerEventAdmission`, `1795046400003-TrackedSubjectStorage`, `1795046400004-TrackedPendingRecoveryIndex`, and `1795046400008-TrackedWireGenerationFence`). Startup never runs migrations or enables `synchronize`.
- The runtime connection and migration CLI share `buildMigrationOptions()`, while `typeorm.data-source.ts` reads `SMARTSITE_DB_MIGRATION_PROFILE` and `DATABASE_SCHEMA` from the process environment during `db:migrate:*` runs. Connection URL `options` overrides and reserved schemas are refused.

The explicit `tracked-v16-identification-ppe` profile adds both optional C02 migration `0009` and existing Camera PPE v2 storage migration `0010` to this same foundation. Select it only for a reviewed target needing both features, and use that exact profile for CLI and runtime. It adds no unrelated MF06 historical-authority migrations, enables no AI/identification flag, and does not authorize an operational database cutover.

Enabling the runtime additionally requires a non-default service token (`>= 32` non-whitespace characters), an explicit camera allowlist, and `AI_TRACKED_FRAME_RUNTIME_POLICY`. This JSON has no implicit policy values. Its strict schema is defined in `apps/backend/src/config/tracked-runtime-environment.ts`:

| Section         | Required choices                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profile`       | `wireVersion` explicitly `1.6.0` or `1.7.0`; reviewed route epoch/profile hash; distinct lowercase allowed Camera UUIDs; capture-clock tolerance |
| `pending`       | TTL and maximum pending frame, part and payload-byte budgets                                                                                     |
| `heads`         | `FIRST_COMMITTED_CAPTURE`; capture-gap limit; positive uint64 decimal-string sequence-gap limit; segment-row budget                              |
| `recovery`      | Poll interval and maximum frames recovered per Camera per sweep                                                                                  |
| `maxRecipients` | Atomic recipient fanout cap, from 1 to 4096                                                                                                      |

The policy Camera list must be a subset of `AI_CONFIGURATION_CAMERA_IDS`. A matching profile hash is a protocol binding, not measured model quality. Choose budgets from the reviewed workload; the policy is not supplied by a browser or camera payload.

### Explicit Camera PPE wire v1.7

The opt-in `tracked-v17-identification-ppe` profile adds forward migration `0011` after the existing identification/PPE storage. Published migration `0008` remains unchanged; the forward migration checks its predecessor before widening the wire fence. CLI and runtime must select the same reviewed schema/profile. The v1.7 runtime verifies the v1.7 database fences at startup. A v1.6 runtime against this widened schema is not a supported mixed-version canary: it fails its strict v1.6 fence check. This contribution does not enable automatic fleet rollout.

Wire v1.7 adds explicit `scope: CAMERA` PPE observations, with a matching PERSON bounding box and no fabricated Region. The Backend binds them to the exact issued v2 configuration receipt and checks the subject location: Camera scope applies only outside all configured Regions. Inside a Region, its historical inherited/explicit/disabled PPE policy applies instead. Only an explicit `MISSING` observation for an item required at capture time can create a finding. An absent/unsupported detector observation never means missing PPE. Track IDs are not Worker identities or Zone access permissions.

Both projection and media qualification use the retained capture-time bundle, geometry and effective PPE policy. Later policy edits do not erase an already committed finding or reinterpret its source image. The older EVENT_LOCAL path has no issued v2 context and refuses Camera-scope PPE rather than falling back to current Region policy. Original JPEG SHA/person indices and existing per-recipient authorization still apply. Selecting the profile alone does not activate AI or C02, run migrations at startup, adopt a model, or authorize a website database cutover.

## Intake and completion

Worker requests need the service Bearer token and a single `x-worker-generation-secret` header. These credentials are distinct from user sessions and are never sent by the browser. The AI process receives no database credentials.

`POST /api/v1/integrations/ai/tracked-parts` acknowledges durable raw storage. `RAW_STORED` is not completed business processing. `GET /api/v1/integrations/ai/cameras/:cameraId/generations/:generationId/sessions/:streamSessionId/tracked-frames/:frameId/result` returns an admitted result only after the complete frame transaction commits (returning `404` while pending, missing, or unauthorized).

Recovery is single-flight and bounded per Camera. It checks the current generation and original receipts, expires pending work under the approved policy, and drains its active transaction on shutdown. The v1.6 runtime refuses startup if the selected schema or reviewed generation-wire database fences do not match.

PPE-only frames do not require MF06 queue configuration. A frame containing `ZONE_ENTRY` requires `MF06_ENQUEUE_ENABLED=true` and explicit `MF06_ENQUEUE_MAX_OUTSTANDING`. If the queue is disabled, a Region is not in the acknowledged configuration, capacity is unavailable, or an entry cannot be fully enqueued, the frame transaction rolls back. It is not silently sealed with missing Zone work. Original payload spelling/hash remains unchanged when UUID lookups are normalized.

## History and media

Tracked history remains scoped to current authenticated users and Sites (`SAFETY_OFFICER` for the Site or global `ADMIN` on `/tracked`, `/observations`, and `/frame`, with `/identity` restricted to the Site `SAFETY_OFFICER`; `EVIDENCE_LOCAL_ROOT` supplies the local JPEG root for `/frame`). Reads retain original event/person/media indices and SHA bindings, and recheck account/session/scope after media IO. A subject crop is a mechanical representation, not identity attestation. Unauthenticated requests return `401`; when both `AI_TRACKED_FRAME_RUNTIME_ENABLED` and `SAFETY_TRACKED_HISTORY_READ_ENABLED` are `false`, authenticated history/media requests return `404`.

## Verification and rollout

`GET /api/v1/me/safety-episode-inbox/frames` groups persisted recipient cases by their initial source frame within the authenticated Officer's current Site grants. Site, Camera, exact-frame and unread filters apply before pagination. Each case retains its own recipient/content revision acknowledgement; opening one case does not acknowledge the other cases in the frame. Case counts describe flagged cases, not a live camera headcount or verified Worker identities. Repeated frames update the existing subject episode rather than producing a bell per frame. Media references are supplied only when tracked history is enabled and remain subject to the history/media authorization checks.

Use the dedicated local test database and owned-schema integration harness. `TEST_DATABASE_URL` must identify the approved `smartsite_test` database on loopback port 5433; never substitute the website database, port 5434 or a hosted URL. Configuration examples are not authorization to migrate or enable a deployment.

Relevant tests include `main-tracked-http.integration.test.ts`, `tracked-episode-frames.integration.test.ts`, `main-tracked-migration-profile.integration.test.ts`, `tracked-frame-recovery.test.ts`, and `config.test.ts`. Deployment must separately rehearse the exact target migration profile, retain original evidence/history, verify capture/latency/model behavior, and prepare rollback. Disabling processing must not delete evidence or reinterpret already committed cases.
