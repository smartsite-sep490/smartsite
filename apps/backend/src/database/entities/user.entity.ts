import { Column, CreateDateColumn, Entity, PrimaryColumn, Unique, UpdateDateColumn } from 'typeorm';

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
export class UserEntity {
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

  @Column({ name: 'must_change_password', type: 'boolean', default: true })
  mustChangePassword!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
