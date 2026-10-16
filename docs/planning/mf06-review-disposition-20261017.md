# MF06 review disposition — 17 October 2026

Source review only. Reviewed feature HEAD49c80e5 and fetched Main0dd7d27;
no Backend execution, database inspection, AI or deployment was performed.
The screenshot's findings are not six automatically confirmed runtime defects.

| Review item                      | Verified disposition                                                                                                                                                                                                                                                                                                           | Remaining work / ownership                                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic MF06 worker            | **Open.** `Mf06AssessmentWorker` is a caller-driven class. Its only production-source reference is its declaration; it is not a runtime provider/scheduler. Unit/integration test callers do not prove runtime wiring.                                                                                                         | Tuấn's Backend runtime slice; Root reviews the integration. Keep AI paused.                                                                                                                 |
| Assessment enqueue/read disabled | **Confirmed default, intentional guard.** Both validated config flags default false. Ingestion returns no enqueues; the read service refuses disabled reads. This does not establish a working enabled end-to-end pipeline.                                                                                                    | Keep the disabled default until prerequisites and the owner-authorized runtime are ready. Do not flip flags to close a checklist item.                                                      |
| Different actor roles            | **Upstream changed; integration open.** At49c80e5 camera configuration uses AdminGuard, Zone writes require SiteManager, Assessment reads require scoped SafetyOfficer or global Admin. Main0dd7d27 replaces camera configuration with SiteConfigurationGuard: scoped SiteManager writes; Admin/SafetyOfficer have reads only. | Root must reconcile Main's guards, attributed commands, Web capabilities and tests together; the old Admin-camera description is no longer current Main policy. Do not invent extra grants. |
| Legacy entity source             | **Present with explicit containment.** Release options filter four retired constructors from ENTITIES; frozen legacy24 test support remains separate. This is not evidence that every future registration path is safe.                                                                                                        | Retain archive fixtures and release exclusion. Review registration paths when integrating Main; no bulk deletion or schema adoption.                                                        |
| Physical DB naming               | **Open.** The schema-extension inventory still lists17 mf06-prefixed relations. Four assessment entity classes have business names with explicit old storage mappings. This review did not query a live DB.                                                                                                                    | Coordinate with Tuấn before a forward migration; test populated upgrade, triggers, archives, receipts and rollback. Do not rewrite historical migrations or blindly replace prefixes.       |
| PR size / formal review          | **Still open.** GitHub PR61 at49c80e5 has634 changed files,40 commits and zero submitted formal reviews. The screenshot's626/39 count is historical. Existing bounded Codex reviews are not a GitHub approval of the whole PR.                                                                                                 | Split review by integration/schema/runtime/Web scope; require the applicable review and current CI before merge.                                                                            |

## Current integration blockers

- Application CI38929555846 at49c80e5 failed the i18n catalog audit:
  1540 Web cases passed and one failed. Do not carry predecessor CI forward.
  The follow-up registers the existing feature catalog in the static audit and
  uses its supported explicit Safety namespace; no assertion is removed.
- Newly fetched Main0dd7d27 contains two commits beyond the prior integrated
  Main3ce0358. A trial merge reported30 conflicted files, including guards,
  authority-aware writers, TypeORM options, Web routes and translations.
  The trial was aborted back to the committed feature state before the small
  i18n repair. No conflict resolution or latest-Main integration is claimed.
- PR61 is currently conflicting and must not be merged. Fixing the catalog
  audit alone will not resolve the upstream integration or prove end-to-end MF06.

## Working division

The existing division remains: Tuấn owns the assigned Backend T0–T5/MF08 work;
Root owns integration/API/security review and Web/shared-client coordination.
This note is not a message to Tuấn or evidence that he accepted a new task.
Before overlapping Backend edits, confirm his active branch/commit/file scope.
Root can continue the current CI and Main integration independently of AI.

## Source pointers

- `apps/backend/src/modules/safety/assessments/mf06-assessment-worker.service.ts`
- `apps/backend/src/modules/safety/safety.module.ts`
- `apps/backend/src/config/environment.ts`
- `apps/backend/src/modules/safety/assessments/mf06-ingestion-enqueue.service.ts`
- `apps/backend/src/modules/safety/assessments/mf06-assessment-query.service.ts`
- `apps/backend/src/modules/cameras/cameras.controller.ts`
- `apps/backend/src/modules/zones/zones.controller.ts`
- `apps/backend/src/modules/safety/alerts/safety-alert-access.guard.ts`
- `apps/backend/src/database/typeorm.options.ts`
- [Schema extension inventory](../database/schema-extensions.md)
- [Existing Backend coordination](../database/tuan-backend-coordination-20261016.md)

These are source-level dispositions, not fresh Backend test passes, cloud-schema
conformance, browser acceptance, current model quality or production approval.
