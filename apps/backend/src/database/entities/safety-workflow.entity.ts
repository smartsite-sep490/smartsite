import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ContractorEntity } from './contractor.entity.js';
import { WorkerEntity } from './worker.entity.js';
import { SiteEntity } from './site.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { UserEntity } from './user.entity.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';
import type {
  IncidentSeverity,
  IncidentStatus,
  CorrectiveActionStatus,
  SubmissionStatus,
  SafetyTaskKind,
  SafetyTaskStatus,
} from '@smartsite/contracts';

@Entity({ name: 'incident' })
@Check('incident_title_check', 'length(trim(title))>0')
@Check('incident_description_check', 'length(trim(description))>0')
@Check('incident_severity_check', "severity IN ('LOW','MEDIUM','HIGH','CRITICAL')")
@Check(
  'incident_status_check',
  "status IN ('OPEN','ASSIGNED','IN_PROGRESS','VERIFIED','CLOSED','REOPENED')",
)
@Check('incident_version_check', 'version>=1')
@Check(
  'chk_incident_closure',
  "(status='CLOSED' AND closed_by IS NOT NULL AND closed_at IS NOT NULL) OR (status<>'CLOSED' AND closed_by IS NULL AND closed_at IS NULL)",
)
@Check(
  'incident_responsibility_check',
  '(contractor_id IS NULL AND responsibility_reason IS NULL AND responsibility_confirmed_by IS NULL AND responsibility_confirmed_at IS NULL) OR (contractor_id IS NOT NULL AND responsibility_reason IS NOT NULL AND length(trim(responsibility_reason))>0 AND responsibility_confirmed_by IS NOT NULL AND responsibility_confirmed_at IS NOT NULL)',
)
@Index('idx_incident_site_order', { synchronize: false })
export class IncidentEntity {
  @Column({ name: 'contractor_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ContractorEntity, {
    name: 'incident_contractor_id_fkey',
    onDelete: 'NO ACTION',
  })
  contractorId!: string | null;
  @Column({ name: 'responsibility_reason', type: 'text', nullable: true }) responsibilityReason!:
    string | null;
  @Column({ name: 'responsibility_confirmed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, {
    name: 'incident_responsibility_confirmed_by_fkey',
    onDelete: 'NO ACTION',
  })
  responsibilityConfirmedBy!: string | null;
  @Column({ name: 'responsibility_confirmed_at', type: 'timestamptz', nullable: true })
  responsibilityConfirmedAt!: Date | null;
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'incident_site_id_fkey', onDelete: 'NO ACTION' })
  siteId!: string;
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ZoneEntity, { name: 'incident_zone_id_fkey', onDelete: 'NO ACTION' })
  zoneId!: string | null;
  @Column({ name: 'title', type: 'varchar', length: 200 })
  title!: string;
  @Column({ name: 'description', type: 'text' })
  description!: string;
  @Column({ name: 'severity', type: 'varchar', length: 16 })
  severity!: IncidentSeverity;
  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: IncidentStatus;
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;
  @Column({ name: 'reported_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'incident_reported_by_fkey', onDelete: 'NO ACTION' })
  reportedBy!: string;
  @Column({ name: 'closed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'incident_closed_by_fkey', onDelete: 'NO ACTION' })
  closedBy!: string | null;
  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt!: Date | null;
  @Column({ name: 'version', type: 'integer', default: 1 })
  version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'incident_worker' })
export class IncidentWorkerEntity {
  @PrimaryColumn({ name: 'incident_id', type: 'uuid' })
  @ForeignKey(() => IncidentEntity, {
    name: 'incident_worker_incident_id_fkey',
    onDelete: 'NO ACTION',
  })
  incidentId!: string;
  @PrimaryColumn({ name: 'worker_id', type: 'uuid' })
  @ForeignKey(() => WorkerEntity, { name: 'incident_worker_worker_id_fkey', onDelete: 'NO ACTION' })
  workerId!: string;
}

@Entity({ name: 'corrective_action' })
@Check('corrective_action_description_check', 'length(trim(description))>0')
@Check(
  'corrective_action_status_check',
  "status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','VERIFIED','CLOSED')",
)
@Check('corrective_action_version_check', 'version>=1')
@Check(
  'action_supersession_check',
  '(superseded_at IS NULL AND superseded_by IS NULL AND superseded_reason IS NULL) OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL AND length(trim(superseded_reason))>0 AND superseded_reason IS NOT NULL)',
)
@Index('idx_action_incident', { synchronize: false })
@Index('idx_action_assignee', { synchronize: false })
export class CorrectiveActionEntity {
  @Column({ name: 'superseded_at', type: 'timestamptz', nullable: true })
  supersededAt!: Date | null;
  @Column({ name: 'superseded_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'action_superseded_by_fkey', onDelete: 'NO ACTION' })
  supersededBy!: string | null;
  @Column({ name: 'superseded_reason', type: 'text', nullable: true }) supersededReason!:
    string | null;
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'incident_id', type: 'uuid' })
  @ForeignKey(() => IncidentEntity, {
    name: 'corrective_action_incident_id_fkey',
    onDelete: 'NO ACTION',
  })
  incidentId!: string;
  @Column({ name: 'assigned_to', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'corrective_action_assigned_to_fkey',
    onDelete: 'NO ACTION',
  })
  assignedTo!: string;
  @Column({ name: 'assigned_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'corrective_action_assigned_by_fkey',
    onDelete: 'NO ACTION',
  })
  assignedBy!: string;
  @Column({ name: 'description', type: 'text' })
  description!: string;
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;
  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: CorrectiveActionStatus;
  @Column({ name: 'version', type: 'integer', default: 1 })
  version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'corrective_action_submission' })
@Check(
  'corrective_action_submission_result_description_check',
  'length(trim(result_description))>0',
)
@Check('corrective_action_submission_status_check', "status IN ('PENDING','APPROVED','REJECTED')")
@Check(
  'chk_submission_review',
  "(status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL) OR (status<>'PENDING' AND reviewed_by IS NOT NULL AND reviewed_by<>submitted_by AND reviewed_at IS NOT NULL AND review_note IS NOT NULL AND length(trim(review_note))>0)",
)
@Index('uq_action_pending_submission', { synchronize: false })
export class CorrectiveActionSubmissionEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'corrective_action_id', type: 'uuid' })
  @ForeignKey(() => CorrectiveActionEntity, {
    name: 'corrective_action_submission_corrective_action_id_fkey',
    onDelete: 'NO ACTION',
  })
  correctiveActionId!: string;
  @Column({ name: 'submitted_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'corrective_action_submission_submitted_by_fkey',
    onDelete: 'NO ACTION',
  })
  submittedBy!: string;
  @Column({ name: 'result_description', type: 'text' })
  resultDescription!: string;
  @Column({ name: 'evidence_id', type: 'uuid', nullable: true })
  @ForeignKey(() => SafetyEvidenceEntity, {
    name: 'corrective_action_submission_evidence_id_fkey',
    onDelete: 'NO ACTION',
  })
  evidenceId!: string | null;
  @Column({ name: 'submitted_at', type: 'timestamptz' })
  submittedAt!: Date;
  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: SubmissionStatus;
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, {
    name: 'corrective_action_submission_reviewed_by_fkey',
    onDelete: 'NO ACTION',
  })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;
}

@Entity({ name: 'safety_task' })
@Check(
  'safety_task_kind_check',
  "kind IN ('ZONE_INSPECTION','ALERT_VERIFICATION','SAFETY_FOLLOW_UP','SAFETY_PATROL')",
)
@Check('safety_task_description_check', 'length(trim(description))>0')
@Check(
  'safety_task_status_check',
  "status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','VERIFIED','CANCELLED')",
)
@Check('safety_task_version_check', 'version>=1')
@Check(
  'chk_task_completed',
  "status NOT IN ('COMPLETED','VERIFIED') OR (completed_at IS NOT NULL AND result_summary IS NOT NULL AND length(trim(result_summary))>0)",
)
@Check(
  'chk_task_verification',
  "(status='VERIFIED' AND verified_by IS NOT NULL AND verified_by<>assigned_to AND verified_at IS NOT NULL) OR (status<>'VERIFIED' AND verified_by IS NULL AND verified_at IS NULL)",
)
@Index('idx_task_site_order', { synchronize: false })
@Index('idx_task_assignee', { synchronize: false })
export class SafetyTaskEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'safety_task_site_id_fkey', onDelete: 'NO ACTION' })
  siteId!: string;
  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  @ForeignKey(() => ZoneEntity, { name: 'safety_task_zone_id_fkey', onDelete: 'NO ACTION' })
  zoneId!: string | null;
  @Column({ name: 'kind', type: 'varchar', length: 32 })
  kind!: SafetyTaskKind;
  @Column({ name: 'source_alert_id', type: 'uuid', nullable: true })
  @ForeignKey(() => SafetyAlertEntity, {
    name: 'safety_task_source_alert_id_fkey',
    onDelete: 'NO ACTION',
  })
  sourceAlertId!: string | null;
  @Column({ name: 'source_incident_id', type: 'uuid', nullable: true })
  @ForeignKey(() => IncidentEntity, {
    name: 'safety_task_source_incident_id_fkey',
    onDelete: 'NO ACTION',
  })
  sourceIncidentId!: string | null;
  @Column({ name: 'assigned_to', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'safety_task_assigned_to_fkey', onDelete: 'NO ACTION' })
  assignedTo!: string;
  @Column({ name: 'assigned_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'safety_task_assigned_by_fkey', onDelete: 'NO ACTION' })
  assignedBy!: string;
  @Column({ name: 'description', type: 'text' })
  description!: string;
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt!: Date | null;
  @Column({ name: 'status', type: 'varchar', length: 16 })
  status!: SafetyTaskStatus;
  @Column({ name: 'result_summary', type: 'text', nullable: true })
  resultSummary!: string | null;
  @Column({ name: 'result_evidence_id', type: 'uuid', nullable: true })
  @ForeignKey(() => SafetyEvidenceEntity, {
    name: 'safety_task_result_evidence_id_fkey',
    onDelete: 'NO ACTION',
  })
  resultEvidenceId!: string | null;
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
  @Column({ name: 'verified_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'safety_task_verified_by_fkey', onDelete: 'NO ACTION' })
  verifiedBy!: string | null;
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;
  @Column({ name: 'version', type: 'integer', default: 1 })
  version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}

@Entity({ name: 'safety_evidence' })
@Check('safety_evidence_media_type_check', "media_type='image/jpeg'")
@Check('safety_evidence_sha256_check', "sha256 ~ '^[0-9a-f]{64}$'")
@Check('safety_evidence_size_check', 'size BETWEEN 1 AND 1048576')
@Check('safety_evidence_provider_check', "storage_provider IN ('LOCAL','R2')")
@Unique('safety_evidence_provider_key_unique', ['storageProvider', 'storageKey'])
export class SafetyEvidenceEntity {
  @Column({ name: 'storage_provider', type: 'varchar', length: 8, default: 'LOCAL' })
  storageProvider!: 'LOCAL' | 'R2';
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'safety_evidence_site_id_fkey', onDelete: 'NO ACTION' })
  siteId!: string;
  @Column({ name: 'storage_key', type: 'varchar', length: 512 })
  storageKey!: string;
  @Column({ name: 'media_type', type: 'varchar', length: 32 })
  mediaType!: string;
  @Column({ name: 'sha256', type: 'varchar', length: 64 })
  sha256!: string;
  @Column({ name: 'size', type: 'integer' })
  size!: number;
  @Column({ name: 'uploaded_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'safety_evidence_uploaded_by_fkey', onDelete: 'NO ACTION' })
  uploadedBy!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

@Entity({ name: 'safety_workflow_audit' })
@Check('safety_workflow_audit_resource_type_check', "resource_type IN ('INCIDENT','SAFETY_TASK')")
@Index('idx_workflow_audit_resource', { synchronize: false })
@Unique('safety_workflow_audit_command_id_key', ['commandId'])
export class SafetyWorkflowAuditEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'command_id', type: 'uuid' })
  commandId!: string;
  @Column({ name: 'actor_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, {
    name: 'safety_workflow_audit_actor_id_fkey',
    onDelete: 'NO ACTION',
  })
  actorId!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, {
    name: 'safety_workflow_audit_site_id_fkey',
    onDelete: 'NO ACTION',
  })
  siteId!: string;
  @Column({ name: 'resource_type', type: 'varchar', length: 16 })
  resourceType!: 'INCIDENT' | 'SAFETY_TASK';
  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId!: string;
  @Column({ name: 'action', type: 'varchar', length: 32 })
  action!: string;
  @Column({ name: 'reason', type: 'text', nullable: true })
  reason!: string | null;
  @Column({ name: 'input_hash', type: 'varchar', length: 64 })
  inputHash!: string;
  @Column({ name: 'changes', type: 'jsonb' })
  changes!: Record<string, unknown>;
  @Column({ name: 'result', type: 'jsonb' })
  result!: Record<string, unknown>;
  @Column({ name: 'occurred_at', type: 'timestamptz', default: () => 'now()' })
  occurredAt!: Date;
}
