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
import type { SchedulingNotificationEvent } from '@smartsite/contracts';
import { UserEntity } from './user.entity.js';
import { SiteEntity } from './site.entity.js';
import { ContractorEntity } from './contractor.entity.js';
import { WorkerEntity } from './worker.entity.js';

export interface NotificationContent {
  siteName: string;
  title: string;
  message: string;
  workDate: string;
  fromShiftName: string;
  toShiftName: string;
}

@Entity({ name: 'user_notification' })
@Unique('uq_notification_event_recipient', ['recipientUserId', 'requestType', 'requestId', 'event'])
@Index('idx_notification_recipient_created', ['recipientUserId', 'createdAt', 'id'])
@Index('idx_notification_unread', ['recipientUserId', 'createdAt'], { where: 'read_at IS NULL' })
@Check('chk_notification_request_type', "request_type IN ('CHANGE', 'SWAP')")
@Check(
  'chk_notification_role',
  "(recipient_role = 'WORKER' AND worker_id IS NOT NULL) OR (recipient_role = 'CONTRACTOR_REPRESENTATIVE' AND worker_id IS NULL)",
)
@Check(
  'chk_notification_event',
  "event IN ('CHANGE_REQUESTED', 'SWAP_REQUESTED', 'SWAP_CONFIRMED', 'SWAP_DECLINED', 'REQUEST_APPLIED', 'REQUEST_REJECTED', 'REQUEST_CONFLICTED')",
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
  recipientRole!: 'WORKER' | 'CONTRACTOR_REPRESENTATIVE';

  @Column({ name: 'request_type', type: 'varchar', length: 6 })
  requestType!: 'CHANGE' | 'SWAP';

  @Column({ name: 'request_id', type: 'uuid' })
  requestId!: string;

  @Column({ type: 'varchar', length: 24 })
  event!: SchedulingNotificationEvent;

  @Column({ type: 'jsonb' })
  content!: NotificationContent;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;
}
