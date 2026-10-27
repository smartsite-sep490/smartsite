# Partitioned evidence reader compatibility — 27 October 2026

Owner explicitly approved extending the two MF08 readers and corresponding tests:
“Duyệt hai bộ đọc và kiểm thử”. Decision record:
`D:/Ky9-FPT/SmartSite/local-docs/superpowers/reviews/2026-10-27-mf08-v14-reader-compatibility-decision.md`.

The active review parser rejected v1.4 and local media parsing used a JavaScript
safe integer. Explicitly select the canonical partitioned validator for1.4.0;
retain older version selection and raw/header/hash consistency. Keep the source
sequence as exact canonical uint64 text for v1.4 only, and require URI/metadata
sequence equality. Legacy URI safe-integer limits are unchanged.

Full-frame identity review verifies actual JPEG SHA. Ordinary v1.4 photo reads also
verify raw consistency and actual bytes; historical photos remain readable after
camera deletion without allowing active review. Site/alert/event mappings,
cross-Site, expected hash, session, FRAME-only review, path, symlink, size and JPEG
guards remain. No identity, Worker, team, role or incident decision changed.

New source regression file:18 cases, synthetic2x2 JPEGs. Final actual source run:
34 passes across three files (18 new plus16 existing), strict TypeScript and
three-file lint/format/diff checks pass. Evidence reader337 physical lines is a
Root scoped size exception preserving the existing local-media boundary; no new
file over300 lines. Original proposed candidates and source hashes matched before
application. First TS fixture inference error was fixed with an explicit options type.

Actual AppModule/configureApplication test with ConfigService/DataSource fixtures,
current migrated owned5433 schema and no auth-guard override:

- Real Python worker, content-bound JPEG, SQLite and HTTP delivery for10 synthetic
  tracks /3 confirmed missing-hardhat tracks ->4 raw events /3 alerts /3 correctly
  scoped notifications. Unknown identity remains unknown.
- Source sequence9007199254740994 traverses the real producer, JSON, persistence,
  media URI and filename without Number rounding. Post-commit response loss is
  retried automatically and accepted as duplicate without increasing totals.
- Actual WEB login with allowed Origin; authorized photo200 with exact JPEG bytes,
  private/no-store and nosniff. Missing token401, other-Site Safety Officer403,
  replaced on-disk JPEG409, restored bytes200. The v1.4 identity-context HTTP endpoint
  returns consistent event/full-frame SHA and unknown subjects without a manual decision.
- Owned schema absent afterward, preexisting namespace names retained, no new
  isolated names remain. First HTTP fixture omitted required WEB Origin and correctly
  received403; only the fixture was corrected. No Origin guard change.

Evidence: `D:/Ky9-FPT/SmartSiteData/runs/mf08-v14-source-apply-20261027-v1/`.
This is synthetic source/HTTP proof, not model accuracy, real identity, browser,
deployed main/bootstrap or production acceptance. Canonical Main release/immutable
AI vendoring, actual controlled runtime rollout and FE integration remain open.
No current website/DB/env/model/camera, schema migration or Main merge/deploy action.
