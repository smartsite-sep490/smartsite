# SmartSite Safety Web/API operational release runbook

This is a release procedure and gate inventory, not authorization to deploy or evidence of production acceptance. It covers the MF05/MF06 software slice, existing authentication and configuration, immutable review records and private evidence. Mobile and camera/model execution are outside this release. AI remains paused until the human explicitly authorizes it again; a release, restart, heartbeat or recovered database never supplies that authorization.

Do not run the development Compose example against production. Its sample credentials, published development ports and HTTP Web server are not a production ingress. The current `infra/docker/nginx.conf` serves static Web files only: it does not implement HTTPS or an API reverse proxy. Hosting, TLS termination and same-origin API/private-media routing need an approved deployment configuration and actual verification before release.

## Release owner and immutable manifest

The human release owner approves the target, maintenance window, migration order, supported mixed-version window, rollback candidate, retention/hold policy and residual limitations. An operator executes only that approved scope. A second reviewer checks the manifest and recovery evidence; neither a green test nor an agent report replaces approval. Record named owners and escalation contacts in the private operational handoff, without committing credentials or personal contact details.

Every release manifest must pin:

- Backend, Web, contracts and API-client source commits, built artifact hashes and container image digests; dependency lockfile and build-tool versions. Dirty source must have a reviewed diff and explicit artifact hashes; a base commit is not its provenance.
- Ordered migration names, timestamps and source hashes, current journal, actual target identity, target schema strategy and upgrade/refusal proof. MAIN35 plus approved Safety slots is the current 39-migration source registry; legacy installations may retain additional historical entries. Never delete or stamp entries to imitate a fresh installation.
- The Web API origin and AI-paused build flag, Backend validated configuration fingerprint and secret **version references**, private-media root/storage layout, operational health path and resource limits. Exclude raw environment values, access tokens, database URLs, camera URLs and passwords.
- The exact software scope and disabled capabilities, known failures, browser/role/data-scope acceptance evidence and owner decisions. No model/identity/authority acceptance badge can be derived from configuration, class maps or passing software fixtures.

The repository Dockerfile is the production build definition. A qualification image layering compiled modules onto cached dependencies is useful Linux runtime evidence, but does not prove a complete frozen multi-stage build, dependency installation, image scanning or reproducible release. Verify those separately on the actual release artifact. Do not install, pull, provision or deploy merely to complete this document.

## Preflight and activation order

1. Inspect the exact target host/database/user/schema, current processes/container IDs, image digest, mounts and listening ports. Compare them with the approved manifest. Stop on an unknown/default schema, unexpected current writer or incompatible target; never infer ownership from a name alone. Local rehearsals are restricted to dedicated `smartsite_test` on loopback5433 and newly owned namespaces; main/demo5434 is outside their scope.
2. Capture actual current configuration and **all** relevant business/session tables plus referenced media before a lifecycle change. A mutable configuration pointer or a seven-table configuration export is insufficient for full-business recovery. Validate its digest against the current database and preserve IDs, policies, selections and recorded decisions. Prove the owner process terminal before cleanup of its disposable namespace; an observation timeout is not an exit receipt.
3. Verify an approved, coherent backup and usable forward-recovery artifact before migration. Use the reviewed [MAIN migration rollout](../docs/operations/mf06-main-migration-rollout.md); startup keeps `synchronize=false` and `migrationsRun=false`. Apply only the owner-approved migration set to the owner-approved target. Do not run populated immutable-history down migrations as a routine rollback.
4. Start the exact Backend artifact with validated `NODE_ENV=production`, no test provider/ConfigService/DataSource overrides and secrets supplied privately. Keep preview sources empty, assessment worker/enqueue disabled and all camera/model workers stopped for the software-only release. A disabled worker still requires runtime inspection; a build flag alone does not prove that no process exists.
5. Require `/api/v1/health/ready`200 before traffic; `/health/live`200 alone is insufficient. Readiness checks connectivity and the registered migration journal, not every catalog property, media blob, trusted history epoch or business invariant. An incompatible schema requires investigation/forward-fix, not a readiness bypass. Production Swagger remains unavailable.
6. Verify the actual non-root container identity, read-only media mount, traversal/read permissions and an authenticated private-evidence HTTP read with exact hash/no-store/nosniff. Check unauthenticated and wrong-Site denial and revocation during IO. A filesystem read or JPEG decode alone does not cover HTTP authorization. Never expose private roots through Web/static URLs or grant world-readable access.
7. Build Web with the approved origin and `VITE_AI_WORK_PAUSED=true`, then verify its release handshake and actual served assets. Changing server environment without rebuilding Web is not synchronization. Confirm existing login/logout/refresh/revocation, configuration drafts, pagination, error states and review permissions on an allowed browser surface. Do not bypass a browser policy denial; retain that gate as open.
8. Enable approved traffic only after target/TLS/backup/runtime/browser gates and human release signoff. Keep AI paused. Subsequent AI activation needs its own data/protocol/model/lifecycle/identity gates and explicit human authorization; it is not part of this procedure.

## Shutdown and ambiguous commands

Before a planned stop, remove the instance from traffic using the approved ingress/orchestrator procedure, preserve current state and record the exact owned process/container identity. On Linux send SIGTERM to that instance once and observe its actual termination. The Backend defaults to a bounded 27-second HTTP drain, reserving 3 seconds of the 30-second process target for final shutdown hooks/pool cleanup. This reserve does not guarantee every hook finishes in time: qualify the actual total under the intended workload. Orchestration must allow sufficient termination grace for HTTP drain plus remaining shutdown hooks/pool cleanup. Do not configure an outer stop timeout equal to the entire HTTP budget and assume pool cleanup also fits. Validate the selected grace period under the intended workload before release.

The driver currently sets `application_name=smartsite-backend`. A URL option proposing a different name does not identify its pool. Capture actual connection PIDs/start times and the owned transaction/blocking PID before stop, and verify those connections are gone afterward. A zero count for an unused tag proves nothing. Track other instances independently so a pool check cannot close their connections.

Record signal, timestamps, exit code, OOM/deadline status, listener disappearance, connection cleanup and command outcome. Windows forced termination is crash cleanup, not Linux graceful SIGTERM proof. Docker `kill --signal=SIGTERM` sends SIGTERM; do not label it SIGKILL. Conversely, helper exit137 when a client runs inside the terminated server container is not proof that PID1 was killed. Observe HTTP from an independent client when qualifying drain.

Local Compose now explicitly reserves 45s for Backend stop. The configuration regression test checks that actual rendered setting without starting containers. This is a local default with additional hook time, not a universal bound or a production ingress/orchestrator qualification. See [Compose stop grace semantics](https://docs.docker.com/reference/compose-file/services/#stop_grace_period) when mapping the approved deployment's termination settings.

For an in-flight command, verify all related rows, revision changes and audit/journal/witness records under that command's exact identity. Keep the original request/command ID and payload hash for supported idempotent operations. If a response is lost, query the authoritative outcome before retrying. Existing configuration-create routes do not all accept caller idempotency keys; do not blindly repeat a create because HTTP was interrupted. A successful short lock-wait/commit rehearsal does not prove deadline-overrun rollback, disk-full behavior or every command path.

If the process misses its deadline, preserve evidence and inspect the same instance. Never start a duplicate server, remove its schema or force-kill an unrelated process on an observation timeout. An emergency forced stop requires incident authority and a crash-recovery/command reconciliation check; report it honestly.

## Coherent database and media backup

Use the existing [database/private-media recovery drill](../docs/operations/mf06-recovery-drill.md) for **synthetic isolated verification**. Its logical schema archive, restored immutable history and authenticated media checks are bounded fixture evidence, not permission to replace a running website or proof of production roles/keys.

For operational backups, select one approved consistency method before capture:

- **Quiesced capture:** identify every database and evidence writer, drain/stop each approved writer and verify terminal/no-write state; capture database and all referenced private media while the barrier remains closed. Do not infer quiescence from a stopped API if another writer remains.
- **Coordinated snapshot:** document and verify the DB snapshot/epoch and media publication barrier that make each captured reference resolvable. PostgreSQL's consistent logical database dump alone does not synchronize an independently changing filesystem. If no implemented barrier can be proven, use approved quiescence rather than asserting consistency.

Retain a private backup manifest with archive hash, migration/catalog inventory, table fingerprints preserving timestamp/numeric precision, every referenced media file/hash/size/decode result, key/config version references, storage locations, capture boundaries and release fingerprint. Account for all configured roots; the current flat local resolver supports one root, and mounting a parent does not make nested files resolvable. Missing, corrupt or unaccounted references fail qualification.

Use the PostgreSQL client version approved for the target. Supply connection secrets through an existing private service/password file or secret-store injection, never command arguments, shell history or report output. After independently validating that the service resolves to the approved target, the logical archive command shape is:

```sh
pg_dump --dbname="service=smartsite_backup" --format=custom --file="$OwnedArchiveFile"
```

This command shape is not an executable target selection; `smartsite_backup` and the exclusive output path must already be privately configured and approved. A schema-filtered fixture dump excludes dependencies outside that schema. A whole-database logical archive still does not back up global roles, external media or secret-store keys. Preserve approved role/privilege definitions and key recovery references separately; do not dump plaintext credentials. A manifest verifier must refuse duplicate/occupied outputs and unapproved targets.

Backup frequency/RPO24h and restore RTO2h are **proposals**, not approved or measured production objectives. Obtain owner-approved values and demonstrate recovery at representative volume before reporting them achieved. Keep an encrypted, access-controlled independent recovery copy according to the approved policy; this document establishes no provider, storage purchase or retention duration.

## Restore and compatible rollback

Restore into a fresh approved isolated destination and fresh private media root. Verify source/destination identity and writer exclusion before DDL. Preserve the original backup and operational target; do not drop/recreate a current website schema because a fixture test does so.

The isolated drill uses a precreated owned namespace and:

```sh
pg_restore --dbname="service=smartsite_restore" --single-transaction --exit-on-error --no-owner --no-acl "$OwnedArchiveFile"
```

Those flags intentionally exclude role/privilege restoration. They are not a production privilege strategy. Restore historical rows with the approved archive mechanism, not ordinary application inserts that would rewrite immutable timestamps, leases or assessment state. No disabling of live guards/triggers or provenance flag flipping to make a read pass.

Before traffic, verify all required table/catalog/sequence inventories, every referenced file hash and actual decode, permissions and reviewed key versions. Then start the exact compatible artifact and prove readiness, role/Site denial, revocation, restored manual decisions, retry/replay behavior and private media over authenticated HTTP. Synthetic assessments remain synthetic and hidden under the existing contract. A restored dump is not a trusted authority epoch.

Roll back only to an artifact proven compatible with the retained current schema, configuration and record format. Prefer application rollback or an approved forward-fix migration. Do not reset the migration journal, replay a configuration-only export over business history, run populated down migrations or silently replace current media. If compatibility is unproven, keep traffic gated and escalate with the exact evidence and recovery options.

## Incident response and operational signals

The owner-approved monitoring system must watch readiness/error rate, latency and saturation, PostgreSQL pool/lock/statement failures, disk/free space, evidence missing/corrupt counts, and (only if later authorized/enabled) assessment queue age/dead letters. These are required integrations and alert policies, not implemented monitoring promises. Operational alerts are separate from MF08 business notifications; this runbook changes no Tuấn-owned module.

| Signal                                   | Immediate bounded action                                                                                                                                             | Recovery evidence required                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Ready503 / migration mismatch            | Gate traffic; inspect target, journal and redacted request-ID logs. Do not stamp migrations or repeatedly restart.                                                   | Approved compatible migration/forward-fix and actual readiness recovery.                                    |
| DB unavailable / pool or lock saturation | Inspect owned connections, query timeout/error counts and dependency availability. Cancel only specifically authorized owned work; no global pool kill.              | Target identity, healthy dependency, command reconciliation and measured latency/error recovery.            |
| Evidence missing/corrupt / disk full     | Keep affected evidence unavailable; preserve records and investigate publication/storage/permissions. Do not fabricate thumbnails or bypass hash checks.             | Coherent restore or original-byte repair, decode/hash plus scoped authenticated read/denial.                |
| Suspected secret leak                    | Restrict incident access and notify the release/security owner; never copy secrets into tickets/logs. Use approved secret rotation and session revocation workflows. | Current key versions, old-session/token refusal and restored scoped access; no unreviewed key/role changes. |
| Shutdown timeout / response lost         | Inspect the exact instance and command; preserve state, journal and safe logs. No duplicate process or blind create retry.                                           | Terminal receipt, pool cleanup and complete commit or rollback/recovery under exact command identity.       |

Log request IDs and bounded status/timing; never log bodies, raw frames/evidence, query strings, credentials, JWTs or connection URLs. The existing application sanitizes logs, but validate the deployed ingress, container collector and incident tooling as well. A known synthetic no-secret log test does not certify every future payload.

## Retention, hold and release gate

The human owner must approve record/media retention, legal hold, deletion authority, audit requirements, access, encryption/key lifecycle and storage limits. Append-only guards preserve history; they do not define lawful retention or permit infinite accumulation. Do not implement purge or alter immutable storage while this policy is unresolved. Hold-sensitive records, blobs and backup references need a reviewed coordinated procedure before deletion can be authorized.

Keep each gate separate in the release checklist: exact build/dependency provenance; MAIN/migration/role compatibility; writer cutover and trusted history; private-media authorization; coherent backup and role/key recovery; Linux idle/in-flight/deadline/crash lifecycle; actual TLS/ingress; browser/accessibility/performance/capacity; retention approval; and human release signoff. Current fixture results close only their named software cases. This document, a local commit or website completion does not accept models, wearer identity, independent accuracy or the whole SmartSite product.
