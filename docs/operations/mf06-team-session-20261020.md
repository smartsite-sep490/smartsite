# MF06 Team writes: original session in the write transaction

## Behavior and scope

All seven Team HTTP mutation routes now supply the existing authenticated-command
context. The six service mutation methods keep optional context for existing
internal callers; supplied context must identify the same actor. Authority writes
reuse the existing command wrapper. Name/description updates reuse the existing
metadata wrapper and retain their audit without inventing authority history.

The previous implementation already checked active accounts, representative roles,
Site/Contractor scope and participation. It omitted the original bearer callback
inside the transaction. The repair preserves those business checks and makes
session reauthorization run before mutations, including transaction retries.

## Executed qualification

Artifacts are under
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1`.

- Corrected real PostgreSQL fixture: three genuine failures before the repair;
  final five cases pass for rejected reauthorization, unchanged Team/history,
  valid create/rename and actor mismatch. The first fixture accidentally omitted
  the Site-specific representative assignment; its failures are not bug proof.
- Seven controller-boundary cases fail before and pass after the repair. They
  invoke the real context helper with a stub authentication guard, checking exact
  request/manager identity and both grant/replacement argument positions.
- TypeScript emit and five changed-file lint pass. A qualification config initially
  referenced old contracts declarations; it was corrected to the already-built
  current v1.3 declarations, without modifying contracts or installing packages.
- Each owned test schema is independently confirmed absent after disposal; prior
  namespace names remain unchanged. This does not audit every retained row.
- Separately, three Worker-profile capture cases verify existing correct behavior:
  missing Worker/Site capture refuses writes, healthy capture records both source
  revisions. There was no Worker-profile production defect or source repair.

## Limits and review

The initial session tests inject rejection into the transactional callback.
A subsequent sixth PostgreSQL case uses actual AuthService login/logout,
AuthTokenService/JWT, UserAuthGuard and ContractorTeamsController. Valid create
and rename produce two `audit_log` rows and only one authority command. After
WEB logout revokes the session, the same request retains its early-guard actor
but create and rename both reject401; Team, audit and history remain unchanged.
All six cases pass on a file-owned canonical70 schema, independently confirmed
absent afterward. This is a controller invocation with real authentication and
database behavior, not a socket-level concurrent race, browser or whole-flow
acceptance. Existing broad Team suites were compiled, not executed against their
default-schema test DataSource. No retained website/schema, AI worker or model is
changed. No push, merge or deployment is performed.

Agy p7 reviewed the pre-change gap; p5 reviewed the saved repair and its limits.
Root independently checked source and executed qualification. No blanket agent
acceptance is adopted. P5's reference to `access_audit_event` is incorrect: the
existing entity maps to `audit_log`; the new actual-token case now asserts it.
The older oversized service receives a bounded exception
for this security repair: owner Root; extract transaction-context handling only
when a later responsibility change justifies it, rather than reorganizing the
whole Team workflow here.

`origin/main` was fetched at `c85d793e6d108cbd47b3ab82e02ae18a32cc871f`.
Its new Safety UI commit is not integrated or applied by this Backend repair;
release integration must preserve that upstream work before publication.
