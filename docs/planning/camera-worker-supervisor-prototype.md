# Trusted camera supervisor prototype

Owner approved source/prototype28Oct2026; this is not a deployable unattended service. Only explicit127.0.0.1:5433/smartsite_test/schema identity is admitted. No invocation on import or CLI entry point.

`superviseCameraWorker` owns one camera in the current process, serializes issue/launch/await-exit, keeps the same outbox path and uses fresh exclusive credential filenames. Maximum starts1..3; bounded default backoff. Cancellation during issuance does not launch; child cancellation stops and awaits the owned handle. Issuance/launch/cleanup uncertainty latches ownership and requires operator reconciliation, never retries blindly. No pending outbox/credential file is deleted or overwritten.

The trusted caller must supply `issue: args => provisionCameraWorker(args, issuerEnvironment)` from the existing operator script and a fixed-executable/argv child launcher. The issuer completes its existing database transaction before returning. Do not use a business/shared token to enroll generations. No real issuer binding or camera launcher is activated by these exports.

`workerChildEnvironment` builds a small system-variable allowlist plus explicit worker-scoped values, rejecting unknown supplied variables. It never inherits database URLs, issuer/admin tokens or Node/Python startup injection variables. Actual launcher must use shell:false, absolute reviewed executable/manifest and windowsHide:true, and preserve generation/outbox binding.

Current evidence: lifecycle unit controls plus an actual owned fake child without DB/model/camera. Cross-process/distributed ownership is NOT established by the process-local set. Before G4 closes: implement a single trusted host owner/fencing, concrete runtime manifest binding and issuer-confirmation adapter, qualified graceful/forced stop reporting, real isolatedPG renewal/revocation/old-generation rejection and durable replay. Native decode that never returns needs driver deadline/process supervision; this core does not invent bounded shutdown.

No camera/model activation, service installation, website/cloud DB change, role changes, Main merge or deploy. Existing Phase1 five-table drafts remain held. Prototype passes are not unattended recovery or product acceptance.
