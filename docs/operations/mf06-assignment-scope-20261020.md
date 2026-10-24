# Assignment scope lookup and review disposition

## Implemented repair

The initial lookup used by public Safety review, Manager decision and Manager
revoke previously selected an assignment ID globally. An out-of-Site existing ID
then returned403, while a nonexistent ID returned404. Three real PostgreSQL
regressions reproduce this existence distinction; it was not an unauthorized
mutation.

`publicScope` now returns the Site only when an active, non-temporary-password
actor has the existing required role on that assignment's Site. Hidden and absent
IDs both return404. Safety review uses SAFETY_OFFICER; decision/revoke use
SITE_MANAGER. The original write-transaction bearer reauthorization, role locks,
scope checks, self-review restrictions and transitions remain unchanged.

Four canonical70 owned-schema cases pass after three failures and one allowed
case before the repair. The allowed same-Site Safety case still transitions to
SAFETY_REVIEWED. Denied attempts leave assignment and authority commands unchanged.

## Affected fixture verification

The first broader unit run exposes old physical-name mocks and historical
preflight-fixture drift. Original HEAD test bytes separately reproduce the same
15 legacy-domain failures (missing fake catalog query and domain query counts).
The first baseline harness fails ESM initialization and is retained separately.

Current-Main mocks now use the approved physical table names. Explicit historical
domain fixtures return an empty journal inventory for catalog probes; real-PG
canonical guards remain separate. No production query/migration is rewritten to
fit those fixtures, and no business assertion is removed. Final57 cases in two
files pass with no skips; TypeScript and changed-file lint pass separately.

Root implements and executes; Agy p7 reviews saved source and the four real-PG
cases read-only. These are service/database and unit boundaries, not HTTP/browser
acceptance. Each new owned schema is independently absent afterward and namespace
names are unchanged; no retained-table byte audit is claimed.

Evidence directory:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.

## Root disposition of Agy p8 writer findings

The source-only report is useful input, not automatic approval of seven defects.

| Finding                                                                     | Disposition                                                                                                                                                                                               |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Individual Worker permission omits assignment `zone_ids`                    | Retained Main's individual-permission predicate differs from its Team path. Do not add a new business restriction under this scope fix; mapping semantics require separate coordination.                  |
| Public replay omits representative check                                    | Not established. The shared configuration helper does not return a cached business receipt. Public work runs again and its create/revoke method checks representative scope before its idempotent return. |
| Global assignment lookup reveals ID existence                               | Reproduced and fixed above.                                                                                                                                                                               |
| Assignment and permission use different Representative sources/status codes | Existing Main contract difference, not evidence authorizing a role/schema rewrite.                                                                                                                        |
| Unordered participation selection                                           | Real compatibility limitation explicitly retained in source; multiple-participation selection needs a coordinated correction rather than silently changing the retained predicate in this repair.         |
| Participation callback lacks work-body duplicate authorization              | Not a missing authorization: the shared helper invokes the supplied authorizer before work in the transaction. The internal fixture path is not the public route's role contract.                         |
| Grant replay returns a subsequently revoked row                             | It returns the actual revoked state and does not restore access. This alone does not prove a security defect or authorize changing replay semantics.                                                      |

Full writer closure/cutover is not certified. Source inventories and passing
scoped cases do not create READY epochs, trusted Worker identity or a real
WorkPort. No MF08, retained website/schema, camera/model, push/merge or deployment
is changed. Existing oversized unit fixture changes are bounded to its SQL and
historical catalog harness; Root owns this exception and will split by fixture
profile when that test file next gains an independent responsibility.
