import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'shift' })
@Index('idx_shift_site_start', ['siteId', 'startsAt', 'id'])
@Check('chk_shift_interval', 'ends_at > starts_at')
@Check('chk_shift_name_length', "char_length(name) BETWEEN 1 AND 160")
export class ShiftEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_shift_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_shift_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ type: 'varchar', length: 160 })
  name!: string;

  @Column({ name: 'starts_at', type: 'timestamptz' })
  startsAt!: Date;

  @Column({ name: 'ends_at', type: 'timestamptz' })
  endsAt!: Date;

  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
