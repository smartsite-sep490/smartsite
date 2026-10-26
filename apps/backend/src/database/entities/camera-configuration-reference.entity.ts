import { Check, Column, Entity, ForeignKey, Index, PrimaryColumn, Unique } from 'typeorm';
import { CameraEntity } from './camera.entity.js';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';

@Entity({ name: 'camera_view_revision' })
@Unique('uq_camera_view_revision_site', ['cameraId', 'revision', 'siteId'])
@Index('uq_camera_view_current', ['cameraId'], { unique: true, where: 'is_current' })
@Index('idx_camera_view_site', ['siteId'])
@Check('chk_camera_view_revision', 'revision BETWEEN 1 AND 9007199254740991')
@Check('chk_camera_view_source', "source_kind IN ('LIVE','REPLAY')")
@Check('chk_camera_view_dimensions', 'width BETWEEN 64 AND 1280 AND height BETWEEN 64 AND 1280')
@Check('chk_camera_view_unconfirmed', "view_validity = 'UNCONFIRMED'")
@Check(
  'chk_camera_view_times',
  'isfinite(created_at) AND (retired_at IS NULL OR (isfinite(retired_at) AND retired_at >= created_at))',
)
@Check('chk_camera_view_current', 'is_current = (retired_at IS NULL)')
export class CameraViewRevisionEntity {
  @PrimaryColumn({
    name: 'camera_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_view_revision',
  })
  @ForeignKey(() => CameraEntity, { name: 'fk_camera_view_camera', onDelete: 'RESTRICT' })
  cameraId!: string;
  @PrimaryColumn({ type: 'bigint', primaryKeyConstraintName: 'pk_camera_view_revision' })
  revision!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_camera_view_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;
  @Column({ name: 'source_kind', type: 'varchar', length: 8 })
  sourceKind!: 'LIVE' | 'REPLAY';
  @Column({ type: 'integer' })
  width!: number;
  @Column({ type: 'integer' })
  height!: number;
  @Column({ name: 'view_validity', type: 'varchar', length: 16 })
  viewValidity!: 'UNCONFIRMED';
  @Column({ name: 'is_current', type: 'boolean' })
  isCurrent!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt!: Date | null;
}

@Entity({ name: 'camera_configuration_reference' })
@ForeignKey(
  () => CameraViewRevisionEntity,
  ['cameraId', 'viewRevision', 'siteId'],
  ['cameraId', 'revision', 'siteId'],
  { name: 'fk_camera_reference_view_site', onDelete: 'RESTRICT' },
)
@Index('idx_camera_reference_view_site', ['cameraId', 'viewRevision', 'siteId'])
@Index('idx_camera_reference_site_expiry', ['siteId', 'expiresAt'])
@Index('idx_camera_reference_issuer', ['issuedByUserId'])
@Check('chk_camera_reference_revision', 'configuration_version BETWEEN 1 AND 9007199254740991')
@Check('chk_camera_reference_hash', "image_sha256 ~ '^[a-f0-9]{64}$'")
@Check('chk_camera_reference_source', "source_kind IN ('LIVE','REPLAY')")
@Check(
  'chk_camera_reference_dimensions',
  'width BETWEEN 64 AND 1280 AND height BETWEEN 64 AND 1280',
)
@Check(
  'chk_camera_reference_times',
  "isfinite(captured_at) AND isfinite(issued_at) AND isfinite(expires_at) AND issued_at - captured_at BETWEEN INTERVAL '-1 second' AND INTERVAL '2 seconds' AND expires_at > issued_at AND expires_at <= LEAST(captured_at, issued_at) + INTERVAL '5 minutes'",
)
export class CameraConfigurationReferenceEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_camera_configuration_reference' })
  id!: string;
  @Column({ name: 'camera_id', type: 'uuid' })
  cameraId!: string;
  @Column({ name: 'view_revision', type: 'bigint' })
  viewRevision!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  siteId!: string;
  @Column({ name: 'session_id', type: 'uuid' })
  sessionId!: string;
  @Column({ name: 'source_kind', type: 'varchar', length: 8 })
  sourceKind!: 'LIVE' | 'REPLAY';
  @Column({ type: 'integer' })
  width!: number;
  @Column({ type: 'integer' })
  height!: number;
  @Column({ name: 'image_sha256', type: 'char', length: 64 })
  imageSha256!: string;
  @Column({ name: 'configuration_version', type: 'bigint' })
  configurationVersion!: string;
  @Column({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;
  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
  @Column({ name: 'issued_by_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_camera_reference_issuer', onDelete: 'RESTRICT' })
  issuedByUserId!: string;
}
