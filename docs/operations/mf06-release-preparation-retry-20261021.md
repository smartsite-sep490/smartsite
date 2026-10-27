# MF06 retries unavailable release preparation

## Trigger and resulting behaviour

The runtime verifies its release before claiming a job. The event-time authority
reader verifies again during preparation. If release files become unavailable
between those steps, the old WorkPort treated `RELEASE_UNAVAILABLE` like a final
historical-authority result, allowing a successful immutable UNAVAILABLE
assessment. A transient infrastructure failure should instead consume the
existing bounded retry policy, without manufacturing a permission decision.

WorkPort now treats release unavailability as retryable infrastructure failure
during preparation and revalidation. Genuine historical outcomes, including an
unqualified epoch window, retain their existing fail-closed semantics. The
existing worker retry code is reused; no new public error enum, queue, policy,
API, permission, migration or MF08 behaviour is introduced.

`prepareForEvent` also receives the caller's AbortSignal and passes it to the
existing native abortable release reads. It checks cancellation around the
bounded database snapshot. Cancellation is propagated rather than converted
into a completed authority result. PostgreSQL queries still use existing local
statement/lock timeouts; this does not claim driver-level query cancellation.

## Evidence

- Actual pre-aborted caller regression: old source1FAIL/1PASS; corrected2PASS.
- Existing real-PostgreSQL WorkPort journey gained one post-claim release failure
  scenario: old source fails the expected retry rejection; corrected journey
  passes, including existing NONE/PROHIBITED/AUTHORIZATION_REQUIRED and scope,
  lease, immutability and lock cases.
- The added scenario uses a controlled authority-unavailable response after a
  real claim; it does not physically corrupt a deployed release or prove every
  concurrent filesystem interleaving. No Face/profile call or assessment row is
  created for that attempt.
- Both actual PG runs removed only their owned schema and preserved prior
  namespace names. This is not a byte audit of every preexisting table.
- Scoped TypeScript, four-file lint, formatting and diff checks passed. The
  initial PG harness lacked compiled SafetyModule source pins and failed before
  the regression; its output is retained separately from behavioural RED.

Tooling evidence: `main-0dd7d27-integration-20261017-v1/`
`mf06-product-gap-20261021-v1/`, including `abort-red-v1.log`,
`abort-final-v1.log`, `runtime-pg-red-v2-proof.json`,
`runtime-pg-green-v1-proof.json` and Agy's bounded review/test fragment.

Root independently verified Agy's report. The earlier suggestion that the base
release verifier lacked AbortSignal was rejected: it already supported it; the
missing forwarding was in its caller. Agy's FE review established no additional
production-route defect; legacy unauthenticated demo polygon behaviour was not
rewritten as a speculative production fix.

## Scope and limits

WorkPort is509 lines after this small branch addition, exceeding the500-line
review trigger. Manual review retains its cohesive prepare/finalize trust
boundary rather than extracting a new abstraction. The422-line existing PG test
is similarly retained as one owned-fixture journey; no extra generic fixture was
added. No model, camera, website rollout, operational cutover or full-flow
acceptance follows. Existing authority coverage and independent identity gates
remain open.
