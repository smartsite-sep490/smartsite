# MF06 event-time authority gap against retained Main

Actual source review on19October found a prerequisite for the unfinished
production WorkPort: retained Main's Zone entry predicate includes a team-based
ALLOW branch, while MF06's V1 archive registry/projection cannot represent it.

`zone-entry-authorization.service.ts` joins `team_zone_permission`,
`contractor_team`, `contractor_team_membership`, parent contractor permission,
participation/contractor, and an APPROVED assignment whose `zone_ids` includes
the requested Zone. The V1 capture registry omits the three team tables and
the assignment `zone_ids` field. Its projection only evaluates individual
permissions and DENY grants.

This is confirmed by executable static assertions and exact three-file hashes:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/team-authority-gap-proof-v1.json`.
It is a minimum input-coverage finding, not an exhaustive new writer audit or a
demonstrated live authorization error. Existing metadata explicitly reports
`authorityCoverageEstablished:false`; no production assessment worker exists.

The implementation plan is
`D:/Ky9-FPT/SmartSite/local-docs/superpowers/plans/2026-10-19-mf06-team-authority-alignment.md`.
It preserves historical V1 artifacts, introduces versioned team-capable
archive/capture/projection, rehearses a forward migration with Tuán's graph70
coordination, and compares historical effects to the actual Main predicate on
synthetic PostgreSQL fixtures. Do not change Main's permission semantics or
mark a history epoch READY from trigger presence alone.

This is alignment to an existing Main feature, not a new Team UI/business
feature. No DB, current website, role, camera, model, MF08 or cloud change was
made by this review. No push/merge/deploy. Runtime worker integration remains
open until team history, complete coverage, trusted media/Face and consent
prerequisites are actually verified.

Separately, actual Agy p5 saved
`configuration-source-current-20261019-v1/p5-mf06-request-outcome-review-v1.md`
after reading the current FE source/tests. Its bounded NO_FINDING is not
browser/Backend acceptance. Root confirmed job completion is presented
separately from assessment outcome. Its suggested SUCCEEDED-to-CANCELLED
refresh fixture is not adopted as a normal business transition: completed jobs
are terminal. No extra green-suite rerun or cosmetic FE task was requested.
