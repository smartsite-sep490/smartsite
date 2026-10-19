# Additive team authority capture candidate

Unregistered migration candidate `ZoneTeamAuthorityHistory1792886400000` adds
three business-named tables: `zone_team_authority_head` (source/id current
projection and revision), `zone_team_authority_revision` (immutable before/after,
transaction/command, hashes/time) and `zone_team_authority_gap` (unattributed,
chain mismatch, truncate or resource-limit evidence).

Frozen masks cover TEAM, TEAM_MEMBERSHIP, TEAM_PERMISSION and the full V2
ASSIGNMENT including `zone_ids`. Names/descriptions, actor notes and credentials
are excluded. Existing V1 registry/functions/heads/baselines are not rewritten.
New revision-zero heads only describe migration-time state, not past authority.
This is separate capture so adding fields cannot invalidate old V1 hashes.

The migration detects exactly one existing command namespace (Main66 legacy or
Tuán's renamed command table); mixed/missing namespaces are refused. New revision
command references point to that existing table. Selection does not itself
qualify the entire renamed graph70; that rehearsal remains required.

Capture binds a command only when it belongs to the exact source transaction.
A reused/absent command produces a gap. This is technical correlation, not a
confirmed commit, role authorization or writer-closure certificate. Readers must
still verify original commit receipts and event-time coverage. Normal team
writers are not instrumented by this migration and can correctly produce gaps.

Native table triggers reject direct journal tampering; PostgreSQL owner/DDL
privileges are not a security sandbox. Rollback removes source mutation and
journal entries together. Down refuses nonempty revisions/gaps. Source tables
are locked during installation; local lock3s and statement5s timeouts apply.
Seed checks stop above2048 rows or2MB before creating tables. Oversized source
mutations record a resource gap rather than retaining unrestricted payloads.

## Actual qualification

- New file-owned migrated Main66 schema on dedicated5433: final9 cases pass
  across additive/empty-down, same-transaction capture/hash, gap, masked text,
  rollback, tamper/populated-down, cross-transaction spoof, assignment Zone IDs,
  membership and team permission capture.
- Two guard tests pass. The seed-budget guard was first demonstrated failing
  (missing rejection), then fixed. Initial migration drafting preceded its
  integration suite; do not describe the entire migration as TDD RED-to-GREEN.
- Targeted compile and three-file ESLint/Prettier pass. New migration remains
  absent from runtime migration registration; all original migration files stay
  unchanged. Earlier71 unit and12 effect parity cases are separate prior runs.
- Four capture-run ownership receipts independently establish owned schema
  absence and unchanged preexisting namespace names, not a whole-table audit.

Evidence: Q/team-archive-v2-v1/{capture-pg-v4.log,capture-pg-v4.exit.txt,
capture-budget-red.log,capture-budget-green.log,capture-final-lint.log,
capture-format-check.log}, Q =
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`.

## Remaining integration

V2 consistent baseline, replay reader, current function/source preflight and
team-writer attribution must still be implemented. Full Tuán graph70 rehearsal,
ERD extension review, complete cutover/coverage and independent Backend review
remain open before registration/application. This candidate is not production
approved, does not activate an epoch, and starts no worker/model/camera.
No current website schema/config/role, MF08,5434, cloud, push/merge/deploy change.
