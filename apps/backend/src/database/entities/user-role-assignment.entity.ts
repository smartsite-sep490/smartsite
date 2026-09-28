import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { UserEntity, UserRole } from './user.entity.js';

@Entity({ name: 'user_role_assignment' })
@Check(
  'chk_user_role_assignment_scope',
  "(role = 'ADMIN' AND site_id IS NULL) OR (role <> 'ADMIN' AND site_id IS NOT NULL)",
)
@Check(
  'chk_user_role_assignment_role',
  "role IN ('ADMIN', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER', 'SECURITY_OFFICER', 'WORKER')",
)
@Index('uq_user_role_assignment_scoped', ['userId', 'role', 'siteId'], {
  unique: true,
  where: 'site_id IS NOT NULL',
})
@Index('uq_user_role_assignment_global', ['userId', 'role'], {
  unique: true,
  where: 'site_id IS NULL',
})
@Index('idx_user_role_assignment_user', ['userId'])
@Index('idx_user_role_assignment_site', ['siteId'], { where: 'site_id IS NOT NULL' })
export class UserRoleAssignmentEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_user_role_assignment_id' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_user_role_assignment_user',
    onDelete: 'CASCADE',
  })
  userId!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: UserRole;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  @ForeignKey(() => SiteEntity, {
    name: 'fk_user_role_assignment_site',
    onDelete: 'RESTRICT',
  })
  siteId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
