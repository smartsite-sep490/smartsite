import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ContractorEntity } from './contractor.entity.js';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'contractor_site_participation' })
@Index('idx_contractor_site_participation_lookup', ['contractorId', 'siteId', 'validFrom'])
@Check(
  'chk_contractor_site_participation_interval',
  'valid_until IS NULL OR valid_until > valid_from',
)
export class ContractorSiteParticipationEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_contractor_site_participation_id' })
  id!: string;

  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, {
    name: 'fk_contractor_site_participation_contractor',
    onDelete: 'RESTRICT',
  })
  contractorId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, {
    name: 'fk_contractor_site_participation_site',
    onDelete: 'RESTRICT',
  })
  siteId!: string;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
