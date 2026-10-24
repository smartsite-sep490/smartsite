# Actual MF06 Backend-to-AI transport boundary

AI local commit `091ddb9` mounts the existing Safety Face router in its real
application factory. It adds one in-memory MF06 task slot per app, shielding that
task from HTTP timeout/caller cancellation and refusing more work until it ends.
Shutdown refuses admission and reports an unfinished drain instead of claiming
native release. It does not change model configuration or enable a worker.

Root tested the exact committed AI app bytes, excluding the existing unrelated
dirty preview changes:17 cases across four Python files pass. Three loopback HTTP
cases call the existing compiled Backend resolver against a temporary Uvicorn
server using synthetic JPEG/templates and UUIDv8 invocation correlation:

- candidate200 remains a profile reference, never a Worker or permission;
- correlated unavailable200 becomes the existing bounded worker retry error;
- wrong-token401 becomes unavailable.

The test API thread exits and its listener closes. No Torch, Ultralytics,
InsightFace or ONNX Runtime module loads; no camera, database or current website
is used. Agy p8 wrote factory tests; p7 wrote concurrency tests; Root implemented,
reviewed/repaired and executed them. P5 reviewed the saved implementation and
confirmed the final test-function correction. No broad acceptance follows from
their reviews.

Evidence:
`D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/mf06-mounted-route-proof-v1.json`.

The first factory tests returned404 before mounting. Timeout/cancellation and
drain tests failed before their respective corrections. Initial lint, pytest
plugin-initialization failure and an intermediate test splice are preserved;
the final17-case staged-app run occurs after those repairs.

Open: calibrated/trusted identity and original media, authority coverage/cutover,
the real WorkPort/finalizer/provider, notification delivery, model qualification
and browser/full-product acceptance. The single slot is not global across Gate
Face or server processes, and shielding does not hard-preempt native inference.
Neither this Backend source nor the AI commit is rolled out, pushed or merged.
