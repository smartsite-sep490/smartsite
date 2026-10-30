# Bounded MF06 queue admission

`MF06_ENQUEUE_ENABLED` defaults to false. Enabling it requires an explicit whole
`MF06_ENQUEUE_MAX_OUTSTANDING` between 1 and 10000; this queues technical assessment
work and does not start an assessment worker.

The disabled intake path retains its original raw INSERT and performs no
assessment request/job SQL. The enabled path locks Camera/Region/Zone while
resolving context, performs the receipted raw INSERT in the original transaction,
then invokes queue admission before existing alert/authorization side effects.
The optional provider must exist when enabled; otherwise intake fails unavailable.

Queue admission holds a schema-wide advisory transaction lock until commit and
counts both PENDING and CLAIMED work, including expired rows. It never purges
history to obtain capacity. Lock contention or capacity failure returns the
existing unavailable error and rolls back raw event, request, job and business
side effects. An event's multiple Zone entries are accepted atomically. Duplicate
ingestion retains original event/hash conflict semantics and never backfills jobs.

Current configuration locks prevent concurrent reassignment during intake; they
do not prove capture-time authority, Worker identity or a confirmed violation.
The public partitioned-frame/generation gate remains independent. No runtime env,
website database, model, worker or deployment is changed by source integration.
