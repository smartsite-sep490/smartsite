import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ContractorSiteParticipationEntity } from './contractor-site-participation.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerSiteZoneAssignmentEntity } from './worker-site-zone-assignment.entity.js';

@Entity({ name: 'contractor_zone_permission' })
@Check('ck_contractor_zone_interval', 'valid_until > valid_from')
@Index('uq_contractor_zone_interval', ['siteContractorId', 'zoneId', 'validFrom'], { unique: true })
export class ContractorZonePermissionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_contractor_zone_permission_id' })
  id!: string;
  @Column({ name: 'site_contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorSiteParticipationEntity, {
    name: 'fk_contractor_zone_participation',
    onDelete: 'RESTRICT',
  })
  siteContractorId!: string;
  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_contractor_zone_zone', onDelete: 'RESTRICT' })
  zoneId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' }) validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz' }) validUntil!: Date;
  @Column({ name: 'granted_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_contractor_zone_granter', onDelete: 'RESTRICT' })
  grantedBy!: string;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'worker_zone_permission' })
@Check('ck_worker_zone_interval', 'valid_until > valid_from')
@Index(
  'uq_worker_zone_interval',
  ['workerAssignmentId', 'contractorZonePermissionId', 'validFrom'],
  { unique: true },
)
export class WorkerZonePermissionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_worker_zone_permission_id' })
  id!: string;
  @Column({ name: 'worker_assignment_id', type: 'uuid' })
  @ForeignKey(() => WorkerSiteZoneAssignmentEntity, {
    name: 'fk_worker_zone_assignment',
    onDelete: 'RESTRICT',
  })
  workerAssignmentId!: string;
  @Column({ name: 'contractor_zone_permission_id', type: 'uuid' })
  @ForeignKey(() => ContractorZonePermissionEntity, {
    name: 'fk_worker_zone_contractor_permission',
    onDelete: 'RESTRICT',
  })
  contractorZonePermissionId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' }) validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz' }) validUntil!: Date;
  @Column({ name: 'granted_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_worker_zone_granter', onDelete: 'RESTRICT' })
  grantedBy!: string;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
