import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { ContractorSiteParticipationEntity } from './contractor-site-participation.entity.js';

export enum WorkerSiteZoneAssignmentStatus {
  PENDING = 'PENDING',
  SAFETY_REVIEWED = 'SAFETY_REVIEWED',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  REVOKED = 'REVOKED',
  EXPIRED = 'EXPIRED',
}

@Entity({ name: 'worker_site_zone_assignment' })
@Check('chk_assignment_gate_id', "gate_id IS NULL OR gate_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'")
@Index('idx_worker_site_zone_assignment_gate_lookup', ['workerId', 'siteId', 'status', 'validFrom'])
@Check(
  'chk_worker_site_zone_assignment_status',
  "status IN ('PENDING', 'SAFETY_REVIEWED', 'APPROVED', 'REJECTED', 'CANCELLED', 'REVOKED', 'EXPIRED')",
)
@Check(
  'chk_worker_site_zone_assignment_interval',
  'valid_until IS NULL OR valid_until > valid_from',
)
@Check('chk_worker_site_zone_assignment_zone_ids', 'cardinality(zone_ids) > 0')
export class WorkerSiteZoneAssignmentEntity {
  @Column({ name: 'site_contractor_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ContractorSiteParticipationEntity, {
    name: 'fk_assignment_participation',
    onDelete: 'RESTRICT',
  })
  siteContractorId!: string | null;
  @Column({ type: 'integer', default: 1 })
  version!: number;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_worker_site_zone_assignment_id' })
  id!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, {
    name: 'fk_worker_site_zone_assignment_worker',
    onDelete: 'RESTRICT',
  })
  workerId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, {
    name: 'fk_worker_site_zone_assignment_site',
    onDelete: 'RESTRICT',
  })
  siteId!: string;

  /** Null preserves existing site-wide assignments; explicit values restrict a gate. */
  @Column({ name: 'gate_id', type: 'varchar', length: 64, nullable: true })
  gateId!: string | null;

  @Column({ name: 'zone_ids', type: 'uuid', array: true })
  zoneIds!: string[];

  @Column({ type: 'varchar', length: 32 })
  status!: WorkerSiteZoneAssignmentStatus;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  @Column({ name: 'requested_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_worker_site_zone_assignment_requester',
    onDelete: 'RESTRICT',
  })
  requestedByUserId!: string;

  @Column({ name: 'safety_reviewed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, {
    name: 'fk_worker_site_zone_assignment_safety_reviewer',
    onDelete: 'RESTRICT',
  })
  safetyReviewedByUserId!: string | null;

  @Column({ name: 'site_manager_decided_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, {
    name: 'fk_worker_site_zone_assignment_site_manager',
    onDelete: 'RESTRICT',
  })
  siteManagerDecidedByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
