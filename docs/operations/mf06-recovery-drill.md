# MF05/MF06 database and private-media recovery drill

This is an isolated software verification procedure, not a production restore command or acceptance. It starts no model, camera, Face service or assessment worker. Never use it against an operational database, a default/public schema or a cloud connection.

The configuration-only website state helper deliberately refuses nonempty business tables. Do not extend its seven-table allowlist and replay historical assessment rows as ordinary inserts: the immutable assessment guard requires a currently claimed lease, assigns new timestamps and finalizes the job. Completed historical state cannot be reconstructed that way.

## Profiles and prerequisites

The Backend integration test `test/integration/operational-recovery.integration.test.ts` has three profiles:

- The canonical source-registry profile uses all 59 registered migrations, including completed synthetic MF06 history, journal/consent storage, Checklist, team history and incoming MF03 attendance changes. This is the merged runtime schema.
- The opt-in MAIN profile loads the exact 35 migrations from approved commit `2e98619ac94be775ef43f4cb3076f00a59b88df1`, then request migration0001 and immutable assessment migration0004. The helper compares every snapshot source with Git and every compiled module with a fresh deterministic transpilation before importing it. This test-only list never changes production registration.
- The opt-in Linux profile uses the canonical schema and an explicitly pinned qualified Backend image. It verifies the owned container's SIGTERM shutdown separately from Windows process termination. Set `SMARTSITE_TEST_LINUX_RECOVERY_IMAGE` to the inspected immutable image ID; the test checks the image command and ownership before starting it.

All profiles require `TEST_DATABASE_URL` for the dedicated loopback `smartsite_test` user/database on port5433. Supply either `SMARTSITE_TEST_PG_BIN` pointing to an existing PostgreSQL client binary directory, or `SMARTSITE_TEST_PG_CONTAINER` containing the exact 64-character ID of the owned PG18 `postgres-test` container. The container adapter checks Compose ownership, loopback5433 binding, fake test database/account and running state; it accepts only the owned isolated-schema dump/restore arguments. It transfers the archive over stdin/stdout with bounded size and time. Do not put operational credentials in commands, committed env files or reports. The MAIN profile additionally requires `SMARTSITE_TEST_SOURCE_REPO` and `SMARTSITE_TEST_MAIN_SNAPSHOT`, both absolute paths. Missing explicit inputs produce a skipped scenario, not passing recovery evidence.

Compile tests into a fresh exclusive output, with the existing installed workspace dependencies resolvable from that output. Set `TEMP`/`TMP` to the approved task data directory on D. Never overwrite a running website's frozen Backend build or reuse another attempt's outputs. Run the compiled integration file with Node's test runner and retain the command, exit status and unredacted-secret-free result artifacts.

## What the drill verifies

1. Create and migrate one fresh file-owned `isolated_test_<32hex>` namespace; verify the dedicated URL and its resolved schema. Verify its `app_user` is a distinct relation from any public preflight fixture. The standard runner may retain frozen Legacy24 tables in public; do not migrate, clear or restore those tables as part of this drill.
2. Start actual compiled `main.js` with production configuration, no provider overrides, a synthetic account and an empty preview-source map. Create scoped configuration and two synthetic observation/evidence fixtures. These transport inputs are not AI inference or human ground truth.
3. In the MAIN profile, create a synthetic request, a claimed job, an attached authority artifact and an UNAVAILABLE assessment through the normal guards in one transaction. Verify finalization to `SUCCEEDED`, revision3 and cleared lease. The synthetic artifact declarations do not activate an epoch or prove authority writer coverage.
4. Stop the owned fixture API and wait for its terminal state before DB/media capture. On Windows this is forced quiescence, not graceful shutdown acceptance. There are no other writers to this fixture. Do not generalize this to a mixed production writer environment.
5. Produce a custom-format **logical** PostgreSQL archive of the full owned schema. Inventory every table using PostgreSQL JSON text, preserving microsecond timestamps and numeric text without JavaScript number conversion. Inventory constraint definitions/flags, indexes, sequence state, function definitions/configuration and noninternal trigger definitions/enabled states.
6. Pin the archive hash and every referenced private-media filename/hash. Copy all fixture files to a fresh private root and actually decode each with Sharp. Separately retained missing-file and changed-byte controls must fail manifest verification. JPEG marker checks alone do not prove decodability.
7. Replace only that exact freshly owned synthetic namespace after its API is terminal. Verify absence, recreate its namespace, then use `pg_restore --single-transaction --exit-on-error --no-owner --no-acl`. Schema-filtered restore does not create the namespace automatically. Data is restored before post-data trigger creation; no live trigger is disabled and no historical lease/timestamp is rewritten to satisfy an insert.
8. Compare the complete inventories before any new authentication changes session rows. Require nonempty restored MF06 assessment/artifact records in the MAIN profile. Verify completed-job state, refusal of ordinary assessment replay and refusal of assessment/artifact/job mutations, then compare inventories again to prove those attempts changed no data.
9. Start a new actual API process against the restored media. Reauthenticate and read both original private evidence images byte-for-byte; require no-store/nosniff, unauthenticated401 and cross-Site404. Synthetic assessments must remain hidden from public detail/list routes; never change provenance to make a read succeed.
10. Close the owned fixture APIs before disposing only the file-owned namespace. Retain the logical archive, media, manifest, results and failed attempts. If an owned child cannot be proven terminal, preserve the schema rather than removing it underneath a live process.

## Explicit readiness boundary

The canonical runtime registers59 migrations. The retained MAIN37 predecessor lacks 22 current migrations, including `Mf06MainAuthorityJournal1791590400002`, `SafetyFaceProvenance1791590400003` and `Mf06TeamAuthorityHistory1792281600000`; its recovery scenario requires liveness200 and readiness503 before and after restore, with the exact registered difference recorded. Both canonical recovery scenarios require readiness200. Older source24/56 results belong to their original source commits, not this registry.

This negative boundary does not qualify a production MAIN rollout. Do not stamp a missing migration, bypass readiness or register the legacy history on MAIN merely to make a probe pass. The canonical graph preserves all approved MAIN migration bodies and applies additive approved Safety migrations; existing legacy history remains preserved when upgrading a previously migrated database. Migration readiness is separate from writer closure, a trusted authority epoch and deployment acceptance.

The [merged-source qualification](2026-10-16-tuan-main-sync-merge.md#gate-nâng-cấp-db-còn-mở) separately records a populated56 Checklist-notification upgrade refusal. A successful restore of an already canonical59 fixture does not close that upgrade gate.

## Gates still open

The drill captures all tables but does not populate every business table, prove every ACL/column/type/storage/catalog property, validate a trusted authority epoch or qualify the website's full-business restoration launcher. `--no-owner --no-acl` deliberately excludes database-role and privilege recovery. The test's exact fixture scope does not authorize destructive restoration of a current website.

Coherent production backup still needs approved writer quiescence or snapshot epochs, every private root and file-reference inventory, secret-store/config/key recovery, filesystem/container permissions, retention/hold/deletion policy, missing/corrupt/revoked-media failures, restored real manual decisions and retry/replay, forward-fix migration strategy, RPO/RTO at representative volume, production readiness, deployment/TLS and browser acceptance. Keep those checklist items open. Never infer model, identity, human-data rights or whole-product acceptance from this drill.
