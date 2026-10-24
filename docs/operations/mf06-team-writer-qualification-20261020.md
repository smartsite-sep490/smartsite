# MF06 actual team writer qualification — 20 October 2026

## Qualified boundary

The unchanged private named graph70 `ContractorTeamsService` was exercised on
fresh, owned PostgreSQL5433 schemas with synthetic users, roles and business rows.
The separately qualified historical reader and stored-profile helper were used;
the private migrations and service were not modified or adopted into this branch.

Evidence root:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/`.
The executable fixtures and exact four compiled-source hashes are retained in
`team-writer-service-qualification-20261019-v2` and
`team-writer-service-qualification-20261020-v3`.

The v3 execution exits0 with12 assertions covering:

- Scoped representative creation, idempotent creation and metadata-only update.
- Wrong-Site rejection without journal side effects.
- Membership join, idempotent join, transfer and removal.
- Team Zone grant, idempotent grant and revoke.
- Archive conflict while members are active, then successful archive after removal.
- Same-transaction command/commit witnesses and V2 historical reconstruction.
  Earlier observations preserve the active team, original membership and
  unrevoked grant after later changes.

These checks exercise actual services, not direct writes pretending to be
application commands. The earlier v2 execution covers six overlapping cases;
the counts are not18 distinct checks. The v1 missing-module failure is preserved.

## Isolation and recovery

After the reboot, the existing dedicated test PostgreSQL cluster was started
without resetting data, deleting locks or restoring another cluster. No website,
camera or inference worker was started. Exact cluster ownership is recorded in
`backend-test-pg-recovery-20261020-v1/pg-owner.json`.

Each rehearsal records its fresh schema ownership before migration and drops only
that schema after the service exits. A separate read-only connection independently
confirms both schemas absent and the preexisting namespace names unchanged:
`team-writer-service-qualification-20261020-v3/independent-cleanup.json`.
This is not an every-table-byte audit or a fresh website configuration snapshot.

## Remaining gates

This is historical source metadata proof, not a Worker identity or access verdict.
Identity and authority coverage remain false. Assignment Zone-array writers,
complete writer/cutover closure, populated upgrade coverage and the real MF06
WorkPort remain open. Do not install a competing Root team journal merely because
it coexists with graph70; reconcile the qualified writer and reader first.

The old local website and camera source disappeared after reboot; their prior
receipts are historical. No rollout, cloud change, push, merge, browser acceptance
or model execution is established by this rehearsal.
