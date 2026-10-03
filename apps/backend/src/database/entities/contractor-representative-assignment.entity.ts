import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { ContractorEntity } from './contractor.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'contractor_representative_assignment' })
@Unique('uq_contractor_representative_assignment', ['siteId', 'contractorId', 'userId'])
@Index('idx_contractor_representative_user_site', ['userId', 'siteId'])
export class ContractorRepresentativeAssignmentEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_contractor_representative_assignment_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, {
    name: 'fk_contractor_representative_assignment_site',
    onDelete: 'RESTRICT',
  })
  siteId!: string;

  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, {
    name: 'fk_contractor_representative_assignment_contractor',
    onDelete: 'RESTRICT',
  })
  contractorId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_contractor_representative_assignment_user',
    onDelete: 'RESTRICT',
  })
  userId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
