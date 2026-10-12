import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ContractorTeamEntity } from './contractor-team.entity.js';
import { ContractorZonePermissionEntity } from './zone-permission.entity.js';
import { UserEntity } from './user.entity.js';
@Entity({ name: 'team_zone_permission' })
@Check('ck_team_zone_interval', 'valid_until > valid_from')
@Index('idx_team_zone_lookup', ['teamId', 'contractorZonePermissionId'])
@Index('uq_team_single_zone', ['teamId'], { unique: true, where: 'revoked_at IS NULL' })
export class TeamZonePermissionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_team_zone_permission' }) id!: string;
  @Column({ name: 'team_id', type: 'uuid' })
  @ForeignKey(() => ContractorTeamEntity, { name: 'fk_team_zone_team', onDelete: 'RESTRICT' })
  teamId!: string;
  @Column({ name: 'contractor_zone_permission_id', type: 'uuid' })
  @ForeignKey(() => ContractorZonePermissionEntity, {
    name: 'fk_team_zone_parent',
    onDelete: 'RESTRICT',
  })
  contractorZonePermissionId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' }) validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz' }) validUntil!: Date;
  @Column({ name: 'granted_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_team_zone_granter', onDelete: 'RESTRICT' })
  grantedBy!: string;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
