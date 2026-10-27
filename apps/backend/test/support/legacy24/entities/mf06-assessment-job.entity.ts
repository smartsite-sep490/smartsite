// Frozen historical test fixture from Product 587faebbd1e7f9481d485d97ede92d507c51ccce.
// Test-only legacy24 protocol; never import into production modules.
import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { Mf06AssessmentRequestEntity } from './mf06-assessment-request.entity.js';

export type Mf06AssessmentJobStatus = 'PENDING' | 'CLAIMED' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** Operational head only; transitions and lease ownership require the later CAS worker. */
@Entity({ name: 'mf06_assessment_job' })
@ForeignKey(() => Mf06AssessmentRequestEntity, ['requestId'], ['requestId'], {
  name: 'fk_mf06_job_request',
  onDelete: 'RESTRICT',
})
@Index('idx_mf06_job_pending', ['nextAttemptAt', 'requestId'], { where: "status = 'PENDING'" })
@Index('idx_mf06_job_claimed', ['leaseExpiresAt', 'requestId'], { where: "status = 'CLAIMED'" })
@Check('chk_mf06_job_status', "status IN ('PENDING','CLAIMED','SUCCEEDED','FAILED','CANCELLED')")
@Check('chk_mf06_job_counters', 'attempt_count >= 0 AND head_revision >= 1')
@Check(
  'chk_mf06_job_lease',
  "(status='CLAIMED' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status<>'CLAIMED' AND lease_token IS NULL AND lease_expires_at IS NULL)",
)
@Check(
  'chk_mf06_job_times',
  'isfinite(created_at) AND isfinite(updated_at) AND isfinite(next_attempt_at) AND isfinite(deadline_at) AND deadline_at > created_at AND (lease_expires_at IS NULL OR (isfinite(lease_expires_at) AND lease_expires_at <= deadline_at))',
)
@Check(
  'chk_mf06_job_error_code',
  "last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'",
)
export class Mf06AssessmentJobEntity {
  @PrimaryColumn({ name: 'request_id', type: 'uuid', primaryKeyConstraintName: 'pk_mf06_job' })
  requestId!: string;

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: Mf06AssessmentJobStatus;

  @Column({ name: 'attempt_count', type: 'integer' })
  attemptCount!: number;

  @Column({ name: 'head_revision', type: 'integer' })
  headRevision!: number;

  @Column({ name: 'lease_token', type: 'uuid', nullable: true })
  leaseToken!: string | null;

  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt!: Date;

  @Column({ name: 'deadline_at', type: 'timestamptz' })
  deadlineAt!: Date;

  @Column({ name: 'last_error_code', type: 'varchar', length: 64, nullable: true })
  lastErrorCode!: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'statement_timestamp()',
  })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'statement_timestamp()' })
  updatedAt!: Date;
}
