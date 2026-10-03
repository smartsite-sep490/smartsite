import type { VisitorGateEventResponse, WorkerQrVerificationResponse } from '@smartsite/contracts';
import { Check, Column, CreateDateColumn, Entity, ForeignKey, Index, PrimaryColumn } from 'typeorm';
import { SiteEntity } from './site.entity.js';
import { UserEntity } from './user.entity.js';
import { WorkerEntity } from './worker.entity.js';
@Entity({ name: 'visitor_visit' })
@Check('chk_visit_group_size', 'group_size BETWEEN 1 AND 1000')
@Check('chk_visit_interval', 'valid_until > valid_from')
@Check('chk_visit_status', "status IN ('PENDING','APPROVED','REJECTED')")
@Check(
  'chk_visit_counts',
  'entered_count >= 0 AND entered_count <= group_size AND exited_count >= 0 AND exited_count <= entered_count',
)
@Index('idx_visitor_visit_site_status', ['siteId', 'status', 'createdAt'])
export class VisitorVisitEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_visit_site', onDelete: 'RESTRICT' })
  siteId!: string;
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
  @Column({ name: 'gate_id', type: 'varchar', length: 64 })
  gateId!: string;
  @Column({ name: 'valid_from', type: 'timestamptz' })
  validFrom!: Date;
  @Column({ name: 'valid_until', type: 'timestamptz' })
  validUntil!: Date;
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status!: 'PENDING' | 'APPROVED' | 'REJECTED';
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
export class QrCredentialEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash!: string;
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
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
