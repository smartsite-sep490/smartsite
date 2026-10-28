# Bounded MF06 assessment orchestration

The private caller-driven worker joins the request lease and immutable store. It
does not register a Nest provider, timer, scheduler, Face resolver or camera/model
worker. Constructing it does not start processing; `runOnce` claims at most one
job and refuses overlapping calls, disabled operation and calls after drain.

Preparation runs outside the database transaction with a bounded timeout, clamped
to the claim's lease and deadline. Cancellation prevents queued preparation from
starting. Late completion or rejection of I/O that ignores the abort signal cannot
append a result or cause an unhandled rejection through the worker's race.

Finalization uses a serializable caller transaction and the same manager for
revalidation and store append. Serialization/deadlock retries repeat the whole
transaction without repeating preparation; a retryable stale authority snapshot
returns the job for fresh preparation instead. Resolver and database failures
retain separate bounded error codes. Local clock checks bound work only: the
database token/revision/lease guards remain authoritative for committed results.

Drain aborts active work and waits within its explicit bound. Cancellation before
commit rolls back the append; cancellation observed after a successful commit
cannot undo or relabel that completed result. The worker never makes an identity
or permission decision itself; its future work-port implementation must enforce
those trust boundaries.

Focused unit tests cover options, reentry, cancellation, expiry, timeouts, late
I/O and retry decisions. PostgreSQL tests cover real intake-to-claim-to-unavailable
append, prepare-once retries, retry exhaustion and drain rollback. They use owned
schemas on the dedicated test database. The retained consent-revocation integration
case belongs to the separate Face extraction. These software checks do not prove
live identity, camera processing, notification delivery or production readiness.
