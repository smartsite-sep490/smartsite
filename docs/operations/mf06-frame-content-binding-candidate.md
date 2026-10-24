# MF06 original-frame content binding candidate

## Problem

Observation versions 1.0.0 and 1.1.0 bind evidence URIs into the immutable event
payload hash, but do not bind JPEG content digests. The current local publisher
avoids overwriting its own files; this alone cannot detect later replacement of a
file before asynchronous MF06 assessment.

## Candidate contract

- New wire version: `1.2.0`, based on existing `1.1.0` observation semantics.
- Every evidence item requires `sha256`, exactly 64 lowercase hexadecimal characters.
- The producer computes this from the exact published bytes, including JPEG encoding.
- The Backend's canonical payload hash consequently binds that digest to the event
  and its assessment request. A later reader must compare actual bytes with it.
- FRAME/CROP/SNAPSHOT use the same digest rule. Empty evidence remains a valid
  technical observation and is insufficient for media-backed assessment.
- Older schema files remain byte-for-byte unchanged. No existing event or hash is rewritten.
- No claim is made that checksum equality proves camera ownership, Worker identity,
  consent, PPE accuracy or Zone authority.

## Rollout boundaries

The local candidate passed six new focused cases plus eight affected legacy PPE
compatibility cases (14 total), TypeScript compilation and changed-file lint.
The initial validator produced four RED/two PASS before implementation. A separate
JSON comparison confirmed only the reviewed new-version changes and byte-identical
old schemas. These checks do not execute a producer, storage reader or MF06 worker.

This is a local canonical-contract candidate, not deployed functionality. Keep the
existing repository rule: review/merge canonical contracts on Main first, then
vendor exact schema bytes from an immutable approved Main commit into the AI
repository. Do not relabel a local candidate commit as Main provenance.

Qualify consumer acceptance before explicit producer opt-in. Older envelopes
without a bound digest remain readable for their existing uses; they cannot be
silently upgraded to capture-time media proof. Never substitute a configuration
image, fabricate an alert mapping, or modify MF08 evidence services for this flow.

The MF06 reader, deterministic subject crop, consent/profile inputs, authority
history and real WorkPort activation remain separate implementation gates. This
document does not authorize training, runtime changes, push, merge or deployment.
