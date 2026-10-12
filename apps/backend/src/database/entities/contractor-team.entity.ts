import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';

@Entity({ name: 'contractor_team' })
@Unique('uq_team_scope', ['id', 'siteId', 'contractorId'])
@Index('uq_team_active_name', ['siteId', 'contractorId', 'normalizedName'], {
  unique: true,
  where: 'is_active = true',
})
@Check('ck_team_name', 'char_length(trim(name)) BETWEEN 1 AND 160')
@Check('ck_team_version', 'version > 0')
export class ContractorTeamEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_team_id' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_team_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, { name: 'fk_team_contractor', onDelete: 'RESTRICT' })
  contractorId!: string;
  @Column({ type: 'varchar', length: 160 }) name!: string;
  @Column({ name: 'normalized_name', type: 'varchar', length: 160 }) normalizedName!: string;
  @Column({ type: 'varchar', length: 1000, default: '' }) description!: string;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive!: boolean;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'created_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_team_creator', onDelete: 'RESTRICT' })
  createdBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'contractor_team_membership' })
@Index('uq_team_worker_active', ['siteId', 'workerId'], { unique: true, where: 'left_at IS NULL' })
@Index('idx_team_members', ['teamId', 'leftAt'])
@Check('ck_team_membership_interval', 'left_at IS NULL OR left_at >= joined_at')
@ForeignKey(
  () => ContractorTeamEntity,
  ['teamId', 'siteId', 'contractorId'],
  ['id', 'siteId', 'contractorId'],
  { name: 'fk_membership_team_scope', onDelete: 'RESTRICT' },
)
@ForeignKey(() => WorkerEntity, ['workerId', 'siteId'], ['id', 'siteId'], {
  name: 'fk_membership_worker_site',
  onDelete: 'RESTRICT',
})
export class ContractorTeamMembershipEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_team_membership_id' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' }) siteId!: string;
  @Column({ name: 'contractor_id', type: 'uuid' }) contractorId!: string;
  @Column({ name: 'team_id', type: 'uuid' }) teamId!: string;
  @Column({ name: 'worker_id', type: 'uuid' }) workerId!: string;
  @Column({ name: 'joined_at', type: 'timestamptz' }) joinedAt!: Date;
  @Column({ name: 'left_at', type: 'timestamptz', nullable: true }) leftAt!: Date | null;
  @Column({ name: 'assigned_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_membership_assigner', onDelete: 'RESTRICT' })
  assignedBy!: string;
  @Column({ type: 'varchar', length: 1000 }) reason!: string;
  @Column({ name: 'ended_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_membership_ender', onDelete: 'RESTRICT' })
  endedBy!: string | null;
  @Column({ name: 'end_reason', type: 'varchar', length: 1000, nullable: true }) endReason!:
    string | null;
}
