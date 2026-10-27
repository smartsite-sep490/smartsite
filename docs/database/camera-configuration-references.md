# Camera authoring reference storage

Migration: `CameraConfigurationReferences1793491200000`, immediately after
`AlertDetectionSubject1793404800000` in the explicit release registry. This adds
two tables; existing baseline columns, roles, policies and geometry are unchanged.

| Table | Columns and meaning |
|---|---|
| `camera_view_revision` | `camera_id uuid`, `revision bigint` form the primary key; `site_id uuid`, `session_id uuid`, `source_kind varchar(8)`, `width integer`, `height integer`, `view_validity varchar(16)`, `is_current boolean`, `created_at timestamptz`, nullable `retired_at timestamptz` |
| `camera_configuration_reference` | `id uuid` primary key; `camera_id uuid`, `view_revision bigint`, `site_id uuid`, `session_id uuid`, `source_kind varchar(8)`, `width integer`, `height integer`, `image_sha256 char(64)`, `configuration_version bigint`, `captured_at timestamptz`, `issued_at timestamptz`, `expires_at timestamptz`, `issued_by_user_id uuid` |

Camera/Site/issuer foreign keys use `ON DELETE RESTRICT`. A reference's composite
`(camera_id,view_revision,site_id)` foreign key binds the historical context, not
today's Camera Site. Indexes cover these foreign keys, Site/expiry lookup and
the one-current-context-per-camera partial unique constraint. Revisions are
positive JavaScript-safe integers. Dimensions are 64..1280; kind is LIVE/REPLAY;
hashes are lowercase SHA256; all stored times are finite. Database checks enforce
the same capture/issue freshness and five-minute reference lifetime as the contract.

Views are always `UNCONFIRMED` in this implementation. A different session, source
kind, dimension or Site retires the previous context and allocates the next revision
under the Camera row lock. This does not prove movement, confirm a new view, or
rebind existing geometry. No network operation runs while holding SQL locks.

References are immutable: statement triggers reject UPDATE, DELETE and TRUNCATE.
View triggers reject DELETE/TRUNCATE and allow only the single current-to-retired
transition, leaving all context fields unchanged. There is no automatic TTL deletion:
expiry limits usability, not audit retention. Any later cleanup requires an explicit
retention design that protects references used by geometry or historical evidence.

Up/down require an active transaction and a five-second lock timeout. Empty rollback
locks Camera, view, then reference tables before checking. Populated rollback refuses
to discard either table's provenance; recovery must retain the records. Do not disable
triggers or edit an applied migration to force a rollback.

Validation uses disposable schemas on the dedicated PostgreSQL test database at
127.0.0.1:5433. This migration is not applied to the website/cloud by committing source.
Apply it before using the new reference endpoint. Bundle persistence, explicit view
confirmation, reference-bound polygon writes, enrolled source ownership, ACK and
historical policy resolution remain separate C03/C04 work.
