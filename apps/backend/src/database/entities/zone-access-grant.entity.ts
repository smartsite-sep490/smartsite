import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { ZoneEntity } from './zone.entity.js';

export enum ZoneAccessEffect {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
}

@Entity({ name: 'zone_access_grant' })
@Index('idx_zone_access_grant_lookup', ['zoneId', 'workerId', 'validFrom'])
@Check('chk_zone_access_grant_effect', "effect IN ('ALLOW', 'DENY')")
@Check('chk_zone_access_grant_interval', 'valid_until IS NULL OR valid_until > valid_from')
export class ZoneAccessGrantEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_zone_access_grant_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_zone_access_grant_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_zone_access_grant_zone', onDelete: 'RESTRICT' })
  zoneId!: string;

  @Column({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'fk_zone_access_grant_worker', onDelete: 'RESTRICT' })
  workerId!: string;

  @Column({ type: 'varchar', length: 8 })
  effect!: ZoneAccessEffect;

  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;

  @Column({ name: 'valid_until', type: 'timestamptz', nullable: true })
  validUntil!: Date | null;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
