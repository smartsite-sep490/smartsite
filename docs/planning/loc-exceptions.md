# Scoped LOC exceptions

## Configuration-image client, 15 October

`packages/api-client/src/management.ts` already exceeds500 lines. Root reviewed a
bounded addition of the purpose-specific method and an optional response budget
to its existing authenticated request path. JSON streaming, byte limits and
purpose/scope parsing live in `bounded-json.ts`, rather than growing the transport
inside the manager. Existing call sites retain their original behavior; only the
new endpoint opts into bounded success/error reads and late-body cancellation.
No unrelated endpoint migration or broad class rewrite is included. Before
further transport growth, extract request/session execution without weakening
captured credential expiry semantics. Owner: Root; independent scoped client
review: actual Agy p5. Review does not imply release or browser acceptance.

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

## Region polygon editing, 15 October

| Path | Baseline | Current | Reason and follow-up |
| --- | ---: | ---: | --- |
| `apps/web/src/components/ppe/ZonePpeCameraRegionPanel.tsx` | 1430 | 1238 | Extract canvas, controls and geometry into cohesive files. Retain existing scoped metadata, mutations and pixel-TTL guards; add frozen optimistic revision, exact submitted geometry and create-to-edit transition. Root permits this smaller grandfathered orchestration file; extract existing query/mutation responsibilities before future growth. |
| `apps/web/src/components/ppe/ZonePpeCameraRegionPanel.test.tsx` | 1419 | 1711 | Keep existing scope/security fixtures and add save/reopen, stale-preflight and PATCH409-race regressions. Root accepts the bounded shared-fixture increase; next editing task must extract its reusable setup and separate existing-region journeys rather than grow this suite again. |
| `apps/web/src/i18n/ppe-catalog.ts` | 1513 | 1559 | Add actual editor controls, scoped read-only configuration notes and truthful existing-edit409 guidance in both languages. Preserve one i18n runtime and machine payloads. Root accepts bounded catalog growth; future catalog split must preserve typed keys and Main integration. |

Physical lines counted after normal formatting at the reviewed source snapshot,
baseline localf4c706f. New canvas418, controls266, pointer hook175 and geometry266
lines stay below500; interaction lifecycle was extracted after independent review.
Root owns the exception and subsequent extraction review. New Canvas tests452 lines
are above the400 soft target, below700, retaining twelve meaningful cases; safety
and submission journeys are separate files. Software checks do not close the
independent-image, camera-viewpoint, browser or product gates.

## Scoped Zone capability repair, 15 October

| Path | Baseline | Current | Reason and follow-up |
| --- | ---: | ---: | --- |
| `apps/web/src/app.tsx` | 563 | 564 | Forward the existing API mustChangePassword fact in sharedSession; no shell/route/MF08 implementation change. Root permits this one-line projection; extract shared-session projection with its consumers before further unrelated shell growth. |
| `apps/web/src/components/ppe/PpeMonitoringView.tsx` | 3356 | 3380 | Derive scoped Zone/Region capabilities through a small helper and pass explicit flags into the existing popup. No new transport/runtime architecture. Root permits the bounded gate/prop increase; extract configuration launch controls before another responsibility is added. |
| `apps/web/src/components/ppe/PpeMonitoringView.test.tsx` | 2080 | 2122 | Two existing draft/locale fixtures now explicitly include the Site Manager roles required by Backend; normal formatting retained. Four actual capability journeys are in a new bounded test file. Root permits fixture changes only, extract common setup before new tests grow this file. |
| `apps/web/src/components/ppe/ZonePpeSetupPanel.tsx` | 1132 | 1183 | Separate existing manager Zone-write controls from Admin read-only catalog/Region controls, including scoped mutation feedback and capability-loss reset. Preserve all validation/pagination. Root permits this existing-panel gate change; extract create/rename form responsibilities before further feature growth. |

Reviewer/owner: Root; implementation and independent regression workers were actual
Herdr Agy p7/p5, with p8 independent read-only review. No role grant or Backend
permission bypass is implied. Context telemetry remains unknown.

## Tuấn Backend MF05/MF06, 16 October

The [scoped Backend exceptions](../operations/mf05-mf06-tuan-backend-report.md#loc-exceptions)
record baseline/current physical counts, owner, review scope and follow-up for
bounded authority, transaction, fixture and recovery changes from bundle v4.
