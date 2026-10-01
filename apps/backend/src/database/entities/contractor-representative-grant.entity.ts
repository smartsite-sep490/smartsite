import {
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { ContractorEntity } from './contractor.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'contractor_representative_grant' })
@Unique('uq_contractor_representative_grant', ['userId', 'contractorId'])
@Index('idx_contractor_representative_grant_user', ['userId'])
export class ContractorRepresentativeGrantEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'pk_contractor_representative_grant_id',
  })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_contractor_representative_grant_user',
    onDelete: 'CASCADE',
  })
  userId!: string;

  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, {
    name: 'fk_contractor_representative_grant_contractor',
    onDelete: 'RESTRICT',
  })
  contractorId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
