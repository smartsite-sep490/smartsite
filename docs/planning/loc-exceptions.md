# Scoped LOC exceptions

These are reviewed local exceptions to the feature-context workflow, not
permission for general growth or a claim that a CI size gate already exists.

| Path                                                                        | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | -------: | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/test/integration/main-authority-baseline.integration.test.ts` |      843 |     843 | Existing synthetic 15-source snapshot journey; this change only selects the canonical profile. Keep assertions; extract fixture setup in a separate reviewed task before growth.                                                                     |
| `apps/backend/test/integration/main-label-rename-auth.integration.test.ts`  |      834 |     869 | Existing route/DTO/scope suite. Added explicit scoped Site Manager fixtures, separate Site per revocation and Admin/cross-Site denial coverage; do not remove assertions or compress formatting. Extract setup/route fixtures before further growth. |

Owner/reviewer for these local exceptions: Root. The source change is test-only;
no independent teammate review or whole-release acceptance is implied.

Baseline is commit `c169f5ef197a7633772e1c681696800e4592ee66`.
Physical lines include comments and blanks after normal formatting.

The separately hash-pinned historical catalog under
`apps/backend/test/support/legacy24/` is immutable fixture material. Its
provenance records original Git blobs and all import/format transformations;
it must not be rewritten merely to satisfy a LOC target or used in production.

## Camera status focus, 15 October

| Path | Baseline | Current | Reason and follow-up |
| --- | ---: | ---: | --- |
| `apps/web/src/components/cameras/CameraManagementDialog.tsx` | 629 | 674 | Root-reviewed bounded async status focus ownership and outcome targets; mocked API-result DOM regressions include success, conflict, denied and no-focus-steal. Baseline is local28f9c1e. Do not grow the mixed form further without extracting its mutation/focus responsibility; preserve guards and assertions. |

Owner/reviewer: Root. This exception covers the 45-line increase for the
specific focus behavior, not general growth or browser/production acceptance.

## Shared client composition, 15 October

| Path | Baseline | Current | Reason and follow-up |
| --- | ---: | ---: | --- |
| `packages/api-client/src/management.ts` | 3168 | 3458 | Preserve the existing public client/session transport while composing reviewed Main checklist/overview operations and the metadata-only camera read, including strict returned-page counts and its 5s default deadline. Avoid a second transport with weaker cancellation/evidence/auth handling. Root owns the exception; extract cohesive feature clients behind this public interface before another feature family is added. |
| `packages/api-client/tests/management.test.ts` | 1236 | 1265 | Repair two existing session-expiry fixtures to register and clear the actual token/scope pair and assert event scope. Assertions retained; new feature tests are separate bounded files. Root-reviewed exception for this fixture repair only. |

Counts use physical lines at the reviewed local snapshot after formatting.
Baseline is local2dc598d. This is a bounded integration exception, not an
acceptance of ongoing growth or evidence of runtime/production readiness.

## Camera wall location context, 15 October

| Path | Baseline | Current | Reason and follow-up |
| --- | ---: | ---: | --- |
| `apps/web/src/components/ppe/PpeMonitoringView.tsx` | 3354 | 3356 | Existing parent grows only by two authorized Site-name/code props; metadata hook and context UI are separate files. No media/evidence refactor is hidden in this task. Extract parent responsibilities in a separate reviewed task before further growth. |
| `apps/web/src/i18n/ppe-catalog.ts` | 1485 | 1513 | Add fourteen vi/en context entries per language in the existing Safety catalog. User-entered names and machine payloads remain unchanged; do not create a second i18n runtime. |

Root-reviewed baseline is local9cf35c0. The new boundary test is above the400-line
soft target but below the700-line escalation threshold; preserve its four distinct
scope/refetch/cancellation scenarios rather than compress assertions for a count.
This exception is not browser, running-product or production acceptance.
