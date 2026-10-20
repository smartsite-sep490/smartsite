# Assignment participation interval selection

An assignment request could fail even when one active Contractor participation
covered the complete requested interval. The old start-time eligibility check
was followed by an unrelated, unordered active-row lookup. That second lookup
could choose an insufficient participation instead of the eligible parent.

The second query now selects a single active participation for the same Site and
Contractor that contains both requested bounds. Ordering by `valid_from,id`
provides a stable anchor when several rows qualify. PostgreSQL compares the
original timestamp strings, preserving microseconds, and locks the selected row.

Start-time ineligibility still returns403; an eligible start with no single
covering participation returns409. Separate rows cannot be combined into a
covering interval. Existing role checks, transaction/session reauthorization,
audit/history writes, PENDING state and approval revalidation remain unchanged.
There are no migrations or new permissions. The historical legacy writer remains
blocked on the canonical journal schema; this change targets the routed writer.

## Verification

- Four canonical70 real-PostgreSQL cases: insufficient first row, future-start
  first row, split coverage refusal and deterministic overlapping-row selection.
- Original source: two failures and two passes. The future-start case happened
  to select a valid row in that run; it is not claimed as a reproduced failure.
- Repaired source: all four pass, including exact microsecond database values
  and no assignment/command writes on rejected requests.
- All47 affected Contractor operations unit cases pass after aligning the query
  fixture. TypeScript and lint for all three changed code files pass.
- Owned test schemas were absent afterward; prior namespace names were unchanged.
  This is not an audit of every retained table byte.

Agy p8 supplied the candidate and tests; p7 independently reviewed the source.
Root reproduced the failure before applying the candidate and executed checks.
P7's candidate-not-applied statement describes its earlier review snapshot.

Evidence is under
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/assignment-participation-*`.

This is service/database proof, not socket HTTP, browser or production acceptance.
No website runtime, retained configuration, model or camera worker was changed.
Authority cutover, trusted identity, the concrete MF06 runtime worker and PPE
notification delivery remain separate unfinished product gates.
