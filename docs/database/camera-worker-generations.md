# Worker generation and configuration receipt storage

Release migration `CameraWorkerGenerations1793836800000` adds two empty tables.
It does not enroll any existing worker, modify previous evidence or backfill an
application claim. `synchronize` remains disabled.

`camera_worker_generation` stores ten fields: server-issued UUID, camera/site,
stream session, credential SHA-256, current flag, issued/expiry times and nullable
superseded/revoked times. Composite `(camera_id,site_id)` references the same Camera.
Only one row per camera may be current. Lease duration is explicitly supplied by
the trusted operator, from one second through 24 hours. Expiration does not delete
the row or automatically clear its current flag; a consumer must check server time.
Issued fields and already-set terminal times cannot change; reactivation, deletion
and truncation are forbidden. Supersession/revocation preserve prior rows.

`camera_configuration_application_receipt` stores thirteen fields: command UUID,
server identity order, camera/site, worker generation/session, configuration/view
versions, bundle hash, outcome/reason, canonical command hash and received time.
Composite foreign keys bind the exact generation/session and immutable issued
bundle/hash. Foreign-key lookup prefixes are indexed. Receipts are append-only;
`receipt_order` orders outcomes even when timestamps coincide. It is not a camera
configuration counter. SQL relationships alone cannot prove current generation,
lease freshness, valid credentials or actual worker application.

The supporting Camera `(id,site_id)` and bundle
`(camera_id,configuration_version,site_id,view_revision,bundle_sha256)` unique keys
are metadata additions. They do not rewrite original rows or hashes. Empty rollback
drops this extension; rollback refuses when either new table contains history.

The internal `provisionCameraWorkerGeneration` and `revokeCameraWorkerGeneration`
functions require server DataSource authority and an explicit camera allowlist.
They serialize on the existing Camera row and read `clock_timestamp()` after the
lock. Provisioning allocates a fresh generation/session and 32 random secret bytes;
only a SHA-256 digest is stored, and the plaintext is returned once to the trusted
caller. Never expose these functions as shared-token self-enrollment or a business
user endpoint, place their secret in a URL, or log/return it to the Web app.

This slice has no deployment CLI, ACK recorder/HTTP handler, application-status
reader, heartbeat renewal or worker launcher integration. Those consumers must
enforce current generation/session/expiry before replay, validate the exact issued
bundle and reject receipt regression. GET/304 and these storage tables cannot
produce a truthful `LOADED` badge by themselves. Physical pose, camera/model health
and production acceptance remain separate gates. Test schemas are isolated on 5433;
this migration has not changed the website, cloud or production database.
