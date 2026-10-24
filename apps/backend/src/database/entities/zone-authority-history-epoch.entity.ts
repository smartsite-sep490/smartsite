import { Check, Column, Entity, ForeignKey, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'zone_authority_history_epoch' })
@Check('chk_authority_epoch_ready', "readiness IN ('OFF','READY')")
@Check('chk_authority_epoch_time', 'isfinite(started_at)')
@Check('chk_authority_epoch_hash', "writer_manifest_hash ~ '^[0-9a-f]{64}$'")
export class ZoneAuthorityHistoryEpochEntity {
  @PrimaryColumn({
    name: 'site_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_zone_authority_epoch',
  })
  @ForeignKey(() => SiteEntity, { name: 'fk_authority_epoch_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ type: 'varchar', length: 8, default: 'OFF' })
  readiness!: 'OFF' | 'READY';

  @Column({ name: 'writer_manifest_hash', type: 'char', length: 64 })
  writerManifestHash!: string;
}
