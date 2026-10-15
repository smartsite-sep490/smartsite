// Frozen historical test fixture from Product 587faebbd1e7f9481d485d97ede92d507c51ccce.
// Test-only legacy24 protocol; never import into production modules.
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
import { Mf06AssessmentRequestEntity } from './mf06-assessment-request.entity.js';
import { Mf06AuthorityArtifactEntity } from './mf06-authority-artifact.entity.js';
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
@Unique('uq_mf06_assessment_request', ['requestId'])
@Unique('uq_mf06_assessment_command', ['commandId'])
@Unique('uq_mf06_assessment_artifact', ['authorityArtifactId'])
@ForeignKey(() => Mf06AssessmentRequestEntity, ['requestId'], ['requestId'], {
  name: 'fk_mf06_assessment_request',
  onDelete: 'RESTRICT',
})
@ForeignKey(
  () => Mf06AuthorityArtifactEntity,
  ['authorityArtifactId', 'requestId'],
  ['artifactId', 'requestId'],
  {
    name: 'fk_mf06_assessment_artifact',
    onDelete: 'RESTRICT',
  },
)
@Index('idx_mf06_assessment_site_time', ['siteId', 'assessedAt', 'assessmentId'])
@Check('chk_mf06_assessment_command_hash', "command_hash ~ '^[0-9a-f]{64}$'")
@Check('chk_mf06_assessment_binding_hash', "binding_hash ~ '^[0-9a-f]{64}$'")
@Check('chk_mf06_assessment_frame_sha256', "frame_sha256 ~ '^[0-9a-f]{64}$'")
@Check('chk_mf06_assessment_crop_sha256', "crop_sha256 ~ '^[0-9a-f]{64}$'")
@Check('chk_mf06_assessment_outcome', "outcome IN ('ALLOWED','DENIED','UNAVAILABLE')")
@Check(
  'chk_mf06_assessment_provenance',
  "provenance IN ('UNAVAILABLE','SYNTHETIC_TEST','TRUSTED_SERVICE')",
)
@Check(
  'chk_mf06_assessment_evaluator_version',
  'char_length(evaluator_version)>0 AND evaluator_version=btrim(evaluator_version)',
)
@Check('chk_mf06_assessment_claim_head_revision', 'claim_head_revision > 0')
@Check('chk_mf06_assessment_assessed_at', 'isfinite(assessed_at)')
@Check(
  'chk_mf06_assessment_outcome_reason',
  "(outcome='ALLOWED' AND reason_code IN ('POLICY_NONE','AUTHORIZED')) OR " +
    "(outcome='DENIED' AND reason_code IN ('POLICY_PROHIBITED','UNAUTHORIZED')) OR " +
    "(outcome='UNAVAILABLE' AND reason_code IN ('INVALID_BINDING','IDENTITY_UNAVAILABLE','MEDIA_UNAVAILABLE','PROFILE_REVOKED','AUTHORITY_UNAVAILABLE','SERVICE_DISABLED','ABORTED'))",
)
@Check(
  'chk_mf06_assessment_artifact_required',
  "outcome='UNAVAILABLE' OR authority_artifact_id IS NOT NULL",
)
@Check(
  'chk_mf06_assessment_identity_completeness',
  "reason_code NOT IN ('AUTHORIZED','UNAUTHORIZED') OR (worker_id IS NOT NULL AND profile_revision IS NOT NULL AND frame_sha256 IS NOT NULL AND crop_sha256 IS NOT NULL AND provenance<>'UNAVAILABLE')",
)
export class Mf06AssessmentEntity {
  @PrimaryColumn({
    name: 'assessment_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_mf06_assessment',
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
