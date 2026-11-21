# Team membership timestamps

Removing or transferring a worker uses the PostgreSQL clock, while retaining the existing
command ownership, Site/Contractor authorization, locks, optimistic membership checks and audit.
An application clock behind the membership's join time must not make removal fail as a
membership interval constraint error.

The old interval closes at the later of `clock_timestamp()` and its stored `joined_at`, using
PostgreSQL timestamp precision. A transferred membership starts at or after that exact stored
close time. Repeated removal remains idempotent. Leader removal and concurrent winner behavior
retain their existing rules. No migration or deployment configuration change is required.

The contractor-team PostgreSQL integration scenario covers an application clock two minutes
behind the database, microsecond timestamps, ordered transfer intervals, repeated removal and
concurrent assignments. These scenarios use only synthetic fixtures in the dedicated test DB.
