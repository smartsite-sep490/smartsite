# MF06 stable external invocation across lease retries

Approved B4 requires a stable invocation reference across repeated external attempts. Face preparation previously generated a random UUID on every call, even for identical immutable request/media/model/candidate inputs.

Preparation now uses the request UUID only as a provisional local binding. After reading the real crop and eligible candidate snapshot, it hashes the domain MF06_FACE_INVOCATION_V1, the entire provisional invocation and exact ordered candidate array. It encodes the first128bits as custom UUIDv8 with version/variant bits, then reuses the existing binding helper to create the final invocation and full SHA256 binding. Only the rebound invocation is sent, inspected and returned.

Lease token/head/attempt/claimContextDigest do not enter the key. Model, original frame/crop, immutable request context, candidate revision/template or array order changes produce a new key. The actual reader orders by profile ID. No template is logged or persisted by this change; the new UUID is not an authorization credential or a substitute for full binding validation.

Root observed genuine RED: identical inputs generated different invocation IDs. Final44 affected cases across5files passed, including actual synthetic disk JPEG/crop, repeated inputs, reclaimed lease, changed model/candidate order/template/media, mutation protection, retry, timeout, cancellation and lease budget. Types, two-file lint, formatting and diff checks pass. A fresh isolated emit has41 JS files byte-identical to the executed output; no redundant green suite was needed. The current preparation fixture643lines retains existing media helpers, below700line exception.

Actual Agy P7 design and P5 final source reviews were read and checked by Root. Source inspection confirms the Python wire accepts UUID versions1–8; no Python model/service was started.

UUIDv8 layout reference: https://www.rfc-editor.org/rfc/rfc9562.html#section-5.8 . Uniqueness is implementation-specific; this deterministic key retains122 hash-derived bits. No collision-free or remote exactly-once guarantee is claimed.

Provider-side idempotency remains unverified and duplicate inference can still occur. No runtime provider, job consumption, AI/model/training, DB, permissions, website rollout or full MF06 acceptance.
Evidence: D:/Ky9-FPT/SmartSiteData/runs/rea-product-references-20261018-v1/configuration-source-current-20261019-v1/agy-backend-ai-20261020-v1/mf06-stable-invocation-proof-v1.json
