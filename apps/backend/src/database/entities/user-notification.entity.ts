import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  ForeignKey,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import type {
  SchedulingNotificationEvent,
  ScheduleAssignmentNotificationEvent,
} from '@smartsite/contracts';
import type { AttendanceNotificationEvent } from '@smartsite/contracts';
import { UserEntity } from './user.entity.js';
import { SiteEntity } from './site.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { WorkerEntity } from './worker.entity.js';

export interface NotificationContent {
  checklistId?: string;
  dayId?: string;
  incidentId?: string;
  actionId?: string;
  siteName: string;
  title: string;
  message: string;
  workDate?: string;
  fromShiftName?: string;
  toShiftName?: string;
}

@Entity({ name: 'user_notification' })
@Unique('uq_notification_event_recipient', ['recipientUserId', 'requestType', 'requestId', 'event'])
@Index('idx_notification_recipient_created', ['recipientUserId', 'createdAt', 'id'])
@Index('idx_notification_unread', ['recipientUserId', 'createdAt'], { where: 'read_at IS NULL' })
@Check(
  'chk_notification_request_type',
  "request_type IN ('CHANGE', 'SWAP', 'SAFETY', 'ATTENDANCE', 'SCHEDULE', 'CHECKLIST')",
)
@Check('chk_notification_deleted_read', 'deleted_at IS NULL OR read_at IS NOT NULL')
@Check(
  'chk_notification_role',
  "(recipient_role = 'WORKER' AND worker_id IS NOT NULL) OR (recipient_role IN ('CONTRACTOR_REPRESENTATIVE','SAFETY_OFFICER','SITE_MANAGER') AND worker_id IS NULL)",
)
@Check(
  'chk_notification_event',
  "event IN ('CHANGE_REQUESTED', 'SWAP_REQUESTED', 'SWAP_CONFIRMED', 'SWAP_DECLINED', 'REQUEST_APPLIED', 'REQUEST_REJECTED', 'REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED')",
)
@Check(
  'chk_notification_schedule_target',
  `(request_type <> 'SCHEDULE' AND event NOT IN ('SCHEDULE_CHANGED','SCHEDULE_CANCELLED')) OR (request_type = 'SCHEDULE' AND event IN ('SCHEDULE_CHANGED','SCHEDULE_CANCELLED') AND recipient_role = 'WORKER' AND COALESCE(content->>'workDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`,
)
@Check(
  'chk_notification_safety_target',
  `(request_type<>'SAFETY' AND event<>'SAFETY_HANDOVER') OR
  (request_type='SAFETY' AND event='SAFETY_HANDOVER' AND recipient_role='CONTRACTOR_REPRESENTATIVE'
    AND jsonb_typeof(content->'incidentId')='string' AND jsonb_typeof(content->'actionId')='string'
    AND COALESCE(content->>'incidentId','')<>'' AND COALESCE(content->>'actionId','')<>''
    AND (content->>'incidentId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (content->>'actionId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`,
)
@Check(
  'chk_notification_checklist_target',
  `(request_type<>'CHECKLIST' AND event NOT IN ('CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED')) OR (request_type='CHECKLIST' AND recipient_role IN ('SAFETY_OFFICER','CONTRACTOR_REPRESENTATIVE') AND event IN ('CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED') AND COALESCE(content->>'checklistId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')`,
)
export class UserNotificationEntity {
  @PrimaryColumn({ type: 'uuid', primaryKeyConstraintName: 'pk_user_notification' })
  id!: string;

  @Column({ name: 'recipient_user_id', type: 'uuid' })
  @ForeignKey(() => UserEntity, { name: 'fk_notification_user', onDelete: 'RESTRICT' })
  recipientUserId!: string;

  @Column({ name: 'site_id', type: 'uuid' })
  @ForeignKey(() => SiteEntity, { name: 'fk_notification_site', onDelete: 'RESTRICT' })
  siteId!: string;

  @Column({ name: 'contractor_id', type: 'uuid' })
  @ForeignKey(() => ContractorEntity, { name: 'fk_notification_contractor', onDelete: 'RESTRICT' })
  contractorId!: string;

  @Column({ name: 'worker_id', type: 'uuid', nullable: true })
  @ForeignKey(() => WorkerEntity, { name: 'fk_notification_worker', onDelete: 'RESTRICT' })
  workerId!: string | null;

  @Column({ name: 'recipient_role', type: 'varchar', length: 32 })
  recipientRole!: 'WORKER' | 'CONTRACTOR_REPRESENTATIVE' | 'SAFETY_OFFICER' | 'SITE_MANAGER';

  @Column({ name: 'request_type', type: 'varchar', length: 16 })
  requestType!: 'CHANGE' | 'SWAP' | 'SAFETY' | 'ATTENDANCE' | 'SCHEDULE' | 'CHECKLIST';

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ type: 'varchar', length: 24 })
  event!:
    | SchedulingNotificationEvent
    | ScheduleAssignmentNotificationEvent
    | import('@smartsite/contracts').ChecklistNotificationEvent
    | 'SAFETY_HANDOVER'
    | AttendanceNotificationEvent;

  @Column({ type: 'jsonb' })
  content!: NotificationContent;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
