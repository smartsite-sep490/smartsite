import { Column, CreateDateColumn, Entity, PrimaryColumn, Unique } from 'typeorm';
import { ZoneRestrictionPolicy, ZoneType } from './enums.js';

@Entity({ name: 'zone' })
@Unique('uq_zone_site_code', ['siteId', 'code'])
export class ZoneEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;

  @Column({ name: 'site_id', type: 'uuid' })
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
