# Private MF06 assessment store

The store composes the canonical request/job, lease and immutable result storage.
It is private and unregistered: no controller, scheduler, evaluator, Face reader or
camera worker starts from this change. It depends on the result-storage migration.

`finalize` snapshots and validates input before awaiting, hashes the command and
uses a serializable transaction with bounded serialization/deadlock retries.
`finalizeInTransaction` requires the same DataSource and an active serializable
caller transaction; its result is provisional until that caller commits. The
caller must retry the whole transaction, including any profile/context locks.

Append checks request/Site/binding, then the current claim token, revision,
database-clock lease and deadline. A committed command replays only when its body
hash agrees. A conflicting body does not overwrite the original. Artifact and
result insertion atomically complete the job through the registered database
guards. Reads validate stored command and artifact hashes again and pin SQL to the
configured schema rather than the connection's pooled search path. Scoped private
reads exclude synthetic records; these primitives do not replace caller authorization.

The pure archive codec admits V1 and both retained exact V2 membership metadata
orders without rewriting archived bytes. It checks context, canonical digest,
closed field masks, bounded rows/bytes, timestamps and referential scope. `VALID`
explicitly retains `identityEstablished: false` and
`authorityCoverageEstablished: false`: an internally consistent archive is not
proof of a person's identity, historical permission coverage or truthful origin.
The store accepts provenance only from its future trusted internal caller; it is
not a public trust boundary.

Focused checks cover input descriptors and snapshot mutation, canonical tampering,
V1/V2 actual PostgreSQL round trips, replay/conflict, expired/wrong claims,
transaction rollback, namespace shadows and lease-to-result composition. Face
profile/consent integration remains a separate extraction with its retained cases;
this change neither loads profiles nor enables identity or runtime processing.
