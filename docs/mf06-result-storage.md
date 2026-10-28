# Immutable MF06 result and authority-artifact storage

`CanonicalMf06Results1794182400000` adds `zone_entry_assessment` and
`zone_entry_authority_artifact` against the canonical request/job tables. It uses
a fresh migration, preserves established constraint names in entity metadata and
does not replay legacy renames or change applied migrations.

Result insertion checks request/Site/event/binding and exact claimed token/head
revision with an unexpired lease/deadline. Result insertion and job SUCCEEDED
transition are atomic. Completed job heads, results and artifacts are immutable;
populated truncation or downgrade is refused. Deferred artifact attachment rejects
orphaned archives at transaction completion.

Both V1 and V2 retained archive formats use their fixed source-field masks. V2
validation is included directly rather than depending on the separate authority
journal migration. The five new functions pin their target schema before pg_temp;
migration preflight rejects temporary shadows, wrong parent namespaces and
existing legacy/canonical storage objects.

This is a private storage boundary. SQL checks archive structure/masks and
request/claim binding; it does not independently establish canonical archive SHA,
command hash, truthful provenance, Worker identity or capture-time authorization.
The separate codec/store/trusted evaluator must verify those before operational
results are accepted. No current-permission snapshot is manufactured as historical
proof, and no authority journal/writer instrumentation is added.

The registered PostgreSQL tests use synthetic UNAVAILABLE results in newly owned
5433 schemas. They cover V1/V2 round trips, atomic completion, wrong/expired claims,
scope/binding rejection, orphan rollback, immutability, namespace isolation,
metadata equivalence and empty/populated downgrade behavior. No controller, worker,
model call, website database rollout or activation is included.
