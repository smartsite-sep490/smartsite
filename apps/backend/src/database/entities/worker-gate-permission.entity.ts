import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { WorkerEntity } from './worker.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerSiteZoneAssignmentEntity } from './worker-site-zone-assignment.entity.js';

@Entity({ name: 'worker_gate_permission' })
@Index('idx_worker_gate_permission_lookup', ['workerId', 'siteId', 'gateId', 'revokedAt'])
@Check('chk_worker_gate_permission_interval', 'valid_until IS NULL OR valid_until > valid_from')
@Check('chk_worker_gate_permission_gate', "gate_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'")
export class WorkerGatePermissionEntity {
  @Column({ name: 'worker_assignment_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerSiteZoneAssignmentEntity, {
    name: 'fk_gate_permission_assignment',
    onDelete: 'RESTRICT',
  })
  workerAssignmentId!: string | null;
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_worker_gate_permission_id' })
  id!: string;
  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, {
    name: 'fk_worker_gate_permission_worker',
    onDelete: 'RESTRICT',
  })
  workerId!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_worker_gate_permission_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'gate_id', type: 'varchar', length: 64 })
  gateId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_worker_gate_permission_creator', onDelete: 'RESTRICT' })
  createdByUserId!: string;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_worker_gate_permission_revoker', onDelete: 'RESTRICT' })
  revokedByUserId!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
