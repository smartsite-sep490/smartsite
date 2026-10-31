# Tracked frame v1.5 candidate

Status: explicit structural validator and synthetic examples only. Existing
observation/envelope intake remains closed to v1.5. This is not a qualified
tracker, episode migration, notification activation or production acceptance.

`validateTrackedObservationEvent` validates the new raw event version and reuses
v1.4 geometry/evidence/partition definitions. Schema registries must register the
local v1.4 schema before compiling v1.5; no HTTP schema retrieval is needed.
Versions v1.0–v1.4 and their canonical hashes remain unchanged. Do not add
continuity fields to those versions or rewrite pending outbox records.

## Producer claims

Each event retains the original observations array, exact capture metadata and
uint64 decimal frame sequence. `continuity` contains:

- `schemaVersion: '1.0.0'` and lowercase `profileSha256`. A claimed profile is
  not an approved profile; Backend must independently select and qualify it.
- `coverage`: `COMPLETE`, or `INCOMPLETE` with `INFERENCE_ERROR`,
  `AMBIGUOUS_PROCESSING` or `FRAME_DROPPED`. COMPLETE means the declared processing
  completed, not that every actual person or PPE item was detected.
- `subjects`: original part-local PERSON index, unique opaque segment UUID and
  either START with an explicit reason, or CONTINUE with the exact previous
  event/PERSON position. Every PERSON needs one claim in a COMPLETE part.
  INCOMPLETE parts retain observations but cannot claim subject continuity.
- `retiredSegments`: unique segment UUIDs with reset reasons, disjoint from
  active subjects in the same part. Retirement is technical continuity loss,
  never a Worker identity, Zone EXIT, permission decision or safe conclusion.

START/retirement reasons cover reconnect, ambiguous association, lost track,
frame discontinuity, changed view/configuration/profile and expired interval.
INITIAL is a START reason only. Numeric track IDs never replace segment scope.

Zero-observation events are allowed for **actual captured frames**, including a
captured empty scene or an unprocessable captured frame. They still require real
frame identity, timestamp, dimensions and sequence. An offline source or decode
failure without a captured frame cannot invent those fields; use the separately
admitted generation/timeout/control path. Missing transport is not an empty scene.
This parser cannot prove capture authenticity.

## Later authenticated admission obligations

Before TRACKED grouping/delivery, Backend must validate issued generation,
session, original LOADED receipt, view/bundle and qualified profile. Stable
continuity scope excludes receipt command ID: a fresh receipt for the same
bundle does not split a subject, while every original binding is checked.

The single-payload validator cannot establish predecessor existence, cross-part
or cross-frame uniqueness/order, permanent retirement, profile qualification,
source timing or full-frame completion. These require durable, scoped admission.
It only rejects in-part duplicate owners/forks and self-event predecessors.

All parts of a source frame must be assembled consistently before episode state
or notification delivery advances. Repeated subject context across oversized
parts is one subject. Retirements can be distributed over bounded parts; their
union must be consistent, unique and disjoint from active subjects. Incomplete
frames cannot declare absent people safe. Mixed PPE/MF06 findings must preserve
capture-time authorization and exactly one notification owner per finding.

Existing episode anchor provenance does not represent all subsequent frames:
multi-frame membership queries/DTOs, additive reviewed storage, revision races,
recipient scope and rollback remain separate tasks. No automatic route fallback
or per-frame EVENT_LOCAL notification is enabled by this contract.

## Examples and cross-repository order

`examples/v1.5/tracked-frame-vectors.json` contains four synthetic payload/hash
and existing binding-hash vectors: ten people/three affected, next frame with a
refreshed receipt, empty retirement claim and incomplete captured processing.
They are claims for structural review, not human labels or accepted deliveries.
The binding hash includes the canonical raw payload hash, so continuity changes
alter it without changing the existing binding algorithm.

Canonical Platform contract must merge first. AI then vendors exact schema bytes,
dependencies/examples and provenance from that immutable Main SHA and passes
paired checks. This source-only preparation does not perform either merge or
adopt the schema in AI/runtime. No numerical quality/gap threshold is selected
here; automatic delivery remains unavailable without qualified-profile evidence.
