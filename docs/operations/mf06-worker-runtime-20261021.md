# MF06 worker runtime

Status: registered in SafetyModule,configuration and lifecycle checked locally.
The enabled PostgreSQL runtime journey is now checked with a synthetic reviewed
release. Operational release qualification remains open. This source is not
applied to the frozen website.

## Runtime behavior

- `MF06_WORKER_ENABLED` defaults false:no timer,artifact reads,job claims or Face
  work. Enqueue and assessment-read flags remain independent and unchanged.
- Enabling requires manifest path,reviewed SHA256,release root and commit.
  The actual release verifier runs before startup and every dequeue. Missing,
  tampered or invalid release bytes pause processing without consuming queued
  jobs. Synthetic manifests remain test-only.
- The sequential loop builds the real Lease,Context,QualifiedAuthority,WorkPort
  and Store chain. Idle/failure checks wait one second;active jobs never overlap.
- Optional Face work uses the existing HTTP resolver only with identity URL,token,
  evidence root and `MF06_FACE_MODEL_VERSION`. No model version is invented.
  A candidate cannot establish Worker identity. Without this configuration,
  NONE/PROHIBITED paths bypass Face;AUTH_REQUIRED stays IDENTITY_UNAVAILABLE.
- Shutdown clears the timer,aborts work and awaits worker drain before database
  teardown. Artifact reads receive cancellation and a ten-second verification
  timeout. Native stat/realpath calls cannot be preempted;cancellation checks
  prevent subsequent reads or job claims.
- Required release pins now include runtime,configuration,WorkPort and direct
  assessment components plus capture-time/projection helpers. Older manifests
  need a reviewed replacement. This is not full dependency/writer closure.

## Actual verification

Agy P7 supplied candidates;Root rejected a generic scheduler and empty manifest
or model placeholders. Root reproduced an invalid-URL TypeError retaining raw
input,then verified sanitized environment errors. MF06 configuration is composed
in one focused file,preserving existing defaults and flags.

Root repaired constructor narrowing and fixtures:a stale clock,an SQL matcher
swallowing cancellation updates,a missing compiled package fixture,and invalid
configuration tests bypassing the real environment validator.

- Initial34-case run:31 pass,three fail;intermediate33/34 retained. Corrected
  34-case run passes,including21 existing configuration cases.
- After pin changes:21 focused configuration/runtime/artifact cases pass.
- Final cancellation/real Nest DI addition:19 runtime/artifact cases pass.
  These cohorts overlap;they are not one summed test run.
- Real Nest application context resolves the registered runtime disabled with
  zero DB I/O. Enabled lifecycle units use mock DB and actual on-disk verifier;
  they are not actual PostgreSQL processing proof.
- Narrow TypeScript includes SafetyModule;changed-file lint/formatting pass.
  No whole Backend suite,website restart,model load/train or deployment.

P5 review identified detached reads;Root added cancellation. Other findings
contradicted existing shutdown guards or required changing legacy compatibility.
D-only fixtures remain per owner instruction. The lifecycle test is above the
400-line target but below700,keeping one fixture and connected boundaries together.

Evidence:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.
Logs:`mf06-runtime-first-v1.log`,`mf06-runtime-green-v2.log`,
`mf06-runtime-green-v3.log`,`mf06-runtime-pins-green-v4.log`,
`mf06-runtime-nest-green-v5.log`,`mf06-runtime-abort-green-v6.log`.

## Enabled real PostgreSQL journey

`runtime-pg-green-v2-proof.json` and its log record one coherent test with three
synthetic queued requests. The actual lifecycle claims PENDING rows itself and
records NONE/ALLOWED,PROHIBITED/DENIED and AUTH_REQUIRED/IDENTITY_UNAVAILABLE,
then verifies immutable replay and drains before schema disposal. No injected
worker,Face model,HTTP resolver or external identity runs in this journey.
The owned schema is independently absent and prior namespace names unchanged.

The first execution failed before test initialization with ECONNREFUSED:the old
PostgreSQL and website owners were absent. Root verified the exact executable,
existing data directory and stopped status,then restarted only the5433 test
cluster without reset. New postmaster89608,birth15:40:34.904842VN. No prior
graceful exit/cause is proved. This does not restore the disappeared website.
