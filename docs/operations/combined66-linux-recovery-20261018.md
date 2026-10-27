# Combined66 Linux runtime recovery and SIGTERM qualification

The combined Backend review carrier264b051a/tree d3700269 now has actual Linux
recovery evidence. It remains a separate candidate: the current website uses
the earlier61-migration Backend and has not been migrated or restarted here.

## Actual image and runtime

The fresh qualification image is
`sha256:bd671f8a3a824ce794ef39091cb9c6dd30d2f1b7a23527b53dc517bffd9550c6`.
It overlays exactly363 previously compiled production files and the qualified
contracts onto the pinned cached Main62 Linux dependency image. No install,
download or provider override occurred. This thin qualification image is not a
proof of the production multi-stage/frozen CI build.

Offline preflight verified all production/contract file hashes, exact dependency
versions, node user, entrypoint and66 migration registrations against the
independent reviewed inventory. Preflight used network none and connected no DB.

One existing operational-recovery test then ran only its Linux canonical case:
1 PASS/0 FAIL/0 SKIP, actual production main, isolated5433 fixture, synthetic data.
The two already-qualified Windows cases were not rerun. Native fixture compiled
bytes matched v14; private junctions resolved approved existing dependencies.
One in-memory fixture hook recorded the owned schema name without changing its
original initialization/cleanup behavior.

## Verified recovery behavior

- 90 tables and2 evidence files restored with exact row/constraint/index digests,
  functions/triggers, column types/defaults/flags and dump SHA.
- Missing/corrupt media controls were refused; authenticated private reads matched.
- Completed MF06 history, scoped Safety read/logout and manual command replay
  survived restoration; synthetic assessment history stayed suppressed.
- Three actual non-root/read-only containers exited0 after SIGTERM in416/432/496ms.
  No Windows forced-stop fallback was counted as Linux graceful shutdown.
- Independent post-check inspected exact container IDs/image/labels/exit state,
  confirmed no OOM, no published host port and read-only evidence mounts.
- Independent PostgreSQL query confirmed the owned fixture schema absent and all
  17 preexisting namespace names retained; this is not a foreign-table byte audit.

The canonical case did not exercise historical incomplete-assessment-storage
refusal; its result flag is false/not exercised, not an extra passing gate.
Dedicated5433 only; main/demo5434 and the website schema were untouched. Current
Node40548/5181 exact owner still matched after execution. No AI worker started.

## Evidence and remaining gates

Root: `D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/`
`demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/`
`main-tuan-convergence-20261018-v1/`.
Read `linux66-result-v1.json`, `linux66-image-v1/proof.json`,
`linux66-recovery-v1/test.log` and its separate namespace receipt. Dump, manifest,
synthetic media, stopped owned containers and private test inputs were retained.
Private env files must not be printed or committed.

Native frozen CI, independent integration review, adoption into the feature
branch/current website, browser/UAT, model/identity and whole product acceptance
remain open. No merge, push, cloud write or deployment was performed.
