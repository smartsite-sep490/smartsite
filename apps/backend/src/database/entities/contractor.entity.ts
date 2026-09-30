import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'contractor' })
@Unique('uq_contractor_site_code', ['siteId', 'code'])
@Index('idx_contractor_site_active', ['siteId', 'isActive'])
export class ContractorEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_contractor_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_contractor_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ type: 'varchar', length: 64 })
  code!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
