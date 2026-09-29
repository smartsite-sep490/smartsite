import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';

export enum FaceProfileStatus {
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
  NEEDS_REENROLL = 'NEEDS_REENROLL',
}

/** Metadata only: template material remains in the AI service's private storage. */
@Entity({ name: 'face_profile' })
@Index('uq_face_profile_worker', ['workerId'], { unique: true })
@Index('uq_face_profile_reference_hash', ['profileReferenceHash'], { unique: true })
@Check('chk_face_profile_status', "status IN ('ACTIVE', 'REVOKED', 'NEEDS_REENROLL')")
export class FaceProfileEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_face_profile_id' })
  id!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_face_profile_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  /** SHA-256 of the AI-private profile reference; never an embedding or raw template. */
  @Column({ name: 'profile_reference_hash', type: 'char', length: 64 })
  profileReferenceHash!: string;

  @Column({ name: 'model_version', type: 'varchar', length: 128 })
  modelVersion!: string;

  @Column({ type: 'varchar', length: 32 })
  status!: FaceProfileStatus;

  @Column({ name: 'consent_version', type: 'varchar', length: 64 })
  consentVersion!: string;

  @Column({ name: 'consented_at', type: 'timestamptz' })
  consentedAt!: Date;

  @Column({ name: 'created_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_face_profile_creator', onDelete: 'RESTRICT' })
  createdByUserId!: string;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'revoked_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_face_profile_revoker', onDelete: 'RESTRICT' })
  revokedByUserId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
