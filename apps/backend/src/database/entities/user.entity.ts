import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'ADMIN',
  SITE_MANAGER = 'SITE_MANAGER',
  CONTRACTOR_REPRESENTATIVE = 'CONTRACTOR_REPRESENTATIVE',
  SAFETY_OFFICER = 'SAFETY_OFFICER',
  SECURITY_OFFICER = 'SECURITY_OFFICER',
  WORKER = 'WORKER',
}

@Entity({ name: 'app_user' })
@Unique('uq_app_user_username', ['username'])
@Index('uq_user_email', ['email'], { unique: true, where: 'email IS NOT NULL' })
@Check(
  'ck_user_email_normalized',
  'email IS NULL OR (email=lower(trim(email)) AND length(email)>3)',
)
@Check('ck_user_email_verified', 'email_verified_at IS NULL OR email IS NOT NULL')
export class UserEntity {
  @Column({ type: 'varchar', length: 254, nullable: true }) email?: string | null;
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt?: Date | null;
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_app_user_id' })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  username!: string;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
