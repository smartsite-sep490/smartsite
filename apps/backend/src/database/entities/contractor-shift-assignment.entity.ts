import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { ContractorEntity } from './contractor.entity.js';
import { ShiftEntity } from './shift.entity.js';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'contractor_shift_assignment' })
@Unique('uq_contractor_shift_assignment', ['siteId', 'shiftId', 'contractorId'])
@Index('idx_contractor_shift_assignment_contractor', ['siteId', 'contractorId', 'shiftId'])
@Index('idx_contractor_shift_assignment_shift', ['siteId', 'shiftId', 'contractorId'])
export class ContractorShiftAssignmentEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'pk_contractor_shift_assignment_id',
  })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, {
    name: 'fk_contractor_shift_assignment_site',
    onDelete: 'RESTRICT',
  })
  siteId!: string;

  @Column({ name: 'shift_id', type: 'uuid' })
  @ForeignKey(() => ShiftEntity, {
    name: 'fk_contractor_shift_assignment_shift',
    onDelete: 'RESTRICT',
  })
  shiftId!: string;

  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, {
    name: 'fk_contractor_shift_assignment_contractor',
    onDelete: 'RESTRICT',
  })
  contractorId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
