import {
  Check,
  Column,
  Entity,
  ForeignKey,
  Generated,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { CameraEntity } from './camera.entity.js';
import { CameraConfigurationBundleEntity } from './camera-configuration-bundle.entity.js';

@Entity({ name: 'camera_worker_generation' })
@ForeignKey(() => CameraEntity, ['cameraId', 'siteId'], ['id', 'siteId'], {
  name: 'fk_camera_worker_generation_camera_site',
  onDelete: 'RESTRICT',
})
@Unique('uq_camera_worker_generation_scope', ['id', 'cameraId', 'siteId', 'streamSessionId'])
@Index('uq_camera_worker_generation_current', ['cameraId'], { unique: true, where: 'is_current' })
@Index('idx_camera_worker_generation_camera_site', ['cameraId', 'siteId'])
@Check('chk_camera_worker_generation_hash', "credential_sha256 ~ '^[a-f0-9]{64}$'")
@Check(
  'chk_camera_worker_generation_current',
  'is_current=(superseded_at IS NULL AND revoked_at IS NULL)',
)
@Check(
  'chk_camera_worker_generation_times',
  `isfinite(issued_at) AND isfinite(expires_at)
  AND expires_at>=issued_at+INTERVAL '1 second' AND expires_at<=issued_at+INTERVAL '24 hours'
  AND (superseded_at IS NULL OR (isfinite(superseded_at) AND superseded_at>=issued_at))
  AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=issued_at))`,
)
export class CameraWorkerGenerationEntity {
  @PrimaryColumn({
    name: 'id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_worker_generation',
  })
  id!: string;
  @Column({ name: 'camera_id', type: 'uuid' }) cameraId!: string;
  @Column({ name: 'site_id', type: 'uuid' }) siteId!: string;
  @Column({ name: 'stream_session_id', type: 'uuid' }) streamSessionId!: string;
  @Column({ name: 'credential_sha256', type: 'char', length: 64, select: false })
  credentialSha256!: string;
  @Column({ name: 'is_current', type: 'boolean' }) isCurrent!: boolean;
  @Column({ name: 'issued_at', type: 'timestamptz' }) issuedAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
}

@Entity({ name: 'camera_configuration_application_receipt' })
@ForeignKey(
  () => CameraWorkerGenerationEntity,
  ['workerGenerationId', 'cameraId', 'siteId', 'streamSessionId'],
  ['id', 'cameraId', 'siteId', 'streamSessionId'],
  { name: 'fk_camera_application_receipt_generation', onDelete: 'RESTRICT' },
)
@ForeignKey(
  () => CameraConfigurationBundleEntity,
  ['cameraId', 'configurationVersion', 'siteId', 'viewRevision', 'bundleSha256'],
  ['cameraId', 'configurationVersion', 'siteId', 'viewRevision', 'bundleSha256'],
  { name: 'fk_camera_application_receipt_bundle', onDelete: 'RESTRICT' },
)
@Unique('uq_camera_application_receipt_order', ['receiptOrder'])
@Index('idx_camera_application_receipt_generation_scope', [
  'workerGenerationId',
  'cameraId',
  'siteId',
  'streamSessionId',
  'receiptOrder',
])
@Index('idx_camera_application_receipt_bundle_scope', [
  'cameraId',
  'configurationVersion',
  'siteId',
  'viewRevision',
  'bundleSha256',
])
@Check(
  'chk_camera_application_receipt_versions',
  'configuration_version BETWEEN 1 AND 9007199254740991 AND view_revision BETWEEN 1 AND 9007199254740991',
)
@Check(
  'chk_camera_application_receipt_hashes',
  "bundle_sha256 ~ '^[a-f0-9]{64}$' AND payload_sha256 ~ '^[a-f0-9]{64}$'",
)
@Check(
  'chk_camera_application_receipt_outcome',
  "(outcome='LOADED' AND reason_code IS NULL) OR (outcome='REJECTED' AND (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'))",
)
@Check('chk_camera_application_receipt_time', 'isfinite(received_at)')
export class CameraConfigurationApplicationReceiptEntity {
  @PrimaryColumn({
    name: 'command_id',
    type: 'uuid',
    primaryKeyConstraintName: 'pk_camera_configuration_application_receipt',
  })
  commandId!: string;
  @Generated('increment')
  @Column({ name: 'receipt_order', type: 'bigint' })
  receiptOrder!: string;
  @Column({ name: 'camera_id', type: 'uuid' }) cameraId!: string;
  @Column({ name: 'site_id', type: 'uuid' }) siteId!: string;
  @Column({ name: 'worker_generation_id', type: 'uuid' }) workerGenerationId!: string;
  @Column({ name: 'stream_session_id', type: 'uuid' }) streamSessionId!: string;
  @Column({ name: 'configuration_version', type: 'bigint' }) configurationVersion!: string;
  @Column({ name: 'view_revision', type: 'bigint' }) viewRevision!: string;
  @Column({ name: 'bundle_sha256', type: 'char', length: 64 }) bundleSha256!: string;
  @Column({ name: 'outcome', type: 'varchar', length: 16 }) outcome!: 'LOADED' | 'REJECTED';
  @Column({ name: 'reason_code', type: 'varchar', length: 64, nullable: true }) reasonCode!:
    string | null;
  @Column({ name: 'payload_sha256', type: 'char', length: 64 }) payloadSha256!: string;
  @Column({ name: 'received_at', type: 'timestamptz' }) receivedAt!: Date;
}
