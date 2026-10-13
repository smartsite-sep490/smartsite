import { Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import type { ScheduleAssignmentInput, ScheduleAssignmentPreview } from '@smartsite/contracts';
import { SiteEntity } from './site.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'schedule_assignment_batch' })
export class ScheduleAssignmentBatchEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_schedule_assignment_batch' })
  id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_schedule_batch_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, {
    name: 'fk_schedule_batch_contractor',
    onDelete: 'RESTRICT',
  })
  contractorId!: string;
  @Column({ name: 'created_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_schedule_batch_creator', onDelete: 'RESTRICT' })
  createdBy!: string;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ type: 'jsonb' }) input!: ScheduleAssignmentInput;
  @Column({ type: 'jsonb' }) preview!: ScheduleAssignmentPreview;
  @Column({ name: 'schedule_ids', type: 'jsonb' }) scheduleIds!: string[];
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
