import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { ZoneEntryAssessmentRequestEntity } from './zone-entry-assessment-request.entity.js';
import { ZoneEntryAuthorityArtifactEntity } from './zone-entry-authority-artifact.entity.js';
export type Mf06AssessmentOutcome = 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';
export type Mf06AssessmentProvenance = 'UNAVAILABLE' | 'SYNTHETIC_TEST' | 'TRUSTED_SERVICE';
export type Mf06AssessmentReasonCode =
  | 'INVALID_BINDING'
  | 'IDENTITY_UNAVAILABLE'
  | 'MEDIA_UNAVAILABLE'
  | 'PROFILE_REVOKED'
  | 'AUTHORITY_UNAVAILABLE'
  | 'SERVICE_DISABLED'
  | 'ABORTED'
  | 'POLICY_NONE'
  | 'POLICY_PROHIBITED'
  | 'AUTHORIZED'
  | 'UNAUTHORIZED';

/**
 * Private immutable storage projection. Never a safe public DTO, identity
 * assertion, or permission grant. Candidate migration deployment is separate.
 */
@Entity({ name: 'mf06_assessment' })
@Unique('mf06_assessment_request_id_key', ['requestId'])
@Unique('mf06_assessment_command_id_key', ['commandId'])
@Unique('mf06_assessment_authority_artifact_id_key', ['authorityArtifactId'])
@ForeignKey(() => ZoneEntryAssessmentRequestEntity, ['requestId'], ['requestId'], {
  name: 'mf06_assessment_request_id_fkey',
  onDelete: 'RESTRICT',
})
@ForeignKey(
  () => ZoneEntryAuthorityArtifactEntity,
  ['authorityArtifactId', 'requestId'],
  ['artifactId', 'requestId'],
  {
    name: 'fk_mf06_assessment_artifact',
    onDelete: 'RESTRICT',
  },
)
@Index('idx_mf06_assessment_site_time', ['siteId', 'assessedAt', 'assessmentId'])
@Check('mf06_assessment_command_hash_check', "command_hash ~ '^[0-9a-f]{64}$'")
@Check('mf06_assessment_binding_hash_check', "binding_hash ~ '^[0-9a-f]{64}$'")
@Check('mf06_assessment_frame_sha256_check', "frame_sha256 ~ '^[0-9a-f]{64}$'")
@Check('mf06_assessment_crop_sha256_check', "crop_sha256 ~ '^[0-9a-f]{64}$'")
@Check('mf06_assessment_outcome_check', "outcome IN ('ALLOWED','DENIED','UNAVAILABLE')")
@Check(
  'mf06_assessment_provenance_check',
  "provenance IN ('UNAVAILABLE','SYNTHETIC_TEST','TRUSTED_SERVICE')",
)
@Check(
  'mf06_assessment_evaluator_version_check',
  'char_length(evaluator_version)>0 AND evaluator_version=btrim(evaluator_version)',
)
@Check('mf06_assessment_claim_head_revision_check', 'claim_head_revision > 0')
@Check('mf06_assessment_assessed_at_check', 'isfinite(assessed_at)')
@Check(
  'mf06_assessment_check',
  "(outcome='ALLOWED' AND reason_code IN ('POLICY_NONE','AUTHORIZED')) OR " +
    "(outcome='DENIED' AND reason_code IN ('POLICY_PROHIBITED','UNAUTHORIZED')) OR " +
    "(outcome='UNAVAILABLE' AND reason_code IN ('INVALID_BINDING','IDENTITY_UNAVAILABLE','MEDIA_UNAVAILABLE','PROFILE_REVOKED','AUTHORITY_UNAVAILABLE','SERVICE_DISABLED','ABORTED'))",
)
@Check('mf06_assessment_check1', "outcome='UNAVAILABLE' OR authority_artifact_id IS NOT NULL")
@Check(
  'mf06_assessment_check2',
  "reason_code NOT IN ('AUTHORIZED','UNAUTHORIZED') OR (worker_id IS NOT NULL AND profile_revision IS NOT NULL AND frame_sha256 IS NOT NULL AND crop_sha256 IS NOT NULL AND provenance<>'UNAVAILABLE')",
)
export class ZoneEntryAssessmentEntity {
  @PrimaryColumn({
    name: 'assessment_id',
    type: 'uuid',
    primaryKeyConstraintName: 'mf06_assessment_pkey',
    update: false,
  })
  assessmentId!: string;

  @Column({ name: 'request_id', type: 'uuid', update: false })
  requestId!: string;

  @Column({ name: 'command_id', type: 'uuid', update: false })
  commandId!: string;

  @Column({ name: 'command_hash', type: 'char', length: 64, update: false })
  commandHash!: string;

  @Column({ name: 'site_id', type: 'uuid', update: false })
  siteId!: string;

  @Column({ name: 'event_id', type: 'uuid', update: false })
  eventId!: string;

  @Column({ name: 'binding_hash', type: 'char', length: 64, update: false })
  bindingHash!: string;

  @Column({ name: 'outcome', type: 'varchar', length: 16, update: false })
  outcome!: Mf06AssessmentOutcome;

  @Column({ name: 'reason_code', type: 'varchar', length: 32, update: false })
  reasonCode!: Mf06AssessmentReasonCode;

  @Column({ name: 'evaluator_version', type: 'varchar', length: 128, update: false })
  evaluatorVersion!: string;

  @Column({ name: 'provenance', type: 'varchar', length: 16, update: false })
  provenance!: Mf06AssessmentProvenance;

  @Column({ name: 'worker_id', type: 'uuid', nullable: true, update: false })
  workerId!: string | null;

  @Column({ name: 'profile_revision', type: 'uuid', nullable: true, update: false })
  profileRevision!: string | null;

  @Column({ name: 'frame_sha256', type: 'char', length: 64, nullable: true, update: false })
  frameSha256!: string | null;

  @Column({ name: 'crop_sha256', type: 'char', length: 64, nullable: true, update: false })
  cropSha256!: string | null;

  @Column({
    name: 'authority_artifact_id',
    type: 'uuid',
    nullable: true,
    update: false,
  })
  authorityArtifactId!: string | null;

  @Column({ name: 'claim_head_revision', type: 'integer', update: false })
  claimHeadRevision!: number;

  @Column({ name: 'claim_lease_token', type: 'uuid', update: false })
  claimLeaseToken!: string;

  /** DB-owned append clock; generated by trigger and immutable. */
  @CreateDateColumn({
    name: 'assessed_at',
    type: 'timestamptz',
    default: () => 'clock_timestamp()',
    insert: false,
    update: false,
  })
  assessedAt!: Date;
}
