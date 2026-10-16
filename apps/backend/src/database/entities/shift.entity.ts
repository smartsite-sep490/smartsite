import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'shift' })
@Index('idx_shift_site_start', ['siteId', 'startsAt', 'id'])
@Check('chk_shift_interval', 'ends_at > starts_at')
@Check(
  'chk_shift_break',
  '(break_starts_at IS NULL AND break_ends_at IS NULL) OR (break_starts_at IS NOT NULL AND break_ends_at IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND break_starts_at >= starts_at AND break_ends_at <= ends_at AND break_ends_at > break_starts_at)',
)
@Check('chk_shift_name_length', 'char_length(name) BETWEEN 1 AND 160')
@Check('chk_shift_allowed_exit_minutes', 'allowed_exit_minutes >= 0')
@Check('chk_shift_max_exit_count', 'max_exit_count >= 0')
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

  @Column({ name: 'break_starts_at', type: 'timestamptz', nullable: true })
  breakStartsAt!: Date | null;

  @Column({ name: 'break_ends_at', type: 'timestamptz', nullable: true })
  breakEndsAt!: Date | null;

  @Column({ name: 'allowed_exit_minutes', type: 'integer', default: 15 })
  allowedExitMinutes!: number;

  @Column({ name: 'max_exit_count', type: 'integer', default: 2 })
  maxExitCount!: number;

  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
