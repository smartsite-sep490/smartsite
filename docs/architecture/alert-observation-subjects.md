# Exact observation subjects for alert evidence

Each new alert/event mapping stores the original PERSON observation index when the candidate track resolves to exactly one PERSON in that event. Two findings about one person share this reference; different people remain distinct. Missing or ambiguous PERSON observations retain a null reference. If several candidates collapse to one alert with conflicting subjects, null remains sticky.

This is technical evidence provenance, not Worker identity or cross-frame continuity. Existing grouping keys, alerts, notification delivery and review semantics remain unchanged. Legacy records are not backfilled on upgrade or replay.

The forward migration adds a nullable bounded smallint to alert_detection_mapping without adding a table. Rollback locks the table before checking and refuses to erase populated provenance. Runtime migration remains explicit; this branch does not change the website database.

Validation covers three flagged people among ten, multiple findings, duplicate tracks, event retry/hash conflict, original array ordering, history-preserving upgrade, database bounds, atomic mapping failure and guarded rollback on a disposable PostgreSQL schema. Episode grouping and revision-aware inbox are still open; this prerequisite does not establish model or product acceptance.
