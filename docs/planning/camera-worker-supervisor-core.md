# Camera worker supervisor core

Source/prototype scope approved on 28 October 2026. This core has no CLI, Nest provider registration, automatic startup or concrete camera launcher. Importing it does not provision credentials or start a worker.

`superviseCameraWorker` accepts only an explicitly allowlisted camera, absolute credential/outbox paths and the existing test database identity `127.0.0.1:5433/smartsite_test/<schema>`. The trusted caller supplies issuance and owned-child lifecycle ports. AI does not receive issuer or database credentials.

The core snapshots caller configuration before awaiting I/O. A change to the caller's options during issuance cannot replace the validated outbox, credential directory, database identity, lease or restart limit. Each replacement uses a fresh credential filename, retains the same outbox and awaits the previous child exit. Starts are bounded to 1–3 with backoff. The monotonic lease starts before issuance; expiration stops and awaits the owned child before another issuance. Cancellation during issuance never launches a child.

An issuance/launch/cleanup failure may leave external state uncertain. The core emits a generic reconciliation error, latches process-local ownership and does not blindly retry. A confirmed exit releases ownership. `workerChildEnvironment` permits only reviewed system/worker variables, excluding inherited DB/admin/issuer credentials and startup injection variables. This helper is not an operating-system sandbox.

Ownership is process-local. Cross-process/host fencing, a blocked issuer, an unconfirmed native process stop, durable recovery after supervisor death, private-directory ACL verification and production database admission remain unresolved operational gates. Returning `EXITED` proves process closure, not camera readiness or resource cleanup. Forced exits must remain distinguishable in the launch port.

The tests use synthetic issuance/worker ports and two owned Node echo processes. They do not connect to PostgreSQL, run Python/model/capture or establish the full event → persisted alert → evidence → notification journey. Real operator/worker adapter composition and permitted physical-camera verification remain separate work. No unattended recovery, production capacity or whole MF05/MF06 acceptance is claimed.
