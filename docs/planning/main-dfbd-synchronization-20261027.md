# Main synchronization into MF05/MF06 feature — 27 October

This integrates Main `dfbdc2778af07cdd18790470228aa857526a5c54` into the existing feature branch. It does not merge the feature PR into Main or deploy either service.

## Conflict decisions

- Keep the feature's actor-bound Users controller/service and Contractor operation providers. Main's new Site Manager revocation is already adapted in ab9b818; Contractor policy/removal is adapted in dd8cab2. Do not restore direct unaudited role writes or unscoped Contractor creation.
- Keep lazy routes, guarded session restoration/profile failure, logout/password notices and scoped camera navigation. Accept Main's retired Worker-summary route and add alert semantics to restoration failure without redirecting a failed restoration to login.
- Retain Safety navigation, camera-setup access and wrapping header while accepting Main's attendance labels and Site/Workforce/Schedule header context. Keep current Site role filtering; a displayed label does not authorize a mutation.
- Remove the technical MF05/MF06 sub-tab badges as Main requests; retain controlled/uncontrolled tab behavior, session props, paused-preview boundaries and query isolation.
- EN/VI catalogs use a three-way semantic merge: zero conflicting leaf values. Keep all disjoint additions/changes, retain the feature's key order and verify object equality against the merged value artifacts.
- Preserve Main login source unchanged from the pre-merge feature. No login redesign or auth bypass.

## Test integration

Main's new direct revocation fixture now supplies a real Admin command context rather than weakening the actor-bound method signature. Visitor onboarding now owns a disposable canonical5433schema through the existing isolation helper; no default/public-schema test writes. All its business assertions remain; cleanup drops only its owned schema instead of deleting audited source rows individually.

Main's new layout tests use the feature's existing profile mock. Update older expectations for Attendance, the retired Worker overview and removed camera badges while keeping scope, paused media, locale, identity and session-recovery assertions. The retry test uses the existing localized Retry control.

## Actual bounded verification

- Web TypeScript exit0; affected Backend AppModule/test import graph compile exit0.
- Web119tests/14filesPASS in one run: routing/load boundary, layout/locale/camera and Main-changed Access/Visitor/Accounts/Workforce/date controls.
- Backend59tests/9filesPASS in a separate sequential run: Contractor source/role races, overview/setup/shared Contractor, Site Manager revocation, Visitor onboarding, management HTTP and QR commands.
- Dedicated test5433 only. Named schemas recorded by three suites are absent; no new isolated namespace names remain and preexisting names are preserved. Other file-owned suites use their existing cleanup helpers; do not claim individual named probes for each.
- All changed TypeScript/TSX lint exit0; changed TS/TSX/JSON formatting and diff checks exit0. Earlier failed fixture/merge assertions and artifact path failures remain in the local evidence directory.
- Vite build with AI paused exits0 into D-only output. Existing lazy Excel chunk remains929.56KB, above500KB; the owner previously deferred that Access dependency to its maintainer. No warning threshold was increased. This is bundle proof, not camera/browser performance.
- Original three Phase1HOLD drafts remain byte-identical, unregistered and outside the merge commit.

Local evidence: `D:/Ky9-FPT/SmartSiteData/runs/main-dfbd-integration-20261027-v1/`.

## Reviewed scope limits

Root performed scoped integration self-review; independent team review and current-head CI remain required. No browser/device/visual acceptance, deployed migration, AI model qualification, live worker adoption or whole-product acceptance follows from these tests.

Existing large files: app568lines (before merge577), layout447lines (before merge365), layout test607lines. Owner Root accepts the integration-only exception to preserve route/session/header assertions and current structure. Follow up by extracting a concrete shared-header responsibility before substantial further growth; do not compress code to meet a line target. These tests are below the700line exception threshold.

Canonical Main contract release must precede official immutable AI schema vendoring. Partitioned ingestion remains defaultOFF; current website/runtime/cloud/model configuration is unchanged. Agy delivery-state FE task remains prepared but not dispatched because no Herdr tool is exposed in this session.
