import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'schedule_version' })
@Index('idx_schedule_version_site_effective', ['siteId', 'effectiveFrom', 'version'])
@Check('chk_schedule_version_positive', 'version >= 1')
@Check('chk_schedule_version_effective_interval', 'effective_until IS NULL OR effective_until > effective_from')
export class ScheduleVersionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_schedule_version_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_schedule_version_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_until', type: 'timestamptz', nullable: true })
  effectiveUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
