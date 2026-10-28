# MF06 job leases

The private `Mf06JobLeaseService` claims at most one due job using PostgreSQL row
locks with SKIP LOCKED. It uses explicit bounded lease/attempt/retry options,
increments the head revision and attempt count, generates a new token and clamps
lease expiry to the original deadline. A reclaimed job receives new ownership;
an old token/revision cannot retry, fail or cancel it.

Transitions read database time after obtaining row ownership and verify expiry
again at the final write. Retry backoff starts at that write. Expiration handles
at most 100 due heads per call, preserves live leases on their final attempt and
fails closed at revision exhaustion. Abort during claim rolls back both expiry
sweep and the attempted claim.

Queue access explicitly qualifies the selected driver schema, so a pooled
session's temporary table cannot shadow the canonical permanent queue. Missing
schema and malformed options/claims fail closed.

No scheduler, module provider, worker configuration, model call or runtime
activation is added. The service does not mark jobs SUCCEEDED: that requires the
separate immutable assessment-store transaction. The original combined
lease/finalize/replay test remains reserved for that later store extraction;
lease-only tests cannot establish result, authority, identity or full-flow
acceptance.

The focused tests use explicit option checks and freshly owned schemas on the
dedicated PostgreSQL test connection. They cover concurrent ownership, stale
claims, expiry/deadline races, retry/cancellation, bounded sweeping, abort rollback
and permanent-schema access despite a temporary shadow.
