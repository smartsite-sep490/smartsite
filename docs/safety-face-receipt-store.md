# Trusted Safety Face receipt storage prototype

`appendSafetyFaceGrant` and `appendSafetyFaceRevocation` append to the existing
Safety-purpose receipt tables inside a caller-owned transaction. They read only
profile metadata and bind Site, Worker, profile revision and immutable source
record/hash. Equal retries return the original ID; conflicting reuse rejects.
Revocation preserves the original grant and can still be recorded after the
profile changes or is revoked. Encrypted templates are not read or returned.

These functions are **not registered** in HTTP or dependency injection. They do
not authenticate an operator, verify a Worker's personal confirmation, establish
that the displayed purpose text was accepted, or verify a source receipt against
its issuing system. A source hash or the hard-coded supervised method is not
proof of those things. A trusted authenticated intake must establish them before
calling. Never call directly with request-body fields or convert enrollment
consent into Safety consent. The retained purpose is `SAFETY_MF06`; this prototype
does not extend that purpose to PPE monitoring.

Transactions must roll back on failure. Serialization/deadlock errors require
retry of the whole transaction, not a partial append. The caller remains
responsible for bounded retries. Replay returns historical receipt identity,
not current eligibility; use the existing candidate/profile readers for that.

PostgreSQL tests use synthetic records in owned schemas and cover initial
ineligibility, scoped/stale rejection, identical and conflicting retry, fresh
concurrent append, revocation and post-profile-change revocation. No public
consent workflow, new permission, model, camera or live activation is included.
