# Gate-permission writer session and journal attribution

The existing gate-permission setter increments `site.access_policy_version`
through `auditAccess`. That Site field belongs to the MF06 authority capture
mask even though gate-permission rows are a separate access-domain concern.
Previously the controller passed only an early actor snapshot into a raw
transaction, leaving its policy update unattributed and allowing a stale session
or role snapshot to reach the mutation.

The controller now binds its original request through `UserAuthGuard`. The
service preserves its early role/UUID/DTO checks, rejects actor/context mismatch
and uses the existing command transaction with `WORKER_GATE_PERMISSIONS_SET`.
`mainSiteManagerAuthorization` checks the current exact-Site Manager role under
lock. Its authority capture scope is only `site`; there are no new permissions,
role shortcuts or schema changes.

An AST comparison confirms that the original work callback is unchanged: Worker
lock, optimistic permission IDs, assignment/participation/expiry checks,
replacement, audit and response. Legacy direct-service calls without an original
authenticated context do not gain trusted attribution.

## Bounded verification

- Three original regressions fail, then all three pass on canonical70 owned
  PostgreSQL schemas after repair.
- The permitted clear uses real AuthService WEB login, JWT, UserAuthGuard and the
  controller. It verifies the exact request reaches transactional authentication,
  the attributed SITE revision and matching committed-command receipt, audit and
  unchanged gap count. Actual logout makes the same bearer fail401 without writes.
- Moving the Manager role to another Site makes the early snapshot fail403;
  actor mismatch and reauthorization returning401 also preserve state.
- Four existing role-boundary unit cases pass separately. TypeScript and lint pass.
- Both owned schemas are absent afterward; prior namespace names are unchanged.

Agy p7 supplies the candidate and tests; Root corrects nonexistent guard/schema
fields in the test before reproducing RED. P5 reviews the final applied source
read-only. These are controller/service/database calls, not socket HTTP or a
concurrent revocation race. The fixture clears an empty permission set; real gate
hardware and complete grant/replacement journeys are not accepted by this check.

Evidence: `D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/gate-permissions-*`.

No retained website data, current runtime, model, camera worker or cloud state is
changed. Together with document-review attribution, this closes two identified
SITE-policy writer gaps; it does not certify the complete writer inventory or
activate an authority epoch. Cutover, trusted identity, the concrete MF06 worker,
PPE delivery and full product acceptance remain separate requirements.
