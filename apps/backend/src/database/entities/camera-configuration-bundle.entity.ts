import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { CameraViewRevisionEntity } from './camera-configuration-reference.entity.js';
import { CameraRegionGeometryRevisionEntity } from './camera-region-geometry-revision.entity.js';
import { ZonePolicyRevisionEntity } from './zone-policy-revision.entity.js';

@Entity({ name: 'camera_configuration_bundle' })
@Unique('uq_camera_bundle_receipt_scope', [
  'cameraId',
  'configurationVersion',
  'siteId',
  'viewRevision',
  'bundleSha256',
])
@Unique('uq_camera_bundle_hash', ['cameraId', 'bundleSha256'])
@ForeignKey(
  () => CameraViewRevisionEntity,
  ['cameraId', 'viewRevision', 'siteId'],
  ['cameraId', 'revision', 'siteId'],
  { name: 'fk_camera_bundle_view_scope', onDelete: 'RESTRICT' },
)
@Index('idx_camera_bundle_view_scope', ['cameraId', 'viewRevision', 'siteId'])
@Index('idx_camera_bundle_site_time', ['siteId', 'issuedAt'])
@Check(
  'chk_camera_bundle_versions',
  'configuration_version BETWEEN 1 AND 9007199254740991 AND view_revision BETWEEN 1 AND 9007199254740991',
)
@Check('chk_camera_bundle_time', 'isfinite(issued_at)')
@Check('chk_camera_bundle_hash', "bundle_sha256 ~ '^[a-f0-9]{64}$'")
export class CameraConfigurationBundleEntity {
  @PrimaryColumn({
    name: 'camera_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_configuration_bundle',
  })
  cameraId!: string;
  @PrimaryColumn({
    name: 'configuration_version',
    type: 'bigint',
    primaryKeyConstraintName: 'pk_camera_configuration_bundle',
  })
  configurationVersion!: string;
  @Column({ name: 'site_id', type: 'uuid' }) siteId!: string;
  @Column({ name: 'camera_external_id', type: 'varchar', length: 128 }) cameraExternalId!: string;
  @Column({ name: 'view_revision', type: 'bigint' }) viewRevision!: string;
  @Column({ name: 'issued_at', type: 'timestamptz' }) issuedAt!: Date;
  @Column({ name: 'bundle_sha256', type: 'char', length: 64 }) bundleSha256!: string;
}

@Entity({ name: 'camera_configuration_bundle_region' })
@ForeignKey(
  () => CameraConfigurationBundleEntity,
  ['cameraId', 'configurationVersion'],
  ['cameraId', 'configurationVersion'],
  { name: 'fk_camera_bundle_region_header', onDelete: 'RESTRICT' },
)
@ForeignKey(
  () => CameraRegionGeometryRevisionEntity,
  ['regionId', 'geometryVersion', 'cameraId', 'zoneId'],
  ['regionId', 'geometryVersion', 'cameraId', 'zoneId'],
  { name: 'fk_camera_bundle_region_geometry', onDelete: 'RESTRICT' },
)
@ForeignKey(
  () => ZonePolicyRevisionEntity,
  ['zoneId', 'policyRevision'],
  ['zoneId', 'policyRevision'],
  { name: 'fk_camera_bundle_region_policy', onDelete: 'RESTRICT' },
)
@Index('idx_camera_bundle_region_geometry', ['regionId', 'geometryVersion', 'cameraId', 'zoneId'])
@Index('idx_camera_bundle_region_policy', ['zoneId', 'policyRevision'])
export class CameraConfigurationBundleRegionEntity {
  @PrimaryColumn({
    name: 'camera_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_configuration_bundle_region',
  })
  cameraId!: string;
  @PrimaryColumn({
    name: 'configuration_version',
    type: 'bigint',
    primaryKeyConstraintName: 'pk_camera_configuration_bundle_region',
  })
  configurationVersion!: string;
  @PrimaryColumn({
    name: 'region_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_configuration_bundle_region',
  })
  regionId!: string;
  @Column({ name: 'geometry_version', type: 'integer' }) geometryVersion!: number;
  @Column({ name: 'zone_id', type: 'uuid' }) zoneId!: string;
  @Column({ name: 'policy_revision', type: 'bigint' }) policyRevision!: string;
}
