# Eight-family observation candidate v1.3

The model class list contains eight PPE families, but existing v1.1/v1.2 wire
contracts and the active pipeline expose only five. This change adds an explicit
versioned schema and validator entrypoint; it does not enable those model classes.

## Exact technical semantics

- PERSON stays a separate observation with its technical Track ID, never Worker ID.
- v1.3 accepts HARD_HAT, SAFETY_VEST, GLOVES, BOOTS, GOGGLES, MASK,
  FULL_BODY_HARNESS and LANYARD_HOOK as PPE observations scoped to a Track/Region.
- MASK supports explicit PRESENT/MISSING evidence. It denotes a visual face covering,
  not respirator certification, filtration or fit.
- Harness and Hook accept PRESENT only in this selected 15-class protocol. Neither
  has an explicit negative detector class. Absence/UNKNOWN cannot become MISSING;
  a detected Hook does not prove safe anchorage or fall-protection compliance.
- FRAME/CROP/SNAPSHOT require a lowercase 64-character SHA-256. The digest binds
  bytes into an event payload, not identity, wearer accuracy or authorization.
- Unknown fields, invalid geometry and collection bounds retain the v1.2 rules.

`validateEightFamilyObservationEvent` validates only v1.3. Existing
`validateObservationEvent` retains its v1/v1.1/v1.2 admission and still rejects v1.3.
No existing consumer opts in, including MF08/Access. Global PPE_ITEMS, database
enums, Zone policies, UI controls, producer mappings and frozen schema bytes remain
unchanged until their separate processing/capability gates are qualified.

## Actual source evidence

- Four new cases plus fourteen affected old contract cases passed; TypeScript and
  changed-file lint were checked separately.
- A 39-input Python Draft202012/Ajv comparison covers all eight item/status pairs and
  missing/malformed digests on each evidence kind. Root observed three Python cases
  wrongly accepting a trailing newline, then added min/max length only to v1.3.
- The same 39 inputs now agree; the old consumer rejects v1.3 in every case. Root
  independently compared all three old schema SHA values and the exact structural
  delta to v1.2. Only version/ID, item names, positive-only rules and digest length vary.
- The initial missing-export compile failure and one qualification fixture-path
  failure are retained. These checks use synthetic JSON, not model or human GT.
- Agy reviewed the schema/entrypoint and identified the real five-versus-eight gap.
  Its broad no-defects conclusion is not full-flow or production acceptance.

## Required follow-up

Canonical Main provenance is still required before AI vendoring. Any Main patch must
keep legacy admission opt-in and qualify ingestion, item processing, policy semantics
and evidence consumers together. The earlier five-item v1.1/v1.2 draft is reference
material; it does not satisfy the eight-family goal and must not silently activate.

Producer mapping, wearer/region association, six explicit-negative families versus
two positive-only families, capability display, reviewed data/model evaluation and
real camera/video/Backend/Web acceptance all remain required. No model, training,
capture, migration, runtime restart, push, merge or deployment occurred here.
