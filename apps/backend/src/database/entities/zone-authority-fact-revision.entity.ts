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
import { SiteEntity } from './site.entity.js';
import { ZoneAuthorityCommandEntity } from './zone-authority-command.entity.js';

export enum ZoneAuthoritySourceKind {
  CONTRACTOR_STATE = 'CONTRACTOR_STATE',
  WORKER_MEMBERSHIP = 'WORKER_MEMBERSHIP',
  PARTICIPATION = 'PARTICIPATION',
  ASSIGNMENT = 'ASSIGNMENT',
  CONTRACTOR_ZONE_GRANT = 'CONTRACTOR_ZONE_GRANT',
  WORKER_ZONE_GRANT = 'WORKER_ZONE_GRANT',
  ZONE_POLICY = 'ZONE_POLICY',
}

@Entity({ name: 'zone_authority_fact_revision' })
@Unique('uq_authority_fact_revision', ['sourceKind', 'sourceId', 'revision'])
@Index('idx_authority_fact_scope_time', [
  'siteId',
  'sourceKind',
  'sourceId',
  'effectiveFrom',
  'recordedAt',
])
@Index('idx_authority_fact_command', ['commandId'])
@Check('chk_authority_fact_revision', 'revision > 0')
@Check(
  'chk_authority_fact_scope',
  "(source_kind='CONTRACTOR_STATE' AND site_id IS NULL) OR (source_kind IN ('WORKER_MEMBERSHIP','PARTICIPATION','ASSIGNMENT','CONTRACTOR_ZONE_GRANT','WORKER_ZONE_GRANT','ZONE_POLICY') AND site_id IS NOT NULL)",
)
@Check(
  'chk_authority_fact_interval',
  'isfinite(effective_from) AND isfinite(recorded_at) AND (effective_to IS NULL OR (isfinite(effective_to) AND effective_to > effective_from))',
)
@Check(
  'chk_authority_fact_payload',
  "jsonb_typeof(payload)='object' AND octet_length(payload::text) <= 16384",
)
export class ZoneAuthorityFactRevisionEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_zone_authority_fact' })
  id!: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId!: string;

  @Column({ name: 'command_id', type: 'uuid' })
  @ForeignKey(() => ZoneAuthorityCommandEntity, 'commandId', {
    name: 'fk_authority_fact_command',
    onDelete: 'RESTRICT',
  })
  commandId!: string;

  @Column({ name: 'source_kind', type: 'varchar', length: 32 })
  sourceKind!: ZoneAuthoritySourceKind;

  /** Preserve PostgreSQL bigint exactly; never cast revisions to JS Number. */
  @Column({ type: 'bigint' })
  revision!: string;

  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  @ForeignKey(() => SiteEntity, { name: 'fk_authority_fact_site', onDelete: 'RESTRICT' })
  siteId!: string | null;

  @Column({ name: 'effective_from', type: 'timestamptz' })
  effectiveFrom!: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo!: Date | null;

  @CreateDateColumn({
    name: 'recorded_at',
    type: 'timestamptz',
    default: () => 'statement_timestamp()',
  })
  recordedAt!: Date;

  /** Storage envelope; B1.B must validate its closed per-kind payload before appending. */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;
}
