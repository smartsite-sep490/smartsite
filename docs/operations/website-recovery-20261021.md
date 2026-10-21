# Retained local website recovery,21 October2026

Status: frozen software website restored and checked over HTTP. This is not a
rollout of the current branch, AI/MF06 acceptance or production deployment.

## Latest owner after a second observed interruption

At15:40VN both Node77284 and PostgreSQL80868 were absent,no5181/5433 listeners.
The system boot timestamp remained19October;cause/graceful shutdown are unproven.
Root restarted the verified existing5433 cluster without reset:postmaster89608,
birth15:40:34.904842VN. An owned MF06 runtime PG test then passed and disposed
only its own schema;the retained website schema was not modified by that test.

Fresh retained DB export and1726 frozen artifact pins were verified again.
Seven source pins now differ in the working branch;their exact frozen bytes
were separately recovered from Git1049789. No current source was overwritten.
Launcher v3 uses the immutable bundle root,publicDir=false,a pinned fresh owner
guard and corrected diagnostic filename filter. This is now activated.

Current Node91500,birth2026-10-21T15:42:56.595256+07:00,port5181;output
`website-software-20261021-154256-8e6238f8`. Expires2026-10-21T20:42:07.797Z
(03:42VN,22October). HTTP/login/scoped-read/logout/revoked-session checks pass;
actual counts1Site/6Zones/4Cameras/8camera_observation_region. Prior owners below
are historical. No AI,current-branch rollout,migration or configuration write.
Evidence:`website-recovery-20261021-v2/{qualification.json,http-proof-v3.json,owner-proof-v3.json}`.

## Actual failure and retained state

- At13:30VN the former Node67372 was absent and port5181 had no listener.
- No shutdown receipt exists for that run. Its cause and graceful exit are
  unproven; the recovery does not claim otherwise.
- The retained owned5433 schema still exists. A fresh read-only repeatable-read
  export verified66 migration entries and retained all captured rows/selections.
- Actual configuration counts:one Site,six Zones,four Cameras,eight Regions.
  No schema migration, configuration or permission change was performed.

## Frozen artifact recovery

Web1049789 and Backendbd91985 were restored, using their existing compiled
artifacts. The current branch's later Backend/worker changes are not deployed.
All1726 release pins were verified. Five current source files had changed;
their exact reviewed bytes were recovered separately from immutable Git1049789
and matched the recorded hashes. The working tree was not reset or overwritten.
The new recovery manifest records those paths and its parent manifest hash.

The first startup refused a Windows path-separator mismatch before creating an
output or connecting to the database. A subsequent process-owner comparison
incorrectly compared a deserialized DateTime as text; UTC ticks confirmed the
same PostgreSQL owner. Both failures are retained. Final launcher v2 started.

## Running owner and bounded verification

- Node77284,birth2026-10-21T13:39:49.145890+07:00,port5181.
- URL:http://127.0.0.1:5181/login. Existing account is retained; credentials stay
  only in the new output's local DEMO.md and private receipt.
- Expires2026-10-21T18:35:47.124Z (01:35VN,22October).
- Node heap cap256MiB; observed working set137.6MiB is one observation,not a
  total memory cap or capacity benchmark. Python/capture/inference workers:zero.
- HTTP index and entry match frozen assets; unauthenticated Sites returns401.
  Existing account login returns200,authorized Sites200,logout204,revoked session401.
- Captured startup rows and selections match the fresh pre-start export.
  Login/logout intentionally wrote session state; configuration/permissions did not change.

This uses imported AppModule/configureApplication,validated test configuration,
retained isolated PostgreSQL and loopback Vite preview. No provider overrides,
automatic migrations,AI runtime or production main bootstrap rollout.
Browser rendering remains unverified; no denied browser action was retried.

P5 independently reviewed the recovery scripts/proofs. Root retained a known v2
diagnostic filename-filter limitation; a corrected v3 is prepared but not launched
and needs fresh qualification/ownership guards. The initial HTTP count used a
wrong Region table name; the separate owner proof verifies eight actual Regions.
Root rejected requiring an old periodic-export payload hash to equal a fresh
capture:timestamps and legitimate intervening changes can differ. The actual
fresh DB export and exact startup comparison remain mandatory.

## Evidence

Root:
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1`.

- `website-recovery-20261021-v1`:qualification,frozen recovery manifest,guards,
  preserved failures,HTTP proof and exact owner proof. Private exports stay local.
- `website-software-20261021-133949-2f637bc2`:running output,configuration snapshots,
  health,private receipt and local DEMO.md. STOP preserves the retained schema.

Do not reuse either output or historical owner guard. Before further lifecycle
actions recheck exact owner/port/pins and export actual current retained state.
