# MF06 Face transport candidate

This is reviewed source, not an activated worker, model, or accepted identity flow.
The paired AI source is local commit `d2867f8` in `evaluation-input-tooling`.

## Implemented boundary

- `SafetyIdentityResolverPort` now receives the correlated invocation, crop bytes
  and encrypted candidate templates with profile revisions. The default resolver
  remains unavailable and performs no network work.
- `HttpSafetyIdentityResolver` copies bytes and descriptor-safe metadata before
  awaiting. It checks the crop digest/JPEG framing, candidate uniqueness and a
  maximum of 32 candidates. Empty input is unavailable; excess input is rejected,
  never silently truncated. A future database reader must establish the complete
  eligible candidate set or explicitly refuse it.
- The fixed endpoint is `/v1/identity/safety-mf06/resolve` on the configured HTTP(S)
  origin. Credentials/query/fragment URLs are refused. Bearer credentials are sent
  only in headers; redirects and caching are disabled.
- JSON request budget is 3 MiB, crop budget 1 MiB, JSON response budget 32 KiB.
  The existing camera JSON reader was extracted into `fetchBoundedJson`; its camera
  wrapper retains the previous 1.5 MB budget and cancellation behavior.
- Correlated responses must carry `TRUSTED_SERVICE` and refer to an exact candidate
  hash/revision supplied in the request. This denotes the authenticated service
  channel, not calibrated biometric identity or permission to enter a Zone.
- The separate AI router validates strict fields, one authorization header, bounded
  streaming input, exact hashes, JPEG header/pixels/orientation and unique revisions.
  It reuses `FaceRecognizerProtocol` without importing a model implementation.
- Only matching verification/model IDs and an exact UTF-8 reference hash can produce
  a candidate. No raw reference, template, score, Worker ID or authority verdict is
  returned. Malformed/unconfigured providers remain unavailable.

## Actual bounded verification

- Backend: 10 focused cases passed: six new HTTP cases, default/malformed Safety
  port cases and two affected camera cancellation cases. TypeScript and six-file
  lint passed. Invalid response budgets were also checked to avoid calling fetch.
- AI: six fake-recognizer API cases passed, Ruff passed. They use small synthetic
  Pillow JPEGs, including malformed headers, excessive declared pixels and EXIF
  orientation controls. They do not load InsightFace, YOLO or a camera.
- Root retained initial missing-module failures, two deprecated Starlette constant
  failures and a real trailing-newline SHA acceptance failure before repairs.
- Three actual Python ASGI responses passed through the TypeScript HTTP adapter:
  baseline, offset/nanosecond timestamp with uppercase UUID, and the existing
  leap-second normalization. This is synthetic cross-language wire proof.
- Additional fake-provider checks covered empty candidates, malformed/unversioned
  results and cooperative timeout cancellation. Neither the Python timeout nor
  these fixtures proves hard preemption of synchronous native inference.

## Review rulings and remaining work

- Exact candidate revision echo is intentional; do not silently normalize a service
  response. Absolute endpoint construction follows the existing identity URL pattern.
- Missing model version remains service-unavailable, including a non-match response;
  it is not evidence that the requested model completed recognition.
- Existing Access/enrollment/MF08 source was not changed. Five preexisting AI source
  hashes were checked unchanged, and the new router is not mounted in `app.py`.
- The real consent-scoped candidate query, WorkPort composition, historical authority
  coverage and worker lifecycle still need integration. No runtime provider, database
  rollout, model loading, production identity acceptance or browser proof is implied.
- Observation v1.2 producer vendoring still requires the immutable Main contract gate.
  No push, merge, deployment, training or camera capture was performed here.
