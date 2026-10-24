# MF06 assignment writer qualification — 20 October 2026

## Executed boundary

The actual private graph70 `MainAssignmentCommandService` and qualified V2 reader
were exercised on a fresh owned PostgreSQL5433 schema. No service, migrations,
business roles or website configuration were changed for this qualification.

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/assignment-writer-service-qualification-20261020-v2/`.
`rehearse.mjs`, `result.json`, `run.log` and `run.exit.txt` retain the executable
fixture, exact compiled-source hashes and actual exit0. Seven checks pass:

1. Wrong-Site requests reject without command/fact side effects.
2. A scoped representative requests an assignment; V2 captures its exact Zone
   array and PENDING status with the actual assignment command/commit witness.
3. The requester cannot self-review or create review facts.
4. A separate scoped Safety Officer changes it to SAFETY_REVIEWED.
5. A separate scoped Site Manager approves it; its Zone array is preserved.
6. The manager revokes it through the actual command path.
7. Historical reads after revocation still reconstruct the earlier PENDING,
   SAFETY_REVIEWED and APPROVED states and original Zone array.

The first attempt failed because the synthetic representative lacked the existing
`contractor_representative_grant` required by the assignment service. Its separate
v1 output is preserved. The corrected fixture adds that legitimate synthetic grant
before baseline capture. It does not weaken authorization or change application
permissions. Team and assignment services have different retained prerequisites;
do not silently substitute one permission model for the other.

## Cleanup and remaining limits

A separate read-only SQL connection confirms both attempt schemas absent and the
preexisting namespace names unchanged in `independent-cleanup.json`. No production,
cloud or website tables were used. This is not an audit of every retained byte.

This proves the sampled actual assignment transitions are attributed and their
source metadata reconstructs. It does not certify all writers, deletion/gap and
cutover paths, event-time ALLOW/DENY equivalence across the full graph, identity,
consent, real evidence or a functioning MF06 WorkPort. Identity and authority
coverage remain false. Graph70 is not adopted or applied to the current website.
