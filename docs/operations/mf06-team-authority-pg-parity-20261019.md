# Team authority projection against retained Main SQL

Twelve synthetic cases compare the new V2 archive effect projection with the
actual unchanged `ZoneEntryAuthorizationService` SQL on PostgreSQL5433. The test
uses the canonical isolated database helper, validates its generated schema and
66 applied migrations, and inserts real constrained team/permission/assignment
rows. The original SQL executes once per case; only its fifth timestamp
parameter is replaced with the original microsecond text through a test adapter.
This avoids conflating production Date millisecond rounding with SQL semantics.

Cases cover team-only ALLOW; membership start/end boundaries including one
microsecond; inactive team; team expiry/revocation; parent revocation; missing
assignment Zone; nonapproved assignment; an active assignment narrower than the
team permission; and independent DENY overriding team ALLOW. Projected effects
are passed to the owning authorization policy and compared with Main's verdict
and reason. All12 pass; neither coverage nor identity is asserted by projection.

## Failures and corrections

The first run failed because the test actor reused one parameter as text and
UUID without an explicit UUID-to-text cast. The next run passed10/12; the missing
Zone fixture used an empty Zone array prohibited by Main, and the inactive-team
fixture attempted to join a team already inactive. The following run passed11/12
after the Zone fixture used a distinct nonempty Zone ID. The final fixture joins
an active team before archiving it, preserving Main's actual membership check.
No production logic or constraints were relaxed to make fixtures pass.

The first lint run found an unused test parameter; it was removed. Final run
with explicit schema/Main66 assertions:12PASS/0FAIL, exit0. Targeted compile,
one-file lint and format pass. Earlier71 unit cases remain prior distinct
evidence; they were not rerun here or represented as one83-case run.

## Evidence and isolation

Evidence Q/team-archive-v2-v1, Q =
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1`.

- `pg-run-v1.log` through `pg-run-v5.log`, corresponding exit/compile logs.
- Final `main-team-authority-parity.integration.test.js.v5.ownership.json`.
- Each run records its new schema before fixture initialization, then independently
  confirms owned-schema absence and unchanged preexisting namespace names.
  This does not claim byte-for-byte auditing of unrelated tables.
- Existing validated smartsite_test credential input was read privately; no
  password/URL is printed, no new role or permission, and no5434/cloud access.

## Remaining gate

The archive in this differential is built from synthetic fixture rows, not from
V2 captured history. This proves bounded effect parity against actual SQL and
the actual Main66 schema; it does not prove forward migration, historical team
reconstruction, writer closure, cutover, real consent/identity or a live worker.
Plan Task3 (Tuán graph70 coordination and forward V2 capture) and the remaining
Task4 history/gap differential must still pass before Task5 registration.
Current website/model/source bindings were not changed. No push/merge/deploy.
