# MF06 immutable requests and operational jobs

`CanonicalMf06Requests1794096000000` adds `zone_entry_assessment_request` and
`zone_entry_assessment_job` using the canonical physical names. It does not replay
the legacy seventeen-table rename or modify an applied migration.

Requests preserve the source event/hash, observation indices, track, camera/session,
Region/version, Site/Zone, captured time, purpose and request revision. Inserts must
match the raw PERSON/ZONE_ENTRY observations. Missing, ambiguous and box-unavailable
subjects remain explicit states. Immutable bindings and referenced source payloads
cannot be rewritten; populated storage cannot be truncated or downgraded. The job
table records the operational head with bounded lease/counter/deadline fields.

The migration requires an upgrade transaction, parents in the target schema, and no
legacy/canonical storage collision. Trigger functions pin their schema before
`pg_temp`; migration operations reject temporary parent/storage shadows. Zone/Site
composite uniqueness is represented in both migration and entity metadata.

This is storage only. It adds no enqueue hook, worker, endpoint, identity assertion,
capture-time authority decision, backfill or notification. A request's Site/Zone FK
does not establish historical Camera/Region authorization. Later enqueue/worker
changes must verify that authority and use lease/CAS ownership. Partitioned-frame
activation remains gated by trusted generation and old-session outbox handling.

The integration test uses a newly owned schema on the dedicated PostgreSQL test
connection. It exercises the registered migration graph, metadata equivalence,
source binding/immutability, cross-Site rejection, job constraints, populated
downgrade refusal, shadow schemas and empty downgrade/upgrade preservation.
These checks do not authorize a website/cloud migration or establish end-to-end
AI or production acceptance.
