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

## Source guard capability qualified after the external candidate

The statements above describe the earlier external probe. The unregistered
forward migration and frozen predecessor/guard bodies are now in source.
Capture preflight selects one exact old or new profile in one catalog query;
partial/mixed installation cannot become a compatible profile. Ordinary
STAGING baseline capture remains supported.

The source regression exposed a real clean-boundary defect: a source INSERT
after baseline capture was journaled with the old/null epoch and still allowed
adoption. Both guards now reject any current-transaction revision/gap as well
as target-epoch facts. READY promotion runs from the AFTER control trigger and
independently verifies the installed pointer, command, active global Admin,
baseline/hash/registry and held source locks. Retiring a GAPPED epoch does not
remove its immutable gap/revision rows; CLOSED denotes retirement, not a repair
of historical coverage. Existing reader gap checks must remain mandatory.

Actual `executeMainConfigurationCommand` now qualifies positive synthetic
adoption, postcommit receipt and forced callback rollback, rather than only
raw SQL mechanics. Nine focused PostgreSQL cases pass in one final run;
TypeScript and five-file lint exit zero. The owned schema is independently
absent afterward; prior namespace names are unchanged, not a byte audit.

Evidence: `authority-control-red-v2-proof.json` (4 pass/2 fail; the second
failure was synthetic Admin setup gapping the prior epoch),
`authority-control-red-v3-proof.json` (7 pass/1 fail: missing rollback schema
precheck), and `authority-control-green-v3-proof.json` (9 pass/0 fail) in the
evidence directory above. Both failures and the fixture correction are retained.

Agy p5 independently reviewed the selector and found the missing rollback
schema assertion; Root reproduced and repaired it. P7 supplied command-test
examples, reviewed against the executed Root tests; its out-of-source import
paths and repeated Admin setup are not adopted blindly. P8's prior review
prompted the current-transaction boundary, pointer binding and rollback profile
checks. Review claims are not full acceptance.

Remaining Task1 work: original-session orchestration with qualified release/
writer manifest and expected-pointer CAS, migration inventory coordination,
concurrent writer and remaining rejection journeys. The manifest used here is
explicitly synthetic. No migration registration, website/runtime activation,
production READY/coverage certificate, model operation, push or merge occurred.
