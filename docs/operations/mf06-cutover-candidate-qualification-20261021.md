# Controlled cutover candidate qualification, not adoption

Implementation plan:
`D:/Ky9-FPT/SmartSite/local-docs/superpowers/plans/2026-10-21-mf06-controlled-cutover.md`.

The canonical70 predecessor permits its control pointer to target STAGING
epochs without a controlled-adoption command. Two intended-protocol cases
reproduce that behavior; direct READY promotion is already refused correctly.
This establishes the missing adoption mechanism, not an existing trusted-ALLOW
bypass. The new source test is WIP and remains uncommitted until implementation
and compatible preflight are qualified.

Root rejects the first Agy SQL candidate before execution: invented registry
columns, a nonexistent baseline commandId property/control updated_at column,
FOUND checked after an aggregate and incorrect predecessor profiles. Its bytes
and rejection are preserved. Initial design-review suggestions also include
incorrect column/profile details, so peer approval is not automatic acceptance.

Root's separate candidate corrects those schema/provenance checks and explicitly
places pg_temp last after the owned schema and pg_catalog. Its first owned-schema
attempt refuses valid predecessor indexes because the legacy-relation detector
omits relkind; the next version restricts that check to ordinary tables, retaining
historical PK/index names as required.

## Actual isolated PostgreSQL result

One final mechanical case passes with these separate assertions:

- The unregistered migration installs on the synthetic canonical70 schema.
- Committed STAGING retarget, direct READY promotion and a spoofed marker without
  a bound baseline command are refused.
- Same-transaction synthetic Admin/command/baseline cutover reaches READY and
  updates the pointer; a separate postcommit witness is actually recorded.
- An error after a subsequent pointer change rolls back the new epoch/baseline
  and restores the prior pointer and READY state.
- The owned schema is absent afterward and prior namespace names are unchanged.

These are synthetic SQL mechanics. The manifest is a test hash, not reviewed
production coverage, and the probe does not use the future orchestration service.
The current production capture-preflight helper correctly refuses the changed
guard profile; that incompatibility is explicitly asserted, not hidden.

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.
Use `cutover-root-candidate-v2.ts`, `cutover-root-probe-v3.mjs` and
`cutover-root-probe-green-v3-proof.json`. The earlier failed qualification and
original rejected candidate remain separate artifacts.

Required before source adoption: exact coherent versioned preflight, independently
reviewed guard/lock/rollback behavior, current release/writer manifest validation,
original-session service with expected-pointer CAS and positive/denied/concurrent
journeys. The migration remains unregistered and outside canonical source. No
retained website/cloud schema, runtime, model, Worker identity or live authority
epoch has been activated by this qualification. Task1 and the whole goal stay open.
