# MF06 worker cancellation before resolver dispatch

Local implementation commit: `ae4f0bfe5192f3eb3a3e56a69ff5e23f510009ae`.

## Defect and correction

The worker checked cancellation before queueing resolver preparation, but its
Promise continuation could still call the resolver after an abort arrived
before that continuation ran. This could initiate unnecessary media/service I/O
during shutdown even though finalization was already fenced.

The queued continuation now checks the same AbortSignal immediately before
calling preparation. No new option, provider, scheduler, endpoint or dependency
was introduced. In-flight ignored-signal I/O retains its existing late-result
handlers. Database retry, lease cancellation and post-commit behavior are intact.

The regression schedules an abort between claim completion and preparation
dispatch: cancellation occurs once, preparation and transactions occur zero
times. Before the fix preparation executed once, producing an actual assertion
failure. After the fix, the regression plus all 18 existing worker cases pass.
Targeted TypeScript compilation, two-file ESLint and Prettier checks pass.
An intermediate runtime test failed because the sandbox could not resolve its
existing reflect-metadata package; a test-local loader uses the already installed
0.2.2 package without installing or changing product dependencies. Failure logs
remain preserved.

## Evidence and limits

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/mf06-preparation-abort-v1`

`red.log`, `compile-red.log`, `compile-green.log`, `green.log` (dependency failure),
`green-v2.log` (19 passed), `lint.log`, `tsconfig.json`, `reflect-loader.mjs`.

These are synthetic worker tests, not live MF06 execution. No database, current
website, role, model, camera, MF08 or cloud change occurred. Backend served on the
website is still bd91985; this patch is not applied there. Production WorkPort,
trusted Face/media integration and event-time authority coverage remain open.
Neither profile eligibility metadata nor historical archive reconstruction alone
establishes identity or complete authority coverage; do not enable processing
with invented trust or finish jobs merely as SERVICE_DISABLED.

Actual Agy w9:p5 was assigned a separate read-only FE review of request/result
semantics; it does not review Backend or certify production acceptance.
