# Team capture baseline refusal qualification

Root inspected the current canonical70 source before changing production code.
The outer baseline command lists the frozen V1 capture tables, so a missing Team
trigger was a plausible concern. Actual execution disproves that defect: the
installed V2 baseline SQL independently requires all36 enabled capture/truncate
triggers for18 sources before inserting a baseline. No production repair is made.

Four cases in `main-baseline-team-capture.integration.test.ts` execute on a
file-owned canonical70 PostgreSQL schema:

- Disable each of `contractor_team`, `contractor_team_membership` and
  `team_zone_permission` capture triggers in turn. Baseline capture refuses503;
  epoch, baseline and command counts remain unchanged; each trigger is restored.
- Healthy capture includes18 source kinds and remains `STAGING`.

The first run passes all four cases. This is additional qualification of existing
behavior, not a RED→GREEN source fix. TypeScript emit and changed-file lint pass;
test formatting is applied. Independent SQL confirms the owned schema absent and
prior namespace names unchanged afterward; no all-row audit is claimed.

Evidence:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/baseline-team-red-v1-proof.json`.
The filename records the initial hypothesis stage; `actualExit:0` is authoritative.

This does not certify writer closure, READY/cutover, trusted identity, policy
decisions, real WorkPort, current website migration or whole-product acceptance.
It prevents an unnecessary duplicate capture guard or applied-migration rewrite.
