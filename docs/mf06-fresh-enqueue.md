# MF06 fresh request/job creation primitive

The unregistered `Mf06EnqueueService` persists the raw event using `insertFresh`
and creates its immutable assessment request and PENDING job using `enqueueFresh`,
within the caller's same active DataSource transaction. A private receipt records
successful insertion, exact EntityManager, event ID/hash and full PostgreSQL
transaction ID and row command ID. The command ID also rejects replacement rows
after savepoint rollback. A no-op UPDATE changes `xmin`, so `xmin` cannot establish
fresh insertion. Callers that insert directly cannot create new requests through
this primitive; they may replay existing initial request IDs.

The stored event is descriptor-snapshotted, validated and checked against its
canonical hash and normalized headers before any replay. Each raw Zone-entry
index retains its same-track PERSON index, including explicit missing/ambiguous
or box-unavailable states. Current active Camera, exact Region/version and Zone/Site
are locked before new request/job creation. Those checks establish eligibility
only; they do not prove capture-time access authority or Worker identity.

The private reader supports the same retained schema versions as the existing
identity review reader, including v1.3/v1.4. This is not public event admission.
No controller, module provider, ingestion hook or activation flag is added here.
Public partitioned-frame admission remains disabled until trusted generations
and old-session outbox behavior are resolved. The later intake integration must
retain duplicate handling, atomic rollback and bounded queue admission, replacing
its raw INSERT with `insertFresh` in the same transaction before `enqueueFresh`.

Integration tests use the registered canonical storage graph in a newly owned
5433 schema. They cover replay, rejected historical backfill (including UPDATE),
exact subject/geometry binding, malformed source/hash, transaction ownership and
rollback. This primitive does not start a worker, resolve Face identity, decide
authorization, produce results/artifacts or complete the MF06 runtime flow.
