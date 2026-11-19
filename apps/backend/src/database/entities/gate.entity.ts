import { Check, Column, Entity, ForeignKey, PrimaryColumn, Unique } from 'typeorm';
import { SiteEntity } from './site.entity.js';

@Entity({ name: 'gate' })
@Unique('uq_gate_site_code', ['siteId', 'code'])
@Unique('uq_gate_id_site', ['id', 'siteId'])
@Check('ck_gate_status', "status IN ('ACTIVE','INACTIVE')")
export class GateEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_gate_id' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_gate_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ type: 'varchar', length: 64 }) code!: string;
  @Column({ type: 'varchar', length: 100 }) name!: string;
  @Column({ type: 'varchar', length: 8, default: 'ACTIVE' }) status!: 'ACTIVE' | 'INACTIVE';
}
