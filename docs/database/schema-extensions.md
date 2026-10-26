# Schema extension inventory

## C03 Zone policy provenance extension

`ZonePolicyRevisions1793664000000` adds the eight-column `zone_policy_revision`
table. See [exact column/FK/rollback mapping](zone-policy-revisions.md) and the
[additive DBML](zone-policy-revisions.dbml). Existing baseline ERD bytes, Zone
columns and immutable Region history remain unchanged. This is the policy-history
prerequisite; bundle issuance, worker application and rollout remain separate.

The owner's70-table ERD remains the baseline. This inventory describes current
implementation differences; it does not replace or approve a new ERD.

## Assessment classes corrected in source

| Previous class | Current business class | Existing physical storage |
|---|---|---|
| Mf06AssessmentRequestEntity | ZoneEntryAssessmentRequestEntity | mf06_assessment_request |
| Mf06AssessmentJobEntity | ZoneEntryAssessmentJobEntity | mf06_assessment_job |
| Mf06AssessmentEntity | ZoneEntryAssessmentEntity | mf06_assessment |
| Mf06AuthorityArtifactEntity | ZoneEntryAuthorityArtifactEntity | mf06_authority_artifact |

The table mapping stays explicit. Public API enums, event identifiers, assessment
payloads and historical migration identities have not been renamed. Frozen
legacy test bytes remain unchanged; their adapter maps exact known constructors.

## Additional storage and purpose

| Existing relation | Purpose |
|---|---|
| mf06_assessment_request | Immutable original observation/region/subject binding |
| mf06_assessment_job | Bounded claim, lease, retry and completion state |
| mf06_assessment | Immutable assessment result with provenance and claim binding |
| mf06_authority_artifact | Bounded immutable authority archive used by an assessment |
| mf06_authority_source | Source-field registry for captured authorization facts |
| mf06_authority_command | Actor-bound command and transaction attribution |
| mf06_authority_fact | Append-only source revisions |
| mf06_authority_commit_witness | Post-commit witness; absence is not confirmation |
| mf06_authority_gap | Explicit gaps that prevent trusted history |
| mf06_authority_head | Captured revision head |
| mf06_authority_epoch | Capture/cutover epoch; no automatic READY adoption |
| mf06_authority_control | Active capture control |
| mf06_authority_baseline | Explicit source baseline/cutover record |
| mf06_assignment_command_result | Assignment command replay receipt |
| mf06_participation_command_result | Contractor participation command replay receipt |
| mf06_zone_permission_command_result | Zone permission command replay receipt |
| mf06_zone_deny_command_result | Explicit Zone deny command replay receipt |
| safety_face_consent | Safety-specific consent provenance; not inferred from a profile |
| safety_face_consent_revocation | Append-only Safety consent revocation |

Seven observed additional columns on baseline tables are `face_profile.safety_revision`,
`shift.allowed_exit_minutes`, `shift.max_exit_count`, and `attendance_day.allowed_exit_minutes`,
`attendance_day.max_exit_count`, `attendance_day.exit_count`, `attendance_day.deducted_minutes`.
The attendance columns arrived through Main; do not remove them to match an older
snapshot without reconciling Main's attendance contract.

## Open integration work

### Camera authoring references — 26 October 2026

`CameraConfigurationReferences1793491200000` adds two business-named tables,
`camera_view_revision` and `camera_configuration_reference`, with 25 new columns
and no alteration to the owner's baseline tables. The exact physical mapping,
constraints, foreign keys and rollback boundary are documented in
[camera-configuration-references.md](camera-configuration-references.md).
Both records describe unconfirmed authoring provenance, not Worker identity,
camera movement detection, verified geometry or worker application. Immutable
reference metadata and retired contexts remain available for later binding.
The source endpoint requires this migration; no runtime/demo/cloud database
cutover is authorized by publishing it. Old image reads remain compatible.

### Exact subject provenance extension — 23 October 2026

`AlertDetectionSubject1793404800000` adds only
`alert_detection_mapping.person_observation_index SMALLINT NULL`, constrained by
`chk_mapping_person_observation_index` to0..255 (all current event schemas cap
observations at256). It indexes the immutable event's original observations array;
NULL means unresolved or legacy. It is neither a Worker ID nor a verified identity.
The existing composite PK and both alert/event FKs retain their names and actions.
No new table, index or FK to optional human identity decisions is introduced.

Existing rows remain NULL; replay does not backfill them. New ingestion stores a
value only when every candidate for a returned alertId has the same unique PERSON.
The migration runs transactionally. Downgrade locks the mapping table before
checking provenance and refuses to drop populated values. Apply this migration
before the new Backend; old Backend remains compatible with the nullable column.
The owner ERD baseline stays untouched. This extension is source/test scope, not
approval or execution of a demo/cloud/production database cutover.

The saved migrated58 catalog at pushed checkpoint `675d29e` was compared against
the byte-pinned owner file:735 column type/nullability pairs and234 named foreign
keys (columns, targets, delete/update actions) matched with zero differences.
This reuses a saved catalog; it is not a fresh production-database inspection.
Defaults, CHECK expressions, indexes and triggers are outside that comparison.
The current repair leaves historical migration bytes unchanged.

- Compare baseline types, nullability, defaults, constraints and FK semantics;
  identifier coverage alone is insufficient.
- Coordinate physical naming changes with Tuấn before concurrent DDL edits.
  Use a forward migration and test populated upgrade, triggers/functions, replay
  receipts, archives and rollback. Never alter already-applied migration bytes.
- Do not blindly replace `mf06_authority_*` with `zone_authority_*`: a retired
  branch schema already uses several of those names.
- This repair does not migrate production or establish Face/identity/model trust.

## Camera Region immutable state history

`CameraRegionGeometryRevisions1793577600000` adds the14-column
`camera_region_geometry_revision` table plus composite supporting unique keys on
Region and authoring reference. It records polygon, active state, version and
truthful cutover provenance in existing configuration transactions. See
[column/FK mappings and rollback boundary](camera-region-geometry-revisions.md).
This migration does not activate new reference-bound commands or change website/cloud databases.
