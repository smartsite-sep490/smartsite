# Tuấn storage naming — isolated PostgreSQL qualification

## Decision and source

On 18 October 2026 the owner approved exactly the 17 proposed table names and
rehearsal on dedicated test PostgreSQL5433. This permits fresh/upgrade/refusal/
preservation tests in newly owned schemas. It does not permit migration of the
website schema, a branch merge, push, deployment or AI execution.

Root baseline: `7088a0d428cf37d4f63ae4b70001c585005e401f`.
Tuấn implementation: `9b960e6aaf98319ad9db6bf534ce296f6e99d883`;
the later handoff tip is `daafc340b9947a264cc8e6fcb146d7b5b2c5e5de`.
Tested corrected virtual tree: `a1ceb922e5867ab230f48be73497619e60810cc3`,
with all 1,332 source files SHA256-verified before execution. No application
bytes were merged into the Root branch. Current Main `eb56d141` is a separate
integration baseline; these results do not qualify its later changes.

## Actual result

**42 distinct successful cases across separate runs**, not a single full42 run:

| Suite/profile                                                                   | Successful cases | Evidence                |
| ------------------------------------------------------------------------------- | ---------------: | ----------------------- |
| Physical names, preservation, collision, tamper and old-writer refusal          |                7 | `naming-v1`             |
| Canonical fresh, populated release54 and legacy24                               |                3 | `canonical65-v1`        |
| Populated Main35 with exact historical Git/transpiled snapshot                  |                1 | `canonical65-main35-v2` |
| New canonical capture/history, timing, gaps and unavailable boundaries          |               10 | `captured-state-v3`     |
| Populated forward-only down refusal                                             |                1 | `down-refusal-v1`       |
| Canonical assessment append/finalize/replay, concurrency and consent boundaries |               20 | `assessment-store-v1`   |

The fresh/current graph contains65 migrations. The legacy24 upgrade retains one
additional historical migration identity. Existing data, object identities,
journal prefix and replay are checked by the relevant preservation tests.
Capture reconstruction deliberately does not establish trusted coverage, READY
or identity. Assessment/profile tests use synthetic metadata, not live AI/Face.

The physical migration is **forward-only**. Its `down` explicitly refuses and
the populated-state test verifies rows, relation identities and migration
journal remain unchanged. Failed `up` transactions roll back on collision or
tampered functions. This is not a successful inverse rename or backup recovery.

## Execution and failures retained

- Full fresh Backend compilation exhausted both256MiB and512MiB heaps, exit134.
  No claim of a fresh full compile or native frozenCI is made.
- Narrow owning-suite compilation succeeded at512MiB, including the actual65
  migration graph. The final capture build explicitly includes its dynamic reader;
  the assessment build also succeeds. Database test children use256MiB, sequentially.
- The first canonical run was3PASS/1FAIL because Main35 snapshot files had not
  been copied into the harness. The focused corrected case passes with its own
  Git/transpile hash assertions; the initial failure remains in its log.
- The first capture attempt failed because narrow compilation omitted a dynamic
  reader and the harness checked namespaces before the suite's own cleanup.
  One test schema remained. Independent inspection matched the original hook
  diff,65 migrations and ten synthetic Site/Admin rows. Guarded cleanup removed
  only that schema, after checking foreign references and exact namespace state.
- The corrected harness registers its verification after suite cleanup and
  persists generated schema names before DDL. Final capture10PASS and store20PASS
  each have an independent cleanup receipt. No suppression of a product failure.
- Setup receipt-version mismatch and residue preflight refusal are retained.
  Result-v1 incorrectly pinned its still-open verifier log; result-v2 excludes
  mutable verifier logs and its stable hashes were independently checked.

## Isolation and current website

Exact PostgreSQL PID32276/birth/command/data/loopback5433 ownership and website
PID39792/birth/5181 ownership passed before/after. The final independent query
matches all17 initial namespace names and confirms all16 recorded fixture schema
names are absent; one recorded Main35 fixture failed before creating its schema.
These are namespace and owned-fixture checks, not a byte audit of foreign tables.

No website restart, website migration, main/demo5434, cloud, model, inference or
capture worker was used. Existing foreign/orphan namespaces were left intact.

## Evidence and next gate

Run directory:
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/tuan-naming-rehearsal-20261018-v1`.

Read `result-v2.json`, each named log/exit/ownership receipt, source verification,
compiled artifact SHA256 manifest, residue inspection/cleanup and final owner proof.
Result SHA256: `67cf35543a614609d1f17a208e7bf25c912c0bb220bdd66d77edb0a1754049d1`.

Independent Backend/migration review remains **OPEN**; the Codex Herdr reviewer
last reported an auth failure, and Agy is assigned FE/UI/UX only. The result is
**ISOLATED_NAMING_QUALIFIED_NOT_INTEGRATED**. Coordinate the current Main baseline
and obtain independent review before considering any authorized integration.
Browser/UAT, trusted commissioning, nativeCI, operations/load and whole MF05/MF06
acceptance remain separate. No whole ERD/model/product acceptance follows.
