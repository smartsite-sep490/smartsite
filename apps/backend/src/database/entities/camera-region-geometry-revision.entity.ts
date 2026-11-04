import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { CameraObservationRegionEntity } from './camera-observation-region.entity.js';
import { CameraConfigurationReferenceEntity } from './camera-configuration-reference.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'camera_region_geometry_revision' })
@Unique('uq_region_revision_bundle_scope', ['regionId', 'geometryVersion', 'cameraId', 'zoneId'])
@Unique('uq_region_revision_camera_configuration', ['cameraId', 'configurationVersion', 'regionId'])
@ForeignKey(
  () => CameraObservationRegionEntity,
  ['regionId', 'cameraId', 'zoneId'],
  ['id', 'cameraId', 'zoneId'],
  { name: 'fk_region_revision_region_camera_zone', onDelete: 'RESTRICT' },
)
@ForeignKey(
  () => CameraConfigurationReferenceEntity,
  ['referenceId', 'cameraId', 'viewRevision'],
  ['id', 'cameraId', 'viewRevision'],
  { name: 'fk_region_revision_reference_camera_view', onDelete: 'RESTRICT' },
)
@Index('idx_region_revision_zone', ['zoneId'])
@Index('idx_region_revision_reference', ['referenceId', 'cameraId', 'viewRevision'])
@Index('idx_region_revision_confirmer', ['confirmedByUserId'])
@Check(
  'chk_region_revision_version',
  'geometry_version>=1 AND configuration_version BETWEEN 1 AND 9007199254740991',
)
@Check('chk_region_revision_coordinates', "coordinate_space='NORMALIZED_0_1'")
@Check(
  'chk_region_revision_times',
  'isfinite(recorded_at) AND (confirmed_at IS NULL OR (isfinite(confirmed_at) AND confirmed_at<=recorded_at))',
)
@Check(
  'chk_region_revision_provenance',
  '(reference_id IS NULL AND view_revision IS NULL AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL) OR (reference_id IS NOT NULL AND view_revision IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)',
)
@Check('chk_region_revision_cutover', 'NOT is_cutover_baseline OR reference_id IS NULL')
export class CameraRegionGeometryRevisionEntity {
  @PrimaryColumn({
    name: 'region_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_region_geometry_revision',
  })
  regionId!: string;
  @PrimaryColumn({
    name: 'geometry_version',
    type: 'integer',
    primaryKeyConstraintName: 'pk_camera_region_geometry_revision',
  })
  geometryVersion!: number;
  @Column({ name: 'camera_id', type: 'uuid' })
  cameraId!: string;
  @Column({ name: 'zone_id', type: 'uuid' })
  zoneId!: string;
  @Column({ name: 'configuration_version', type: 'bigint' })
  configurationVersion!: string;
  @Column({ name: 'coordinate_space', type: 'varchar', length: 32 })
  coordinateSpace!: string;
  @Column({ type: 'jsonb' })
  polygon!: unknown;
  @Column({ name: 'is_active', type: 'boolean' })
  isActive!: boolean;
  @Column({ name: 'is_cutover_baseline', type: 'boolean', default: false })
  isCutoverBaseline!: boolean;
  @Column({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId!: string | null;
  @Column({ name: 'view_revision', type: 'bigint', nullable: true })
  viewRevision!: string | null;
  @Column({ name: 'confirmed_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_region_revision_confirmer', onDelete: 'RESTRICT' })
  confirmedByUserId!: string | null;
  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;
  @Column({ name: 'recorded_at', type: 'timestamptz', default: () => 'clock_timestamp()' })
  recordedAt!: Date;
}
