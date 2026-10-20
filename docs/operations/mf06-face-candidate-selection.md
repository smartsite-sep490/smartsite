# MF06 provisional Face candidate selection

`SafetyFaceCandidateReader` supplies the private crop resolver with current eligible
templates. It is not a public API, verified identity decision or runtime worker.
The caller must derive Site scope from an authorized immutable assessment claim.

## Selection and finalization

- The reader owns a `REPEATABLE READ READ ONLY` transaction, with a 1500 ms statement
  timeout and cancellation checks around each query. It performs no profile writes.
- It requires an active same-Site Worker, active/nondeleted/nonrevoked profile and
  the requested model version. Supervised confirmation and the latest unrevoked
  `SAFETY_MF06` consent must match the database-owned profile revision.
- Templates are bounded at the SQL projection by `octet_length`, then copied through
  the existing descriptor-safe JSON snapshot. Invalid/duplicate rows refuse the
  entire selection; they are never silently skipped.
- `LIMIT 33` detects the 32-candidate budget. Excess candidates produce an explicit
  unavailable result rather than a truncated search corpus. Successful empty results
  mean no eligible profiles for this query, not Unauthorized or no Workers.
- Returned arrays/scalar records are copied and frozen. Templates stay private and
  must not appear in logs, assessments or browser responses.
- Selection is provisional: claim lease, profile revision, current consent and
  event-to-crop binding still require final SERIALIZABLE validation after resolver I/O.

## One shared namespace boundary

Both selection and `SafetyFaceProfileMetadataReader` now use `getSafetyFaceTables`.
It requires the configured PostgreSQL driver schema, refuses missing/system/NUL or
over-63-byte identifiers, and quotes all four relation names. There is no implicit
`public`, `current_schema()` or pooled `search_path` fallback. Existing eligibility
predicates, optional finalization locks and missing-table handling are preserved.

Root reproduced the old final metadata lookup returning unavailable under empty
`pg_temp` shadows while selection still worked. The shared boundary fixes the root
cause for both readers, including the final `FOR UPDATE OF p,w,c` lookup.

## Actual bounded evidence

- Four focused unit cases passed, including scope/format/abort, malformed/duplicate
  rows, candidate overflow, immutable copies and query-error handling.
- One actual canonical-70 PostgreSQL case passed on dedicated local 5433. It checked
  same-Site consent filtering, other-model refusal, revocation/new consent, automatic
  profile revision rotation, multibyte template refusal and four temporary shadows.
- The final native case also checked the existing metadata lookup before/after
  shadows and inside an actual SERIALIZABLE transaction with finalization locks.
- The file-owned schema was independently confirmed absent afterward. The verifier
  performed no deletion; this is not an audit of every unrelated schema/table byte.
- All records/templates are synthetic test fixtures, not real Worker identity,
  actual human consent/signatures or biometric accuracy evidence.
- SQL cancellation is cooperative around a statement timeout. No immediate backend
  preemption, load/capacity, model or complete assessment runtime claim follows.

The real WorkPort, authoritative identity/covered authority history, observation
contract rollout, independent model quality and browser/full-flow acceptance remain
open. No new route, role, migration, website restart, model or capture worker was added.
