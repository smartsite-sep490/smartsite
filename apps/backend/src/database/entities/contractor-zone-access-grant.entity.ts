import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ContractorEntity } from './contractor.entity.js';
import { SiteEntity } from './site.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { ZoneAccessEffect } from './zone-access-grant.entity.js';

@Entity({ name: 'contractor_zone_access_grant' })
@Index('idx_contractor_zone_grant_lookup', ['siteId', 'zoneId', 'contractorId', 'validFrom'])
@ForeignKey(() => ZoneEntity, ['zoneId', 'siteId'], ['id', 'siteId'], {
  name: 'fk_contractor_zone_grant_zone_site',
  onDelete: 'RESTRICT',
})
@Check('chk_contractor_zone_grant_effect', "effect IN ('ALLOW','DENY')")
@Check(
  'chk_contractor_zone_grant_interval',
  'isfinite(valid_from) AND (valid_until IS NULL OR (isfinite(valid_until) AND valid_until > valid_from)) AND (revoked_at IS NULL OR isfinite(revoked_at))',
)
export class ContractorZoneAccessGrantEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_contractor_zone_grant_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_contractor_zone_grant_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId!: string;

  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, {
    name: 'fk_contractor_zone_grant_contractor',
    onDelete: 'RESTRICT',
  })
  contractorId!: string;

  @Column({ type: 'varchar', length: 8 })
  effect!: ZoneAccessEffect;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
