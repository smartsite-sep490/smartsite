import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SiteEntity } from './site.entity.js';
import { ObservationIdentityDecisionEntity } from './observation-identity-decision.entity.js';
import type { ObservationSubjectRef } from '../../modules/safety/identity/observation-identity.types.js';

@Entity({ name: 'observation_identity_resolution' })
@Unique('uq_identity_resolution_event_subject', ['eventId', 'personObservationIndex'])
@Unique('uq_identity_resolution_id_site', ['id', 'siteId'])
@Check('chk_identity_resolution_index', 'person_observation_index BETWEEN 0 AND 255')
@Check('chk_identity_resolution_hash', "payload_hash ~ '^[0-9a-f]{64}$'")
@Check('chk_identity_resolution_ref', "jsonb_typeof(subject_ref) = 'object'")
@Check(
  'chk_identity_resolution_head',
  '(revision = 0 AND current_decision_id IS NULL) OR (revision BETWEEN 1 AND 2147483647 AND current_decision_id IS NOT NULL)',
)
@ForeignKey(
  () => ObservationIdentityDecisionEntity,
  ['id', 'currentDecisionId', 'revision'],
  ['resolutionId', 'id', 'revision'],
  { name: 'fk_identity_resolution_current', onDelete: 'RESTRICT' },
)
export class ObservationIdentityResolutionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_identity_resolution_id' })
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  @ForeignKey(() => AiObservationEventEntity, {
    name: 'fk_identity_resolution_event',
    onDelete: 'RESTRICT',
  })
  eventId!: string;

  @Column({ name: 'person_observation_index', type: 'smallint' })
  personObservationIndex!: number;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_identity_resolution_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'payload_hash', type: 'char', length: 64 })
  payloadHash!: string;

  @Column({ name: 'subject_ref', type: 'jsonb' })
  subjectRef!: ObservationSubjectRef;

  @Column({ type: 'integer', default: 0 })
  revision!: number;

  @Column({ name: 'current_decision_id', type: 'uuid', nullable: true })
  currentDecisionId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
