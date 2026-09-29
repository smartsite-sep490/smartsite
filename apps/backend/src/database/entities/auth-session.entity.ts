import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity.js';

export enum AuthClientType {
  WEB = 'WEB',
  MOBILE = 'MOBILE',
}

@Entity({ name: 'auth_session' })
@Index('idx_auth_session_user', ['userId'])
@Index('idx_auth_session_expires', ['expiresAt'])
@Check('chk_auth_session_client_type', "client_type IN ('WEB', 'MOBILE')")
export class AuthSessionEntity {
  @PrimaryColumn({
    type: 'uuid',
    primaryKeyConstraintName: 'pk_auth_session_id',
  })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_auth_session_user', onDelete: 'CASCADE' })
  userId!: string;

  @Column({ name: 'client_type', type: 'varchar', length: 8 })
  clientType!: AuthClientType;

  @Column({ name: 'refresh_token_hash', type: 'varchar', length: 64 })
  refreshTokenHash!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'last_refreshed_at', type: 'timestamptz' })
  lastRefreshedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;
}
