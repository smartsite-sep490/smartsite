# Schema extensions and physical names

The owner70-table ERD remains unchanged. Tuấn approved naming and preserving
the extension structure in chat17/10; this is not recorded as leader/Root approval.
Implementation is local only. See [audit](tuan-db-erd-audit.md) and [mapping](tuan-db-erd-mapping.csv).

## Assessment entities

| Business class                   | Current physical table        |
| -------------------------------- | ----------------------------- |
| ZoneEntryAssessmentRequestEntity | zone_entry_assessment_request |
| ZoneEntryAssessmentJobEntity     | zone_entry_assessment_job     |
| ZoneEntryAssessmentEntity        | zone_entry_assessment         |
| ZoneEntryAuthorityArtifactEntity | zone_entry_authority_artifact |

## Forward storage mapping

| Historical physical table           | Current physical table                   |
| ----------------------------------- | ---------------------------------------- |
| mf06_assessment_request             | zone_entry_assessment_request            |
| mf06_assessment_job                 | zone_entry_assessment_job                |
| mf06_assessment                     | zone_entry_assessment                    |
| mf06_authority_artifact             | zone_entry_authority_artifact            |
| mf06_authority_source               | authorization_history_source             |
| mf06_authority_command              | authorization_history_command            |
| mf06_authority_fact                 | authorization_history_revision           |
| mf06_authority_commit_witness       | authorization_history_commit_receipt     |
| mf06_authority_gap                  | authorization_history_gap                |
| mf06_authority_head                 | authorization_history_head               |
| mf06_authority_epoch                | authorization_history_epoch              |
| mf06_authority_control              | authorization_history_control            |
| mf06_authority_baseline             | authorization_history_baseline           |
| mf06_assignment_command_result      | worker_assignment_command_receipt        |
| mf06_participation_command_result   | contractor_participation_command_receipt |
| mf06_zone_permission_command_result | zone_permission_command_receipt          |
| mf06_zone_deny_command_result       | zone_access_denial_command_receipt       |

The separate `safety_face_consent` and `safety_face_consent_revocation` tables remain.
The mapping CSV explains why each request/job/result/archive/history/receipt needs
separate persistence. No consolidation, row deletion or new business permission was approved.

Seven earlier additional columns and12 inherited VisitorRoster columns are retained;
three CHECK extensions and three index-sort differences inherited Main are explicit in the audit.

Physical rename is migration1792454400000, after notification compatibility bridges
1792010000000/1792368000001. Applied migration classes and frozen fixtures keep their
historical identifiers/bytes. Existing PK/FK/index/trigger names remain for compatibility.

Only exact17 table identifiers and16 reviewed function bodies change. Separate legacy
`zone_authority_*` data remains intact. Old-name journal detection remains deny-only:
runtime must not silently use legacy storage or write without journal attribution.

Public API/DTO/enums, event IDs/hashes and archived V1/V2 machine vocabulary remain stable.
An `mf06` service/route identifies a flow; it no longer defines these physical table names.
No AI worker, READY epoch, real consent or identity is enabled by naming changes.
