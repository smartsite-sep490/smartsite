import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';

export enum FaceEnrollmentSessionStatus {
  PENDING = 'PENDING',
  COLLECTING = 'COLLECTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Tracks consent and lifecycle only; individual samples are never persisted here. */
@Entity({ name: 'face_enrollment_session' })
@Index('idx_face_enrollment_session_worker_started', ['workerId', 'startedAt'])
@Check(
  'chk_face_enrollment_session_status',
  "status IN ('PENDING', 'COLLECTING', 'COMPLETED', 'FAILED', 'CANCELLED')",
)
@Check('chk_face_enrollment_session_sample_count', 'accepted_sample_count BETWEEN 0 AND 3')
export class FaceEnrollmentSessionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_face_enrollment_session_id' })
  id!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, {
    name: 'fk_face_enrollment_session_worker',
    onDelete: 'RESTRICT',
  })
  workerId!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'fk_face_enrollment_session_actor',
    onDelete: 'RESTRICT',
  })
  actorUserId!: string;

  @Column({ name: 'consent_version', type: 'varchar', length: 64 })
  consentVersion!: string;

  @Column({ name: 'consented_at', type: 'timestamptz', nullable: true })
  consentedAt!: Date | null;
  @Column({ name: 'consent_method', type: 'varchar', length: 50, nullable: true }) consentMethod!:
    string | null;
  @Column({ name: 'consent_token_hash', type: 'char', length: 64, nullable: true, select: false })
  consentTokenHash!: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true }) expiresAt!: Date | null;

  @Column({ type: 'varchar', length: 32 })
  status!: FaceEnrollmentSessionStatus;

  @Column({ name: 'accepted_sample_count', type: 'smallint', default: 0 })
  acceptedSampleCount!: number;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
