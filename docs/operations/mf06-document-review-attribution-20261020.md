# Document review and authority journal attribution

Worker document review updates `site.access_policy_version`. Although document
rows are outside the authority source masks, that Site field is captured. The
public review handler previously passed only its early user snapshot into a raw
transaction: later session/role revocation was not rechecked and the policy
revision had no attributed command, creating an authority-history gap.

The controller now binds the original request through the existing auth guard.
The service checks actor/context equality, validates the Site ID before SQL and
uses `executeMainConfigurationCommand` with `WORKER_DOCUMENT_REVIEW`. The custom
authorization callback locks the current exact-Site SAFETY_OFFICER role; existing
account/session checks run inside the same SERIALIZABLE transaction. There is no
Admin shortcut, new role or schema change. Its capture mask is only `site`.

The original domain-work callback is AST-equivalent: document status/version,
approval dates, superseding documents, notifications, audit and policy increment
are unchanged. Historical direct-service calls without an authenticated context
do not gain attributed history. This does not certify an epoch READY.

## Verification and review

- Initial five meaningful regressions fail on the original implementation.
- Final six cases pass on canonical70 isolated PostgreSQL: original-request
  forwarding, attributed permitted review, revoked-session callback401,
  revoked-Safety-role403, actor mismatch403 and malformed-Site400. Denied cases
  preserve document, policy, audit and journal state.
- Eight existing compliance unit cases pass separately; TypeScript and lint pass.
- Owned schemas are absent afterward and prior namespace names are unchanged.
- Agy p5 supplies the tests and independently reviews the production diff. Root
  corrects fixture table/type errors and implements/executes the repair. The
  optional-request and excess-actor-field compile failures remain in the logs.
- P5's malformed-UUID observation is repaired before the final six-case run.

The fixture uses a notification counter and synthetic session callback. It is
not successful inbox delivery, a real-JWT/socket race test or browser acceptance.
The unchanged-body check does not replace full document onboarding acceptance;
that broader suite was not rerun for this bounded repair.

Evidence: `D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/document-review-*`.

Existing large-service exception: Root retains this operation in the existing
document service because its transaction owns document/notification/audit work;
extracting the whole service would expand this security fix. Reconsider splitting
when document responsibilities change, rather than moving code to satisfy LOC.

No website runtime, retained configuration, AI/model or cloud state was changed.
Gate-permission attribution, complete writer closure/cutover, the real MF06 worker
and trusted identity remain open. Source-only Agy inventories are review inputs;
stale assignment findings do not reopen the repair already committed at4ace44b.
