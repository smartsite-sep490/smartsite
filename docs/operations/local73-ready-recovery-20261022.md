# Current73 READY history recovery rehearsal

Root dumped the current serving73 schema and restored it into a fresh owned schema on dedicated5433, using the committed403-module Backend release. No website stop, role/config mutation or rollback was performed.

Actual native pg_dump/psql restore preserved all92 captured business/audit tables and the73 migration ledger, including the existing READY epoch, baseline, activated timestamp and control pointer. Source and clone rows/catalogs/sequences were compared; only schema-envelope/function search_path relocation was permitted. No new migration executed. After verification, only the owned clone was dropped; it was independently absent and prior namespace names matched. Original source still matched its captured state.

Evidence: rollout `local73-ready-recovery-v2/rehearsal-proof.json` and `ready73-recovery-v2.log`, under `D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/product-rollout-461c857-20261021-v1/`. Private dump and row snapshots retained. V1 failed an inherited72 count assertion before creating a clone; failure retained, corrected to exact73 inV2. No applied migration or data was changed to make the check pass.

This is a same-instance SQL backup/restore rehearsal, not off-machine disaster recovery, OS failure recovery or full restore into a running replacement app. The current media inventory is empty: the result proves no nonempty media restore. It also does not establish browser/model/identity or whole-product acceptance. Keep72 rollback and export/reconcile any subsequent writes before a real recovery decision.
