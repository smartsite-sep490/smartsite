import { Column, CreateDateColumn, Entity, ForeignKey, PrimaryColumn, Unique } from 'typeorm';
import { ZoneRestrictionPolicy, ZoneType } from './enums.js';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'zone' })
@Unique('uq_zone_site_code', ['siteId', 'code'])
export class ZoneEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', primaryKeyConstraintName: 'pk_zone_id' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_zone_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'code', type: 'varchar', length: 64 })
  code!: string;

  @Column({ name: 'name', type: 'varchar', length: 255 })
  name!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: ZoneType,
    enumName: 'zone_type',
  })
  type!: ZoneType;

  @Column({
    name: 'restriction_policy',
    type: 'enum',
    enum: ZoneRestrictionPolicy,
    enumName: 'zone_restriction_policy',
  })
  restrictionPolicy!: ZoneRestrictionPolicy;

  @Column({ name: 'required_ppe', type: 'text', array: true, default: '{}' })
  requiredPpe!: string[];

  @Column({ name: 'configuration_locked', type: 'boolean', default: false })
  configurationLocked!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
