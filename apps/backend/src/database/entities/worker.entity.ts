import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { ContractorEntity } from './contractor.entity.js';

@Entity({ name: 'worker' })
@Unique('uq_worker_site_external_id', ['siteId', 'externalId'])
@Index('idx_worker_contractor', ['contractorId'], { where: 'contractor_id IS NOT NULL' })
export class WorkerEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_worker_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_worker_site', onDelete: 'RESTRICT' })
  siteId!: string;

  /** Nullable only for legacy MF06 workers; gate authorization rejects it. */
  @Column({ name: 'contractor_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ContractorEntity, { name: 'fk_worker_contractor', onDelete: 'RESTRICT' })
  contractorId!: string | null;

  @Column({ name: 'external_id', type: 'varchar', length: 128 })
  externalId!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
