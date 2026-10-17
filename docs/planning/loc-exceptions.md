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

| Path                                                         | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | -------: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/cameras/CameraManagementDialog.tsx` |      629 |     674 | Root-reviewed bounded async status focus ownership and outcome targets; mocked API-result DOM regressions include success, conflict, denied and no-focus-steal. Baseline is local28f9c1e. Do not grow the mixed form further without extracting its mutation/focus responsibility; preserve guards and assertions. |

Owner/reviewer: Root. This exception covers the 45-line increase for the
specific focus behavior, not general growth or browser/production acceptance.

## Shared client composition, 15 October

| Path                                           | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | -------: | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/api-client/src/management.ts`        |     3168 |    3458 | Preserve the existing public client/session transport while composing reviewed Main checklist/overview operations and the metadata-only camera read, including strict returned-page counts and its 5s default deadline. Avoid a second transport with weaker cancellation/evidence/auth handling. Root owns the exception; extract cohesive feature clients behind this public interface before another feature family is added. |
| `packages/api-client/tests/management.test.ts` |     1236 |    1265 | Repair two existing session-expiry fixtures to register and clear the actual token/scope pair and assert event scope. Assertions retained; new feature tests are separate bounded files. Root-reviewed exception for this fixture repair only.                                                                                                                                                                                   |

Counts use physical lines at the reviewed local snapshot after formatting.
Baseline is local2dc598d. This is a bounded integration exception, not an
acceptance of ongoing growth or evidence of runtime/production readiness.

## Camera wall location context, 15 October

| Path                                                | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                      |
| --------------------------------------------------- | -------: | ------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/ppe/PpeMonitoringView.tsx` |     3354 |    3356 | Existing parent grows only by two authorized Site-name/code props; metadata hook and context UI are separate files. No media/evidence refactor is hidden in this task. Extract parent responsibilities in a separate reviewed task before further growth. |
| `apps/web/src/i18n/ppe-catalog.ts`                  |     1485 |    1513 | Add fourteen vi/en context entries per language in the existing Safety catalog. User-entered names and machine payloads remain unchanged; do not create a second i18n runtime.                                                                            |

Root-reviewed baseline is local9cf35c0. The new boundary test is above the400-line
soft target but below the700-line escalation threshold; preserve its four distinct
scope/refetch/cancellation scenarios rather than compress assertions for a count.
This exception is not browser, running-product or production acceptance.

## Region polygon editing, 15 October

| Path                                                            | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------- | -------: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/src/components/ppe/ZonePpeCameraRegionPanel.tsx`      |     1430 |    1238 | Extract canvas, controls and geometry into cohesive files. Retain existing scoped metadata, mutations and pixel-TTL guards; add frozen optimistic revision, exact submitted geometry and create-to-edit transition. Root permits this smaller grandfathered orchestration file; extract existing query/mutation responsibilities before future growth. |
| `apps/web/src/components/ppe/ZonePpeCameraRegionPanel.test.tsx` |     1419 |    1711 | Keep existing scope/security fixtures and add save/reopen, stale-preflight and PATCH409-race regressions. Root accepts the bounded shared-fixture increase; next editing task must extract its reusable setup and separate existing-region journeys rather than grow this suite again.                                                                 |
| `apps/web/src/i18n/ppe-catalog.ts`                              |     1513 |    1559 | Add actual editor controls, scoped read-only configuration notes and truthful existing-edit409 guidance in both languages. Preserve one i18n runtime and machine payloads. Root accepts bounded catalog growth; future catalog split must preserve typed keys and Main integration.                                                                    |

Physical lines counted after normal formatting at the reviewed source snapshot,
baseline localf4c706f. New canvas418, controls266, pointer hook175 and geometry266
lines stay below500; interaction lifecycle was extracted after independent review.
Root owns the exception and subsequent extraction review. New Canvas tests452 lines
are above the400 soft target, below700, retaining twelve meaningful cases; safety
and submission journeys are separate files. Software checks do not close the
independent-image, camera-viewpoint, browser or product gates.

## Scoped Zone capability repair, 15 October

| Path                                                     | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------- | -------: | ------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app.tsx`                                   |      563 |     564 | Forward the existing API mustChangePassword fact in sharedSession; no shell/route/MF08 implementation change. Root permits this one-line projection; extract shared-session projection with its consumers before further unrelated shell growth.                                                                       |
| `apps/web/src/components/ppe/PpeMonitoringView.tsx`      |     3356 |    3380 | Derive scoped Zone/Region capabilities through a small helper and pass explicit flags into the existing popup. No new transport/runtime architecture. Root permits the bounded gate/prop increase; extract configuration launch controls before another responsibility is added.                                       |
| `apps/web/src/components/ppe/PpeMonitoringView.test.tsx` |     2080 |    2122 | Two existing draft/locale fixtures now explicitly include the Site Manager roles required by Backend; normal formatting retained. Four actual capability journeys are in a new bounded test file. Root permits fixture changes only, extract common setup before new tests grow this file.                             |
| `apps/web/src/components/ppe/ZonePpeSetupPanel.tsx`      |     1132 |    1183 | Separate existing manager Zone-write controls from Admin read-only catalog/Region controls, including scoped mutation feedback and capability-loss reset. Preserve all validation/pagination. Root permits this existing-panel gate change; extract create/rename form responsibilities before further feature growth. |

Reviewer/owner: Root; implementation and independent regression workers were actual
Herdr Agy p7/p5, with p8 independent read-only review. No role grant or Backend
permission bypass is implied. Context telemetry remains unknown.

## Tuấn Backend MF05/MF06, 16 October

The [scoped Backend exceptions](../operations/mf05-mf06-tuan-backend-report.md#loc-exceptions)
record baseline/current physical counts, owner, review scope and follow-up for
bounded authority, transaction, fixture and recovery changes from bundle v4.

## Tuấn Main-sync merge fixture, 16 October

`apps/backend/test/integration/mf07-scheduling-queries.integration.test.ts`
grows from1155 physical lines at907b4ca to1159 in the combined candidate. Owner:
Tuấn. The four-line delta scopes the canonical fixture inside its test and
registers cleanup before initialization; incoming Shift assertions remain.
Keep this existing suite for the merge; extract its shared setup/query journeys
before further feature growth. Independent merge review found no new issue in
these resolutions; release and populated56 upgrade acceptance remain separate.

## Main login role-resolution repair, 16 October

| Path                   | Baseline | Current | Reason and follow-up                                                                                                                                                                                                                                                                      |
| ---------------------- | -------: | ------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/app.tsx` |      619 |     623 | Root permits four lines for waiting on the existing current-user query before leaving login. No new login form, role grant, query transport or feature responsibility. Existing root routing remains grandfathered; extract cohesive routing/session composition before unrelated growth. |

Baseline is79791f6; fix isf4a6f29. Focused routing/locale/shell19PASS,
independent source review and types/lint support this bounded exception only.
The separate localization audit and full remote CI remain open.

## Safety presentation localization, 16 October

| Path                                                             | Baseline HEAD6035df7 | Reviewed change      | Reason and follow-up                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------: | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/cameras/RealtimePreviewCanvas.test.tsx` |                  532 | Seven extra lines    | Existing frame/box tests now verify EN/VI accessibility text on the same pixels and IDs. Keep all lineage assertions; extract common canvas fixtures before adding a new responsibility.                                                          |
| `apps/web/src/components/ppe/FourSourceWall.tsx`                 |                  462 | One extra line       | Replace existing prose with typed translation keys; camera limits, policies and polling remain unchanged. Extract tile presentation before unrelated growth.                                                                                      |
| `apps/web/src/components/ppe/Mf05DemoControlPanel.tsx`           |                  699 | Fifteen extra lines  | Localize existing diagnostics, status errors and evidence labels without modifying commands or scope. Extract diagnostics presentation before another feature is added.                                                                           |
| `apps/web/src/components/zones/RestrictedZoneView.tsx`           |                 2234 | Fourteen extra lines | Translate existing visible strings and render retained system feedback through a bounded adapter. Existing queries, technical row values and geometry remain unchanged. Further work must extract orchestration rather than add responsibilities. |
| `apps/web/src/i18n/ppe-catalog.ts`                               |                 1657 | 362 extra lines      | Matching EN/VI entries for the existing camera, wall, diagnostic and Zone views. Root permits this integration repair; split catalogs by feature while preserving typed keys before further expansion.                                            |

Reviewer/owner: Root. Actual Agy p8 implemented presentation changes; Herdr
Codex supplied an independent source review. Root reproduced and repaired six
retained-message gaps and ambiguous applying-state wording. New Zone adapter and
regression files stay below100 lines each. Final checks are recorded separately
in the operations evidence; this exception does not certify CI or production.

## Canonical Main attendance test fixtures, 16 October

| Path                                                                   | Baseline4898a84 | Reviewed growth | Reason and follow-up                                                                                                                                                                         |
| ---------------------------------------------------------------------- | --------------: | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/backend/test/integration/mf03-attendance.integration.test.ts`    |            1304 | Five lines      | Register file-owned canonical schema cleanup before initialization. Preserve all SQL/concurrency/authorization assertions; extract common attendance fixtures before adding another journey. |
| `apps/backend/test/integration/attendance-reports.integration.test.ts` |             403 | Three lines     | Canonical file-owned schema and cleanup registration; preserve HTTP/auth/report assertions. Shared fixture extraction is required before unrelated growth.                                   |

Root reviewed the actual Agy p5 fixture implementation and p8 source-only review,
then ran the dedicated PostgreSQL suites. Existing catalog exception now includes
eight additional EN/VI source-status entries from Main integration (2027 lines,
370 above6035df7); no polling, transport or policy change. No size-based test
removal, geometry/authorization relaxation or production acceptance is implied.

## Main actor/session fixture repair, 17 October

Root reviewed this bounded growth against the actual command services and real
PostgreSQL runs. Agy p5/p7 supplied independent read-only fixture reviews; their
blanket acceptance wording does not replace Root's checks. Baseline: cbe38ca.

| Test under `apps/backend/test/integration/`        | Baseline | Current | Reason                                                                                                                                      |
| -------------------------------------------------- | -------: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `main-public-assignment.integration.test.ts`       |      681 |     775 | Separate real Requester/Safety/Manager sessions, original-bearer logout barriers, operation-to-actor facts and explicit self-review denial. |
| `main-zone-permission-command.integration.test.ts` |      610 |     665 | Separate scoped actors and exact injected audit rollback, retaining every permission interval/replay/concurrency assertion.                 |
| `main-worker-roster.integration.test.ts`           |      480 |     523 | Distinguish public Representative profile creation from internal Admin account-pair commands without dropping either contract.              |
| `site-access-authority-http.integration.test.ts`   |      601 |     627 | Provision and authenticate a real scoped Representative rather than grant Worker permission as Admin.                                       |
| `runtime-command-replay.integration.test.ts`       |      412 |     433 | Real Contractor/participation/Representative setup before the original process-restart response-loss journey.                               |
| `safety-business-http.integration.test.ts`         |      404 |     430 | Real scoped profile setup and separate bootstrap/business app phases; fixed login throttle and original restart assertions retained.        |

Owner: Root. Before adding another journey to these files, extract their existing
actor/session fixture setup into purpose-specific test support, then rerun the
same assertions. Do not shorten tests, compress formatting or change frozen
historical fixtures to satisfy a line count. This is a scoped exception, not a
general increase to the 400-line test target or 700-line review threshold.

The preceding denied-Zone setup handoff also grew the existing
`RestrictedZoneView.tsx` by 27 lines and `app.tsx` by one (5ff6b20 to cbe38ca).
Root permits the optional navigation callback and denied-card action only;
monitoring permission/query/evidence blocks are unchanged. Extract the existing
view orchestration before adding another feature. Owner/reviewer: Root;
independent Agy p8 review and 29 affected DOM checks are recorded separately.

## Existing operational recovery fixture, 17 October

Root permits `apps/backend/test/integration/operational-recovery.integration.test.ts`
to grow from 1011 to 1019 lines solely to use the existing scoped Manager account
for Camera/Region creation and explicitly retain Admin403 checks. No backup,
restore, media-integrity, private-read or history assertions are removed. The
native-client opt-in exposed the wrong-actor403 before the dump; the corrected
dedicated5433 run reaches restore and passes. Extract its existing actor setup
before adding another recovery scenario. Owner/reviewer: Root; Agy p5 provides
bounded read-only review. This exception does not raise the test-size limit.

## MF06 binding reason localization, 17 October

Root permits `apps/web/src/components/ppe/Mf06AssessmentDetailDialog.tsx` to
grow from 595 to 607 physical lines only for the existing translated mismatch
alert. The 13-reason catalog lives in a separate 71-line feature file; UUID,
nanosecond, scope, cancellation and record-hiding checks are unchanged. Existing
locale tests cover every reason and language switching without another request.
Owner: Root; independent source review: Agy p8. Extract the dialog's presentation
before adding another feature; this exception does not increase the size target.

## Current Linux recovery fixture compatibility, 17 October

Root permits the existing operational recovery integration fixture to grow from
1019 to1058 lines only to use Main's actual Contractor/Representative Worker
provisioning chain, retain production login throttling, and pin the qualified
fresh artifact entrypoint. The registered migration count follows the canonical
fixture; the guarded runner separately verifies the61-migration image. No
restore, history, private-media, role, replay or integrity assertions are removed.
The actual current-image Linux opt-in passes with all three owned SIGTERM exits0.
Owner: Root; Agy p8 supplied bounded static review, not execution acceptance.
Abnormal process exit retains its schema for investigation. Extract actor setup
before adding any new scenario; this exception does not raise the size limit.

## Explicit MF06 timestamp timezone, 17 October

Root permits two Intl options per existing formatter: AssessmentHistory657 to659,
ZoneAssessmentPanel832 to834 and AssessmentDetailDialog607 to609 physical lines.
They enforce the reviewed visible-timezone requirement through explicit UTC,
without a new Site-timezone contract, formatter abstraction or query behavior.
Regression checks run under two host timezones; wire ISO precision remains intact.
Owner: Root; implementation Agy p7. Extract the existing presentation before
adding another feature; these bounded options do not raise the size target.
