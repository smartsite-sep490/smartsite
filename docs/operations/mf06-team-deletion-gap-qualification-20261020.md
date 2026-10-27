# Team deletion and baseline boundaries — 20 October 2026

## Actual qualification

The unchanged private named graph70 and separately qualified historical reader
were exercised on one fresh owned PostgreSQL5433 schema. Synthetic actors and
team rows are fixture data, not real identities or certified authority coverage.

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/team-delete-gap-cutover-qualification-20261020-v1/`.
The executable `rehearse.mjs`, six source hashes in `result.json`, and actual
exit0 are retained. Five new checks pass:

1. After an actual scoped Team service creates a row, a deliberately unattributed
   physical DELETE on that owned fixture table records a gap. Reading the old
   epoch after the deletion returns `UNAVAILABLE / HISTORY_GAP`.
2. The observation before that gap still reconstructs its original active team.
3. An explicit new V2 baseline after deletion reconstructs the row as absent.
4. That new epoch refuses an earlier observation with `PRE_BASELINE`; it cannot
   supply a made-up past snapshot.
5. Reading the old epoch after the gap still returns `HISTORY_GAP`, even after
   the new baseline exists. A new baseline does not retroactively repair history.

No DELETE endpoint or new business behavior was added. Direct SQL is fault
injection in the owned fixture, not evidence that an actual product DELETE writer
has been attributed or authorized. The actual service writer checks are recorded
separately in the team and assignment qualification notes.

## Independent cleanup and remaining gates

`verify-cleanup.mjs` uses a separate read-only connection. Its
`independent-cleanup.json` confirms the owned schema absent and the preexisting
namespace names unchanged. This does not audit every retained table byte.

The new baseline remains an internal STAGING metadata capture. Identity and
authority coverage remain false; no epoch is certified READY and no assessment
worker is registered. Complete writer closure, populated upgrade/cutover review,
V2 storage integration, original evidence/consent and the real WorkPort remain open.
Neither graph70 nor its reader patch was applied to the website. No model, cloud,
MF08, browser-policy retry, push, merge or deploy action occurred.
