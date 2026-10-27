# MF06 frame route: actual main runtime verification

On 22 October, Root executed the frozen Backend `461c857` compiled `main.js`
with validated `NODE_ENV=production`, the existing AppModule/configureApplication,
and no ConfigService, DataSource or other provider overrides. This is a bounded
local software check, not production hosting or field acceptance.

The dedicated `127.0.0.1:5433/smartsite_test` run migrated one fresh owned schema
to the canonical72 graph. A synthetic16x12 JPEG/event/request was seeded through
existing ingestion/enqueue/lease/store services. The stored result was explicitly
`UNAVAILABLE/SERVICE_DISABLED`; no automatic worker, identity or model was tested.

Actual HTTP observations: login200; assessment detail200; bound JPEG200 with exact
bytes/SHA, `private, no-store` and `nosniff`; foreign Site403; wrong event404;
unknown query400; modified JPEG SHA404; logout204 and revoked token401.
The actual main application closed through `app.close()`, then the owned schema
was removed. Prior namespace names matched. This does not prove OS SIGTERM,
all foreign table bytes, hardware throughput or browser image rendering.

Agy supplied the initial fixture. Root removed a configuration wrapper that
returned string flags instead of validated booleans, removed an unused foreign
account and ran the corrected242-line helper. Initial candidate/report retained.
The website schema/accounts/roles/configuration were not written by this run.

Evidence directory (outside Git):
`D:/Ky9-FPT/SmartSiteData/runs/unified-corpus-tooling-20261006/demo-readiness-20261014-v1/main-0dd7d27-integration-20261017-v1/product-rollout-461c857-20261021-v1`.
Runner `run-mf06-main-frame-runtime-root-v2.mjs`, log/exit of the same stem,
and `mf06-main-frame-runtime-20261021184926903-73af0a00/proof.json`.

Still open: operational authority release/writer qualification, trusted calibrated
identity, actual automatic camera/AI assessment and persisted notification journey,
independent model quality, browser/UAT and whole MF05/MF06 acceptance.
