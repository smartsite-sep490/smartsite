import { Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'auth_session' })
@Index('idx_auth_session_user', ['userId'])
export class AuthSessionEntity {
  @PrimaryColumn({
    name: 'token_hash',
    type: 'varchar',
    length: 64,
    primaryKeyConstraintName: 'pk_auth_session_token_hash',
  })
  tokenHash!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_auth_session_user', onDelete: 'CASCADE' })
  userId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}
