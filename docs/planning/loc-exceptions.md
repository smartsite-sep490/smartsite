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
