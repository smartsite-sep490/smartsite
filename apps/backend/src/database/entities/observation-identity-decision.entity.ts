import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { ObservationIdentityResolutionEntity } from './observation-identity-resolution.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'observation_identity_decision' })
@Unique('uq_identity_decision_revision', ['resolutionId', 'revision'])
@Unique('uq_identity_decision_head_pointer', ['resolutionId', 'id', 'revision'])
@ForeignKey(
  () => ObservationIdentityResolutionEntity,
  ['resolutionId', 'siteId'],
  ['id', 'siteId'],
  { name: 'fk_identity_decision_resolution', onDelete: 'RESTRICT' },
)
@Check(
  'chk_identity_decision_revision',
  'expected_revision BETWEEN 0 AND 2147483646 AND revision = expected_revision + 1',
)
@Check('chk_identity_decision_hash', "command_hash ~ '^[0-9a-f]{64}$'")
@Check(
  'chk_identity_decision_reason',
  'char_length(reason) BETWEEN 5 AND 1000 AND reason = btrim(reason)',
)
@Check(
  'chk_identity_decision_scope',
  "scope = 'EXACT_OBSERVATION' AND verification_method = 'MANUAL'",
)
@Check(
  'chk_identity_decision_action',
  "(action = 'RESOLVE' AND worker_id IS NOT NULL AND evidence_index IS NOT NULL AND evidence_index BETWEEN 0 AND 255 AND evidence_sha256 IS NOT NULL AND evidence_sha256 ~ '^[0-9a-f]{64}$') OR (action = 'CLEAR' AND worker_id IS NULL AND evidence_index IS NULL AND evidence_sha256 IS NULL)",
)
export class ObservationIdentityDecisionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_identity_decision_id' })
  id!: string;

  @Column({ name: 'resolution_id', type: 'uuid' })
  resolutionId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;

  @Column({ name: 'actor_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_identity_decision_actor', onDelete: 'RESTRICT' })
  actorUserId!: string;

  @Column({ type: 'integer' })
  revision!: number;

  @Column({ name: 'expected_revision', type: 'integer' })
  expectedRevision!: number;

  @Column({ name: 'command_hash', type: 'char', length: 64 })
  commandHash!: string;

  @Column({ type: 'varchar', length: 8 })
  action!: 'RESOLVE' | 'CLEAR';

  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_identity_decision_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;

  @Column({ name: 'evidence_index', type: 'smallint', nullable: true })
  evidenceIndex!: number | null;

  @Column({ name: 'evidence_sha256', type: 'char', length: 64, nullable: true })
  evidenceSha256!: string | null;

  @Column({ type: 'varchar', length: 1000 })
  reason!: string;

  @Column({ type: 'varchar', length: 32, default: 'EXACT_OBSERVATION' })
  scope!: 'EXACT_OBSERVATION';

  @Column({ name: 'verification_method', type: 'varchar', length: 16, default: 'MANUAL' })
  verificationMethod!: 'MANUAL';

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;
}
