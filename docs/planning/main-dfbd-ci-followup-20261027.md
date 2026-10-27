# Main synchronization: CI follow-up, 27 October 2026

Platform Application CI run 40527028808 failed at `pnpm check` on cb95f20:
2 Web tests failed, 2133 passed across 238 files. Later Backend, migration and
container gates were not reached; the earlier scoped local results do not make
this run green.

The four reported missing Visitor presence keys already exist in both catalogs.
The audit could not resolve the helper's unqualified translator parameter. Give
the parameter the installed `i18next` type `TFunction<'common'>` and resolve that
explicit namespace in the audit. Unrelated imports, shadowed types, missing
namespace and union namespace remain unknown. Runtime Visitor behavior is unchanged.

Main presents Worker name and external ID as separate heading/badge elements.
Update the URL-navigation regression to assert both in the same header and verify
the previous Worker heading disappears. Site and Worker API arguments remain checked.

Local reproduction: 2 failures / 55 passes. After repair: 63 passes in one run
across catalog audit, WorkerDocumentsView and VisitorAccessView (six new audit cases).
Web TypeScript, three-file ESLint and Prettier, and `git diff --check` passed.
An earlier test harness run from repository root failed to resolve audit input;
the corrected run uses apps/web as its working directory. Logs are preserved at
`D:/Ky9-FPT/SmartSiteData/runs/main-dfbd-integration-20261027-v1/web-ci-repair-*`.

This is a feature-branch repair. Full CI, independent PR review, browser/live flow,
AI release and production acceptance remain separate gates. No schema, deployed
runtime, model, dependency or business-policy change. Phase 1 storage drafts remain HOLD.
