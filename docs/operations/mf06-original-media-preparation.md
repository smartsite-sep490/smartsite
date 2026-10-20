# MF06 claim-bound original media preparation

This is private Backend source, not a registered runtime worker or a live Face integration.

## Implemented boundary

- `selectMf06FrameReference` validates the local observation v1.2 candidate and
  canonical payload hash against the claimed event/session. It selects one distinct
  local FRAME URI/digest; identical repeats are harmless, conflicting or malformed
  references are unavailable. Returned scalar fields/dimensions are copied and frozen.
- `Mf06ClaimContextReader` projects that reference before its final active-lease
  check. Legacy events still match their existing context but have no bound frame
  reference. The reference itself does not require or establish a PERSON identity.
- `readMf06SubjectMedia` checks the selected subject's event/session/payload hash,
  configured directory, containment, regular file and no-symlink boundaries. It
  reads through an owned descriptor with a fixed maximum of 1 MiB + one overflow
  byte, checks file identity/size/change timestamps, JPEG framing and event-bound SHA.
- The existing `cropSafetySubjectFrame` verifies decoded dimensions/orientation and
  produces the subject crop and its hash. Frame/crop limits are 1 MiB and 16M pixels.
- The existing Store descriptor-safe JSON copier is reused by Store, reference
  selection and media input capture. Its function body and limits are unchanged;
  accessors, hooks, cycles, unsupported prototypes and oversized JSON are refused.
- Failures return unavailable media without publishing filesystem/decoder details.

## Bounded evidence

Agy authored selector, media, projection and PG cases; Root executed and reviewed them.
Initial selector cases: 3 RED / 2 PASS. Initial media cases: 4 RED. Projection: 1 RED.
Independent review exposed accessor invocation; two added cases were RED before reuse
of the descriptor-safe copier. Final selected run: 16 PASS across four test files,
including three affected Store format cases. A separate canonical70 PostgreSQL case
passed with stored v1.2 JSON, the bound reference, token/revision refusal and pg_temp
protection. This used an owned disposable schema on dedicated 5433, not the website.

The media fixtures contain small synthetic JPEGs, not human identity or PPE ground
truth. Actual root-junction creation/refusal ran on Windows. This does not establish
every filesystem race, mid-read cancellation or cross-platform behavior.

## Review rulings and remaining gates

- JSON stringify/parse was rejected for untrusted metadata because it invokes hooks.
- A frame reference may exist without a selected subject. It is technical event media;
  the crop boundary still requires a matching subject. Request payload hashing already
  binds the evidence digest, so the claim-context digest protocol was not rewritten.
- Hardlink count is not original-byte evidence; the publisher itself uses atomic
  linking. Descriptor checks and the bound content digest remain the acceptance gate.
- URI case normalization does not bypass event/session/digest matching or introduce
  a remote fetch. The reader constructs the flat UUID filename rather than using URI paths.
- Cancellation is cooperative around OS calls and the existing pixel-bounded Sharp
  decoder. Hard preemption and workload/capacity acceptance remain unproven.
- AI contract vendoring still requires the approved immutable Main provenance gate.
  No producer, camera, model, worker scheduler or website was started or upgraded here.
- WorkPort orchestration, trusted Face/profile/consent resolution, historical authority
  evaluation, persistence and real end-to-end acceptance remain separate open gates.
