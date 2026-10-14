import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ForeignKey,
  Check,
  Unique,
  Index,
} from 'typeorm';
import type {
  ChecklistStatus,
  ChecklistAnswer,
  ChecklistSubmissionStatus,
} from '@smartsite/contracts';
import { SiteEntity } from './site.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { ContractorTeamEntity } from './contractor-team.entity.js';
import { UserEntity } from './user.entity.js';
import { SafetyEvidenceEntity } from './safety-workflow.entity.js';
@Entity({ name: 'safety_checklist_assignment' })
@Check(
  'ck_checklist_status',
  "status IN ('ASSIGNED','IN_PROGRESS','SUBMITTED','ACCEPTED','CANCELLED')",
)
@Check('ck_checklist_version', 'version>0')
@Check('ck_checklist_interval', 'ends_at>starts_at')
@Check('ck_checklist_description', 'char_length(trim(description)) BETWEEN 1 AND 2000')
@Index('idx_checklist_site_created', ['siteId', 'createdAt', 'id'])
@Index('idx_checklist_assignee', ['assignedTo', 'status'])
@ForeignKey(
  () => ContractorTeamEntity,
  ['teamId', 'siteId', 'contractorId'],
  ['id', 'siteId', 'contractorId'],
  { name: 'fk_checklist_team_scope', onDelete: 'RESTRICT' },
)
export class SafetyChecklistAssignmentEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_checklist_site', onDelete: 'RESTRICT' })
  siteId!: string;
  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, { name: 'fk_checklist_contractor', onDelete: 'RESTRICT' })
  contractorId!: string;
  @Column({ name: 'team_id', type: 'uuid' }) teamId!: string;
  @Column({ name: 'zone_id', type: 'uuid' })
  @ForeignKey(() => ZoneEntity, { name: 'fk_checklist_zone', onDelete: 'RESTRICT' })
  zoneId!: string;
  @Column({ type: 'varchar', length: 2000 }) description!: string;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt!: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt!: Date;
  @Column({ name: 'assigned_to', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_checklist_assignee', onDelete: 'RESTRICT' })
  assignedTo!: string;
  @Column({ name: 'assigned_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_checklist_creator', onDelete: 'RESTRICT' })
  assignedBy!: string;
  @Column({ type: 'varchar', length: 16, default: 'ASSIGNED' }) status!: ChecklistStatus;
  @Column({ type: 'integer', default: 1 }) version!: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
@Entity({ name: 'safety_checklist_item' })
@Unique('uq_checklist_item_scope', ['id', 'assignmentId'])
@Unique('uq_checklist_item_position', ['assignmentId', 'position'])
@Check('ck_checklist_item_text', 'char_length(trim(text)) BETWEEN 1 AND 1000')
@Check('ck_checklist_item_position', 'position BETWEEN 0 AND 29')
export class SafetyChecklistItemEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'assignment_id', type: 'uuid' })
  @ForeignKey(() => SafetyChecklistAssignmentEntity, {
    name: 'fk_checklist_item_assignment',
    onDelete: 'RESTRICT',
  })
  assignmentId!: string;
  @Column({ type: 'integer' }) position!: number;
  @Column({ type: 'varchar', length: 1000 }) text!: string;
  @Column({ name: 'evidence_required', type: 'boolean' }) evidenceRequired!: boolean;
}
@Entity({ name: 'safety_checklist_submission' })
@Unique('uq_checklist_submission_scope', ['id', 'assignmentId'])
@Index('uq_checklist_pending', ['assignmentId'], { unique: true, where: "status='PENDING'" })
@Check('ck_checklist_submission_status', "status IN ('PENDING','ACCEPTED','RETURNED')")
@Check(
  'ck_checklist_review',
  "(status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND review_note IS NULL) OR (status IN ('ACCEPTED','RETURNED') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND char_length(trim(review_note)) BETWEEN 1 AND 2000 AND reviewed_by<>submitted_by)",
)
export class SafetyChecklistSubmissionEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'assignment_id', type: 'uuid' })
  @ForeignKey(() => SafetyChecklistAssignmentEntity, {
    name: 'fk_checklist_submission_assignment',
    onDelete: 'RESTRICT',
  })
  assignmentId!: string;
  @Column({ name: 'submitted_by', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_checklist_submitter', onDelete: 'RESTRICT' })
  submittedBy!: string;
  @CreateDateColumn({ name: 'submitted_at', type: 'timestamptz' }) submittedAt!: Date;
  @Column({ type: 'varchar', length: 16, default: 'PENDING' }) status!: ChecklistSubmissionStatus;
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  @ForeignKey(() => UserEntity, { name: 'fk_checklist_reviewer', onDelete: 'RESTRICT' })
  reviewedBy!: string | null;
  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true }) reviewedAt!: Date | null;
  @Column({ name: 'review_note', type: 'varchar', length: 2000, nullable: true }) reviewNote!:
    string | null;
}
@Entity({ name: 'safety_checklist_item_result' })
@Unique('uq_checklist_result_item', ['submissionId', 'itemId'])
@Check('ck_checklist_answer', "answer IN ('PASS','FAIL','NOT_APPLICABLE')")
@Check(
  'ck_checklist_result_note',
  "char_length(note)<=2000 AND (answer='PASS' OR char_length(trim(note))>0)",
)
@ForeignKey(
  () => SafetyChecklistSubmissionEntity,
  ['submissionId', 'assignmentId'],
  ['id', 'assignmentId'],
  { name: 'fk_checklist_result_submission', onDelete: 'RESTRICT' },
)
@ForeignKey(() => SafetyChecklistItemEntity, ['itemId', 'assignmentId'], ['id', 'assignmentId'], {
  name: 'fk_checklist_result_item',
  onDelete: 'RESTRICT',
})
export class SafetyChecklistItemResultEntity {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ name: 'assignment_id', type: 'uuid' }) assignmentId!: string;
  @Column({ name: 'submission_id', type: 'uuid' }) submissionId!: string;
  @Column({ name: 'item_id', type: 'uuid' }) itemId!: string;
  @Column({ type: 'varchar', length: 16 }) answer!: ChecklistAnswer;
  @Column({ type: 'varchar', length: 2000, default: '' }) note!: string;
}
@Entity({ name: 'safety_checklist_result_evidence' })
export class SafetyChecklistResultEvidenceEntity {
  @PrimaryColumn({ name: 'result_id', type: 'uuid' })
  @ForeignKey(() => SafetyChecklistItemResultEntity, {
    name: 'fk_checklist_evidence_result',
    onDelete: 'RESTRICT',
  })
  resultId!: string;
  @PrimaryColumn({ name: 'evidence_id', type: 'uuid' })
  @ForeignKey(() => SafetyEvidenceEntity, {
    name: 'fk_checklist_evidence_file',
    onDelete: 'RESTRICT',
  })
  evidenceId!: string;
}
