import type {
  VisitorAttendanceResponse,
  VisitorMemberResponse,
  VisitorGateEventResponse,
  WorkerQrVerificationResponse,
} from '@smartsite/contracts';
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { ZoneEntity } from './zone.entity.js';

@Entity({ name: 'visitor' })
export class VisitorEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'full_name', type: 'varchar', length: 255 }) fullName!: string;
  @Column({ type: 'varchar', length: 255 }) contact!: string;
  @Column({ type: 'varchar', length: 255 }) organization!: string;
  @Column({ name: 'identity_reference', type: 'varchar', length: 200, nullable: true })
  identityReference!: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
@Entity({ name: 'visitor_visit' })
@Check('chk_visit_group_size', 'group_size BETWEEN 1 AND 1000')
@Check('chk_visit_interval', 'valid_until > valid_from')
@Check('chk_visit_status', "status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')")
@Check(
  'chk_visit_counts',
  'entered_count >= 0 AND exited_count >= 0 AND exited_count <= entered_count AND entered_count - exited_count <= group_size',
)
@Check('chk_visit_version', 'version >= 1')
@Check(
  'chk_visit_members',
  "jsonb_typeof(members) = 'array' AND (jsonb_array_length(members) = 0 OR jsonb_array_length(members) = group_size)",
)
@Index('uq_visit_booking_code', ['bookingCodeHash'], {
  unique: true,
  where: 'booking_code_hash IS NOT NULL',
})
@Index('idx_visitor_visit_site_status', ['siteId', 'status', 'createdAt'])
export class VisitorVisitEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_visit_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'representative_visitor_id', type: 'uuid' })
  @ForeignKey(() => VisitorEntity, { name: 'fk_visit_representative', onDelete: 'RESTRICT' })
  representativeVisitorId!: string;
  @Column({ name: 'site_manager_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_visit_site_manager', onDelete: 'RESTRICT' })
  siteManagerId!: string;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @Column({ name: 'review_note', type: 'text', nullable: true }) reviewNote!: string | null;
  @Column({ name: 'access_key_hash', type: 'varchar', length: 64, select: false })
  accessKeyHash!: string;
  @Column({ name: 'visitor_name', type: 'varchar', length: 255 })
  visitorName!: string;
  @Column({ type: 'varchar', length: 255 })
  company!: string;
  @Column({ type: 'varchar', length: 255 })
  contact!: string;
  @Column({ name: 'host_name', type: 'varchar', length: 255 })
  hostName!: string;
  @Column({ type: 'varchar', length: 1000 })
  purpose!: string;
  @Column({ name: 'target_area', type: 'varchar', length: 255 })
  targetArea!: string;
  @Column({ name: 'group_size', type: 'integer' })
  groupSize!: number;
  @Column({ type: 'jsonb', default: [] })
  members!: VisitorMemberResponse[];
  @Column({ type: 'varchar', length: 254, nullable: true }) email!: string | null;
  @Column({ type: 'varchar', length: 2, default: 'en' }) language!: 'en' | 'vi';
  @Column({ name: 'booking_code_hash', type: 'varchar', length: 64, nullable: true, select: false })
  bookingCodeHash!: string | null;
  @Column({ name: 'booking_code_ciphertext', type: 'text', nullable: true, select: false })
  bookingCodeCiphertext!: string | null;
  @Column({ name: 'email_status', type: 'varchar', length: 16, default: 'NOT_REQUESTED' })
  emailStatus!: 'NOT_REQUESTED' | 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  @Column({ name: 'email_attempts', type: 'integer', default: 0 }) emailAttempts!: number;
  @Column({ name: 'email_attempted_at', type: 'timestamptz', nullable: true })
  emailAttemptedAt!: Date | null;
  @Column({ name: 'email_sent_at', type: 'timestamptz', nullable: true }) emailSentAt!: Date | null;
  @Column({ name: 'email_next_attempt_at', type: 'timestamptz', nullable: true })
  emailNextAttemptAt!: Date | null;
  @Column({ name: 'gate_id', type: 'varchar', length: 64 })
  gateId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil!: Date;
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'EXPIRED';
  @Column({ name: 'entered_count', type: 'integer', default: 0 })
  enteredCount!: number;
  @Column({ name: 'exited_count', type: 'integer', default: 0 })
  exitedCount!: number;
  @Column({ name: 'decided_by_user_id', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_visit_decider', onDelete: 'RESTRICT' })
  decidedByUserId!: string | null;
  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
@Entity({ name: 'visit_zone' })
@Index('uq_visit_zone_interval', ['visitId', 'zoneId', 'validFrom'], { unique: true })
@Check('chk_visit_zone_interval', 'valid_until > valid_from')
export class VisitZoneEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'visit_id', type: 'uuid' })
  @ForeignKey(() => VisitorVisitEntity, { name: 'fk_visit_zone_visit', onDelete: 'CASCADE' })
  visitId!: string;
  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_visit_zone_zone', onDelete: 'RESTRICT' })
  zoneId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' }) validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz' }) validUntil!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
@Entity({ name: 'qr_fallback_session' })
@Check('chk_fallback_direction', "direction IN ('IN','OUT')")
@Check(
  'chk_fallback_reason',
  "reason IN ('CAMERA_UNAVAILABLE','UNKNOWN','LOW_CONFIDENCE','QUALITY_FAILED','AI_UNAVAILABLE')",
)
export class QrFallbackSessionEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_fallback_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'gate_id', type: 'varchar', length: 64 })
  gateId!: string;
  @Column({ name: 'operator_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_fallback_operator', onDelete: 'RESTRICT' })
  operatorUserId!: string;
  @Column({ type: 'varchar', length: 3 })
  direction!: 'IN' | 'OUT';
  @Column({ type: 'varchar', length: 32 })
  reason!: string;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
@Entity({ name: 'qr_credential' })
@Check(
  'chk_qr_subject',
  '(visit_id IS NOT NULL AND worker_id IS NULL AND fallback_session_id IS NULL) OR (visit_id IS NULL AND worker_id IS NOT NULL AND fallback_session_id IS NOT NULL)',
)
@Index('uq_qr_credential_token_hash', ['tokenHash'], { unique: true })
@Check('chk_qr_direction', "direction IN ('IN','OUT')")
@Check('ck_qr_expiry', 'expires_at > created_at')
export class QrCredentialEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_qr_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ type: 'varchar', length: 3 }) direction!: 'IN' | 'OUT';
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'visit_id', type: 'uuid', nullable: true })
  @ForeignKey(() => VisitorVisitEntity, { name: 'fk_qr_visit', onDelete: 'RESTRICT' })
  visitId!: string | null;
  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_qr_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;
  @Column({ name: 'fallback_session_id', type: 'uuid', nullable: true })
  @ForeignKey(() => QrFallbackSessionEntity, { name: 'fk_qr_fallback', onDelete: 'RESTRICT' })
  fallbackSessionId!: string | null;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt!: Date | null;
  @Column({ name: 'request_hash', type: 'varchar', length: 64, nullable: true })
  requestHash!: string | null;
  @Column({ type: 'jsonb', nullable: true })
  result!: VisitorGateEventResponse | WorkerQrVerificationResponse | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
@Entity({ name: 'visitor_gate_event' })
@Check('chk_visitor_event_direction', "direction IN ('IN','OUT')")
@Check('chk_visitor_event_count', 'count > 0')
@Check(
  'chk_event_attendees',
  "jsonb_typeof(attendees) = 'array' AND (jsonb_array_length(attendees) = 0 OR jsonb_array_length(attendees) = count)",
)
@Index('idx_visitor_gate_event_visit', ['visitId', 'createdAt'])
export class VisitorGateEventEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;
  @Column({ name: 'visit_id', type: 'uuid' })
  @ForeignKey(() => VisitorVisitEntity, { name: 'fk_visitor_event_visit', onDelete: 'RESTRICT' })
  visitId!: string;
  @Column({ name: 'operator_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_visitor_event_operator', onDelete: 'RESTRICT' })
  operatorUserId!: string;
  @Column({ name: 'gate_id', type: 'varchar', length: 64 })
  gateId!: string;
  @Column({ type: 'varchar', length: 3 })
  direction!: 'IN' | 'OUT';
  @Column({ type: 'integer' })
  count!: number;
  @Column({ type: 'jsonb', default: [] })
  attendees!: VisitorAttendanceResponse[];
  @Column({ name: 'request_hash', type: 'varchar', length: 64, nullable: true }) requestHash!:
    string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
