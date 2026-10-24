# Combined66 legacy upgrade and timezone fixture, 18 October 2026

Local carrier `22da88ebc079c9ca8730070bf4c4ad59b1538406`, tree
`4900992442ae2c522b57cf73a2369c703a4050d6`, extends carrier02e9b564 with a single
test SQL change. All production bytes remain unchanged. No branch integration,
website migration, cloud connection, model or capture worker belongs to this work.

## Upgrade checks

- Legacy seven-migration profile: 2 PASS. Populated synthetic rows upgrade to
  exact66 without inventing identity, Contractor mapping or access grants.
  An invalid Track causes the pending batch to roll back atomically, leaving
  the original seven schema and rows. This is failed-batch rollback, not a
  successful inverse of the forward-only physical-name migration.
- Pre-journal and V1 team-history profiles: 2 PASS. Fresh V2 baseline state is
  bridged while old facts and coverage gaps remain intact. A later unattributed
  write still makes reconstruction unavailable rather than establishing trust.
- Current team authority: final6 PASS. Covers source masks, transaction rollback,
  microsecond bounds/retry conflicts, attributed historical replay, permission
  failure atomicity, removed roles and cross-Site rejection.

These ten cases ran across three commands, not one complete ten-case command.
No real human identity, rights, consent or model acceptance follows.

## Fixture failure and correction

Initial team run was5 PASS /1 FAIL. Its UTC request used parent bounds created
through an implicit session-timezone cast. The dedicated PostgreSQL session uses
Asia/Bangkok, so that fixture introduced a25200-second difference. The service
correctly clamps the request against parent/participation bounds; changing that
rule to satisfy the old fixture would widen the requested calendar interval.

A transaction-local SQL probe reproduced the old fixture passing under UTC and
failing under Asia/Ho_Chi_Minh. Explicit UTC parent bounds pass under both. The
probe restored its original session setting and wrote no schema or table rows.
The corrected fixture retains every exact-microsecond and409 retry assertion.
No production SQL, global/database timezone, permission or migration changed.
Affected compilation, native-config lint and formatting passed; RED is retained.

## Broader Web type verification

The complete current Root Web src TS/TSX and tests passed using the existing
approved dependency mapping, followed by Vite configuration types in a separate
command. The broad check ran14.12 seconds at BelowNormal priority, heap768 MiB,
peak RSS881.5 MiB; a40-second/1024-MiB RSS guard did not fire. The initial512-MiB
OOM remains in evidence. No compiler assertions were relaxed to obtain the pass.
This is not native frozen-lock installation, browser or deployment acceptance.

## Full native Backend unit verification

The complete native unit selection ran112 source files with one worker at a time.
Initial v12 was875 entries:871 PASS,3 FAIL,1 SKIP. All three failures came from
the stale release-graph fixture: removing only QR from combined66 leaves65,
and appending QR after physical storage violates the already reviewed order.

Only that fixture changed in source-v7. It verifies the independent exact
Root61/Main62/naming65/combined66 inventories, initialized instances and rejection
of unknown, omitted, duplicate or reordered migrations, including incorrect QR
placement. The production registry and strict independent helper did not change.
Seven focused cases pass. The initial formatting failure and correction remain.

Final native v14:877 entries,876 PASS,0 FAIL,0 cancelled,1 SKIP, exit0.
The skipped connection-metadata test requires an explicit dedicated test URL;
no database connection was opened by it. This is a unit run, not native CI or a
new PostgreSQL integration run. Runner unchanged; worker heap256 MiB/concurrency1.
Whole Backend src/test compile, fixture lint and formatting also pass.

Local review carrier `264b051a555eb811f78b8a7de392d4067d9b9933`, tree
`d3700269e12def6254a9d124311e1190569e79ef`, extends22da88eb with this fixture only.
All1396 source/archive entries match their pins;363 compiled production files
are byte-identical to initial v12. Current Root branch and website are not replaced
by this carrier. Proof: `main-tuan-convergence-20261018-v1/unit-result-v7.json`.

## Retained evidence and remaining gates

See `main-tuan-convergence-20261018-v1/upgrade-result-v5.json`, source-proof-v5,
the named compile/test/lint/format logs, timezone probe and resource receipts.
Full Backend source/test compilation passed under the same bounded policy;
the final unit status is established by the terminal v14 receipt above.

All24 cleanup receipts were independently checked:46 recorded schema names are
absent and the original17 namespace names remain. Foreign table bytes were not
audited. After the human reported signing in, the existing Codex pane accepted
the review prompt but failed token refresh again; no independent review ran.
Native CI, Linux/SIGTERM, browser/UAT and whole phase2–7 remain open.
The carrier has a frozen frontend: preserve current Root UI when integrating.
