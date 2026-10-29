import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { ZoneEntity } from './zone.entity.js';
import { ZoneRestrictionPolicy, ZoneType } from './enums.js';

@Entity({ name: 'zone_policy_revision' })
@ForeignKey(() => ZoneEntity, ['zoneId', 'siteId'], ['id', 'siteId'], {
  name: 'fk_zone_policy_revision_scope',
  onDelete: 'RESTRICT',
})
@Index('idx_zone_policy_revision_site_time', ['siteId', 'recordedAt'])
@Check('chk_zone_policy_revision_version', 'policy_revision BETWEEN 1 AND 9007199254740991')
@Check('chk_zone_policy_revision_type', "zone_type IN ('STANDARD','RESTRICTED','HAZARDOUS')")
@Check(
  'chk_zone_policy_revision_restriction',
  "restriction_policy IN ('NONE','PROHIBITED_FOR_ALL','AUTHORIZATION_REQUIRED')",
)
@Check('chk_zone_policy_revision_time', 'isfinite(recorded_at)')
@Check(
  'chk_zone_policy_revision_ppe',
  "required_ppe <@ ARRAY['HARD_HAT','SAFETY_VEST','GLOVES','BOOTS','GOGGLES']::text[] AND array_position(required_ppe,NULL) IS NULL AND cardinality(array_positions(required_ppe,'HARD_HAT'))<=1 AND cardinality(array_positions(required_ppe,'SAFETY_VEST'))<=1 AND cardinality(array_positions(required_ppe,'GLOVES'))<=1 AND cardinality(array_positions(required_ppe,'BOOTS'))<=1 AND cardinality(array_positions(required_ppe,'GOGGLES'))<=1",
)
export class ZonePolicyRevisionEntity {
  @PrimaryColumn({
    name: 'zone_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_zone_policy_revision',
  })
  zoneId!: string;
  @PrimaryColumn({
    name: 'policy_revision',
    type: 'bigint',
    primaryKeyConstraintName: 'pk_zone_policy_revision',
  })
  policyRevision!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;
  @Column({ name: 'zone_type', type: 'varchar', length: 32 })
  zoneType!: ZoneType;
  @Column({ name: 'restriction_policy', type: 'varchar', length: 32 })
  restrictionPolicy!: ZoneRestrictionPolicy;
  @Column({ name: 'required_ppe', type: 'text', array: true })
  requiredPpe!: string[];
  @Column({ name: 'is_cutover_baseline', type: 'boolean', default: false })
  isCutoverBaseline!: boolean;
  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'clock_timestamp()' })
  recordedAt!: Date;
}
