# MF06 temporary Face outage retry propagation

Temporary Face failures previously collapsed into generic identity/preparation unavailability, preventing the existing worker retry policy from receiving them.

HttpSafetyIdentityResolver now preserves the existing typed RESOLVER_UNAVAILABLE error for a schema-valid exactly correlated TRUSTED_SERVICE SERVICE_UNAVAILABLE reply, fetch rejection, HTTP408/429/500/502/503/504, or its8second internal deadline. Error-status bodies are cancelled without reading. Existing bounded JSON reader, response size, redirect, JPEG/candidate/correlation limits remain intact. Mf06FacePreparation preserves the typed error; caller cancellation wins in both adapters.

Permanent400/401/403/404, wrong correlation, malformed/oversized/non-JSON bodies and genuine NO_MATCH retain fail-closed behavior. There is no retry loop in the adapter: the existing worker owns max-attempt/lease/deadline/backoff policy. Uncooperative native/transport work is not claimed hard-cancelled.

Root observed preparation1FAIL and transport1FAIL/1PASS before the first fix. P5 review exposed missing network/status/internal-timeout coverage, which Root reproduced as2 additional FAIL and repaired. Final43PASS/0FAIL/0SKIP across5 affected files, TypeScript emit and four-file lint/format/diff checks passed. Initial41PASS is superseded, not added to43. The initial raw-D ESM runner error is retained separately, not behavioral RED.

Agy P7 authored the real disk-JPEG/crop propagation and cancellation regression. Root took over the bounded P8 transport-test task and authored transport regressions and production changes. P5 independently reviews actual code. The existing preparation fixture remains below700lines;47 added lines reuse actual media setup rather than duplicating fixtures.

No runtime provider, worker/job consumption, migration, permission, model, training or website rollout. Verified service transport still does not prove Worker identity or complete event-time authority. Whole MF06/MF05 acceptance stays open.

Evidence: D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/mf06-transient-face-retry-proof-v2.json
