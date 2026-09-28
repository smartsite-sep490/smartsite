import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { ZoneEntity } from './zone.entity.js';

export type ZoneEntryDecisionStatus = 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';

@Entity({ name: 'zone_entry_decision' })
@Unique('uq_zone_entry_decision_event_track_zone', ['eventId', 'trackId', 'zoneId'])
@Index('idx_zone_entry_decision_site_time', ['siteId', 'evaluatedAt', 'id'])
@Check('chk_zone_entry_decision_status', "status IN ('ALLOWED', 'DENIED', 'UNAVAILABLE')")
export class ZoneEntryDecisionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_zone_entry_decision_id' })
  id!: string;

  @Column({ name: 'event_id', type: 'uuid' })
  @ForeignKey(() => AiObservationEventEntity, {
    name: 'fk_zone_entry_decision_event',
    onDelete: 'CASCADE',
  })
  eventId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_zone_entry_decision_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_zone_entry_decision_zone', onDelete: 'RESTRICT' })
  zoneId!: string;

  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_zone_entry_decision_worker', onDelete: 'SET NULL' })
  workerId!: string | null;

  @Column({ name: 'candidate_worker_id', type: 'varchar', length: 128, nullable: true })
  candidateWorkerId!: string | null;

  @Column({ name: 'track_id', type: 'integer' })
  trackId!: number;

  @Column({ type: 'varchar', length: 16 })
  status!: ZoneEntryDecisionStatus;

  @Column({ name: 'reason_code', type: 'varchar', length: 64 })
  reasonCode!: string;

  @Column({ name: 'evaluated_at', type: 'timestamptz' })
  evaluatedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
