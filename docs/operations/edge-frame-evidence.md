# Private frame upload from an AI host

This source implements the first LIVE evidence transport boundary. It is not an
enabled one-host-to-cloud release. It adds no database table or public object URL.

## HTTP boundary

`POST /api/v1/integrations/ai/tracked-parts/evidence` is registered only with an
explicit tracked-runtime profile. `AI_EVIDENCE_OBJECT_STORAGE_ENABLED` defaults
to `false`; the application service returns unavailable until explicitly enabled.
Both the existing AI service Bearer credential and exactly one
`X-Worker-Generation-Secret` header are required. No credentials go to the Web app.

Send multipart form data containing exactly three text fields and one file:

| Field           | Value                                                      |
| --------------- | ---------------------------------------------------------- |
| `schemaVersion` | `1.0.0`                                                    |
| `event`         | JSON of the original tracked observation part              |
| `context`       | JSON of its original worker delivery context               |
| `frame`         | Original JPEG bytes, `image/jpeg`, at most 1,048,576 bytes |

The text-field limit is 1,048,576 bytes per field; at most three fields and one
file are accepted. The request accepts no query configuration. The filename is
ignored; the server chooses its private event/payload-bound storage key. A hash
alone cannot address an image belonging to another event. Readers must derive
this scope from the authorized, validated stored event, never from client input.

The existing tracked authenticator validates camera scope, generation, profile,
issued configuration and original payload/context hashes. A JPEG must match a
`FRAME` hash and decoded dimensions from that validated event, have orientation
1, and fit the existing 16,000,000-pixel media-reader limit. `REVIEW_ONLY` and
REPLAY uploads are not supported by this initial LIVE boundary. Legacy replay
routes are unchanged.

Private object storage runs between two short authorization transactions. If the
generation ceases to qualify as LIVE or the binding changes during storage, no
receipt is returned. A private orphan object may remain; it is never made public
and is not deleted as compensation, since other events may share the same hash.

## Receipt and compatibility

Example response (all values synthetic):

```json
{
  "schemaVersion": "1.0.0",
  "kind": "EVIDENCE_STORED",
  "eventId": "11111111-1111-4111-8111-111111111111",
  "payloadHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bindingHash": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
}
```

`EVIDENCE_STORED` acknowledges bytes only. It is not a raw-event receipt, frame
seal, identity, access decision, violation or notification. The AI client must
compare all receipt bindings before continuing its existing outbox protocol.
An upload never replaces `RAW_STORED` or the tracked frame result request.

The additive canonical schema is `contracts/schemas/v1/ai-frame-evidence-receipt.json`.
Existing event JSON and local evidence URI remain unchanged. Canonical contract
review/merge must precede vendoring exact bytes and main-SHA provenance into the
AI repository. Do not hand-edit an AI vendored contract or claim paired delivery
before both producer and consumer checks pass.

## Scoped retrieval

When the same flag is enabled, tracked episode FRAME/SUBJECT requests use the
private object reader after the existing Site/role/event/finding checks. It
derives the event ID, original payload hash and image hash from the validated
stored evidence, verifies the original URI and JPEG dimensions again, and
mechanically crops only the selected stored PERSON box. Authorization is
rechecked after storage I/O by the existing query service. It never exposes
object keys or public URLs. With the flag off, existing LOCAL readers remain
unchanged. This does not yet rewire the separate C02 preview/Face preparation
readers; do not claim those workflows accept private cloud images.

## Activation checklist

- Preserve real PostgreSQL generation/revocation and scoped FRAME/SUBJECT checks.
- Qualify the separate C02 preview/Face preparation path before claiming identity integration.
- Implement AI receipt-bound upload/retry and classify permanent versus retryable errors.
- Bound orphan retention/capacity; qualify real private storage without exposing public URLs.
- Keep legacy LOCAL behavior and flags off until a reviewed deployment verifies the pair.
- Roll back by disabling the upload flag; never delete shared immutable objects to roll back.

Transport tests use generated JPEGs and fake credentials. Storage tests mock R2;
they do not demonstrate a real cloud upload, model accuracy or end-to-end release.
