# Scoped notification Site filtering

Owner and local size-exception reviewer: Root. Baseline: `d01d18c`.
Implements the requested multi-Site Safety Officer inbox navigation using the existing
personal notification API. This is separate from the planned per-person episode inbox.

## Acceptance

- Selected Site controls Backend pagination, list counts, mark-all-read and delete-read.
- The bell retains the unread total across all currently authorized Sites.
- Facets, reads and writes reuse current recipient authorization; no new grants.
- Pending/error/revoked-Site state never silently widens a bulk command to all Sites.
- Authentication changes clear the prior session's filter/cache.
- Existing unfiltered clients and notification event semantics remain compatible.

## Bounded size exceptions

| Existing file | Before → after lines | Reason |
|---|---:|---|
| `apps/backend/src/modules/workforce/notifications/scheduling-notification.service.ts` | 845 → 873 | Reuse the same authorization SQL and read transaction; add Site predicates only to existing inbox operations. |
| `apps/web/src/features/notifications/NotificationBell.tsx` | 615 → 672 | One filter with loading/revocation/session behavior, preserving existing mutations and Radix popover. |
| `contracts/src/management-api.ts` | 611 → 615 | Two optional response fields retain the existing public contract. |
| `packages/api-client/src/management.ts` | 4000 → 4003 | Keep existing authenticated transport; add optional filter parameters and fix the browser-safe parser import. |

No unrelated refactoring is authorized by these exceptions. Before another inbox feature,
extract the cohesive inbox query/filter state and Backend inbox reads/commands; keep public
client compatibility. Episode implementation must not add per-frame delivery to this slice.

## Validation and boundaries

Focused Web/client/controller cases and real PostgreSQL tests cover selected/all/revoked
Sites, bulk commands and legacy behavior. Full results are recorded in the execution checkpoint.
The initial Web import failure exposed an earlier client regression; the parser now uses
the browser-safe `@smartsite/contracts/safety-episodes` export rather than the Node root index.

No new migration, runtime cutover, model work, production deployment or Main merge.
Independent agent review was unavailable due to quota; Root reviewed the connected paths.
Human/independent review and actual browser acceptance remain open before merge/rollout.
