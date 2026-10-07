import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerSiteZoneAssignmentEntity } from './worker-site-zone-assignment.entity.js';
import { QrCredentialEntity, VisitorVisitEntity } from './qr-access.entity.js';

@Entity({ name: 'access_attempt' })
@Check('ck_attempt_subject', 'NOT (worker_id IS NOT NULL AND visit_id IS NOT NULL)')
@Check(
  'ck_attempt_identity',
  "identity_status <> 'MATCHED' OR ((worker_id IS NOT NULL) <> (visit_id IS NOT NULL))",
)
@Check(
  'ck_attempt_unidentified',
  "identity_status = 'MATCHED' OR (worker_id IS NULL AND worker_assignment_id IS NULL AND visit_id IS NULL)",
)
@Check(
  'ck_attempt_ready',
  "status NOT IN ('READY','USED') OR (identity_status = 'MATCHED' AND authorization_status = 'ALLOWED')",
)
@Check(
  'ck_attempt_manual_review',
  "status NOT IN ('READY','USED') OR method <> 'MANUAL' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
)
@Check(
  'ck_attempt_schedule_review',
  "status NOT IN ('READY','USED') OR direction = 'OUT' OR schedule_status <> 'NO_SCHEDULE' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
)
@Check('ck_attempt_interval', 'expires_at > created_at')
@Check(
  'ck_attempt_values',
  "direction IN ('IN','OUT') AND method IN ('FACE','QR','MANUAL') AND identity_status IN ('MATCHED','UNKNOWN','LOW_CONFIDENCE','QUALITY_FAILED','UNAVAILABLE') AND authorization_status IN ('ALLOWED','DENIED','REVIEW_REQUIRED','UNAVAILABLE') AND schedule_status IN ('SCHEDULED','OUTSIDE_SHIFT','NO_SCHEDULE','NOT_APPLICABLE') AND status IN ('PENDING','READY','DENIED','USED','EXPIRED')",
)
@Index('idx_attempt_site_created', ['siteId', 'createdAt'])
export class AccessAttemptEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_access_attempt_id' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_attempt_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'gate_id', type: 'varchar', length: 64 }) gateId!: string;
  @Column({ name: 'operator_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_attempt_operator', onDelete: 'RESTRICT' })
  operatorId!: string;
  @Column({ type: 'varchar', length: 3 }) direction!: 'IN' | 'OUT';
  @Column({ type: 'varchar', length: 10 }) method!: 'FACE' | 'QR' | 'MANUAL';
  @Column({ name: 'credential_id', type: 'uuid', nullable: true })
  @ForeignKey(() => QrCredentialEntity, { name: 'fk_attempt_credential', onDelete: 'RESTRICT' })
  credentialId!: string | null;
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_attempt_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;
  @Column({ name: 'worker_assignment_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerSiteZoneAssignmentEntity, {
    name: 'fk_attempt_assignment',
    onDelete: 'RESTRICT',
  })
  workerAssignmentId!: string | null;
  @Column({ name: 'visit_id', type: 'uuid', nullable: true })
  @ForeignKey(() => VisitorVisitEntity, { name: 'fk_attempt_visit', onDelete: 'RESTRICT' })
  visitId!: string | null;
  @Column({ name: 'identity_status', type: 'varchar', length: 32 }) identityStatus!: string;
  @Column({ name: 'authorization_status', type: 'varchar', length: 32 })
  authorizationStatus!: string;
  @Column({ name: 'schedule_status', type: 'varchar', length: 32 }) scheduleStatus!: string;
  @Column({ name: 'reason_code', type: 'varchar', length: 100 }) reasonCode!: string;
  @Column({ name: 'assignment_version', type: 'integer', nullable: true }) assignmentVersion!:
    number | null;
  @Column({ name: 'site_policy_version', type: 'integer', default: 1 }) sitePolicyVersion!: number;
  @Column({ type: 'varchar', length: 16 }) status!:
    'PENDING' | 'READY' | 'DENIED' | 'USED' | 'EXPIRED';
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_attempt_reviewer', onDelete: 'RESTRICT' })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote!: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'used_at', type: 'timestamptz', nullable: true }) usedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'gate_event' })
@Index('uq_gate_event_attempt', ['accessAttemptId'], { unique: true })
@Index('uq_gate_event_idempotency', ['idempotencyKey'], { unique: true })
@Check('ck_gate_event_subject', '(worker_id IS NOT NULL) <> (visit_id IS NOT NULL)')
@Check('ck_gate_event_direction', "direction IN ('IN','OUT')")
export class GateEventEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_gate_event_id' }) id!: string;
  @Column({ name: 'access_attempt_id', type: 'uuid' })
  @ForeignKey(() => AccessAttemptEntity, { name: 'fk_gate_event_attempt', onDelete: 'RESTRICT' })
  accessAttemptId!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_gate_event_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_gate_event_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;
  @Column({ name: 'visit_id', type: 'uuid', nullable: true })
  @ForeignKey(() => VisitorVisitEntity, { name: 'fk_gate_event_visit', onDelete: 'RESTRICT' })
  visitId!: string | null;
  @Column({ type: 'varchar', length: 3 }) direction!: 'IN' | 'OUT';
  @Column({ name: 'occurred_at', type: 'timestamptz' }) occurredAt!: Date;
  @Column({ name: 'gate_name', type: 'varchar', length: 100 }) gateName!: string;
  @Column({ name: 'idempotency_key', type: 'varchar', length: 150 }) idempotencyKey!: string;
  @Column({ name: 'recorded_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_gate_event_recorder', onDelete: 'RESTRICT' })
  recordedBy!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
