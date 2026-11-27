import { HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  UserNotificationListResponse,
  UserNotificationResponse,
  NotificationDeleteReadResponse,
} from '@smartsite/contracts';
import { invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { UserNotificationEntity } from '../../../database/entities/user-notification.entity.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { notificationVisibilityScope } from './scheduling-notification.service.js';
import {
  attendanceNoticeContexts,
  notificationGroupingScope,
  processingStatus,
} from './notification-workflow.js';

// Preserve the reviewed writer and its authorization policy. Inbox grouping only narrows visibility.
export const inboxVisibilityScope = `(${notificationVisibilityScope}) AND (${notificationGroupingScope})`;
const scope = inboxVisibilityScope;

@Injectable()
export class NotificationInboxService {
  constructor(private readonly dataSource: DataSource) {}
  private assertActor(actor: AuthenticatedUser) {
    if (!actor.isActive || actor.mustChangePassword) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Notifications are unavailable for this account',
      });
    }
  }

  private response(n: UserNotificationEntity): UserNotificationResponse {
    if (n.requestType === 'SAFETY_ALERT')
      return {
        id: n.id,
        event: n.event,
        siteId: n.siteId,
        siteName: n.content.siteName,
        title: n.content.title,
        message: n.content.message,
        safetyAlert: n.content.safetyAlert!,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
        target: { siteId: n.siteId, alertId: n.requestId, tab: 'alerts' },
      };
    if (n.requestType === 'DOCUMENT')
      return {
        id: n.id,
        event: n.event,
        siteId: n.siteId,
        siteName: n.content.siteName,
        title: n.content.title,
        message: n.content.message,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
        target: { siteId: n.siteId, workerId: n.content.documentWorkerId!, tab: 'documents' },
      };
    if (n.requestType === 'CHECKLIST')
      return {
        id: n.id,
        event: n.event,
        siteId: n.siteId,
        siteName: n.content.siteName,
        title: n.content.title,
        message: n.content.message,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
        target: { siteId: n.siteId, checklistId: n.content.checklistId!, tab: 'checklists' },
      };
    if (n.requestType === 'SCHEDULE')
      return {
        id: n.id,
        event: n.event,
        siteId: n.siteId,
        ...n.content,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
        target: { siteId: n.siteId, workDate: n.content.workDate!, tab: 'schedule' },
      };
    if (n.requestType === 'ATTENDANCE') {
      const message =
        n.event === 'ENTRY_DENIED_NO_SCHEDULE' &&
        n.content.message?.startsWith('Bạn chưa được phân công ca làm')
          ? `You are not scheduled for a shift on ${n.content.workDate ?? ''} at this site and entry is not permitted. Please contact your contractor representative.`
          : n.content.message;
      return {
        id: n.id,
        event: n.event,
        siteId: n.siteId,
        siteName: n.content.siteName,
        title: n.content.title,
        message,
        workDate: n.content.workDate,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
        target: ['ENTRY_DENIED_NO_SCHEDULE', 'ASSIGNMENT_REVIEW'].includes(n.event)
          ? { siteId: n.siteId, workDate: n.content.workDate ?? '', tab: 'schedule' }
          : {
              siteId: n.siteId,
              dayId: n.content.dayId ?? n.requestId,
              tab: 'attendance',
              ...(['TIME_REQUESTED', 'TIME_APPROVED', 'TIME_REJECTED'].includes(n.event)
                ? { requestId: n.requestId, requestType: 'TIME' as const }
                : {}),
            },
      };
    }
    if (n.requestType === 'SAFETY')
      return {
        id: n.id,
        event: n.event,
        siteId: n.siteId,
        siteName: n.content.siteName,
        title: n.content.title,
        message: n.content.message,
        createdAt: n.createdAt.toISOString(),
        readAt: n.readAt?.toISOString() ?? null,
        target: {
          siteId: n.siteId,
          incidentId: n.content.incidentId!,
          actionId: n.content.actionId!,
          tab: 'incidents',
        },
      };
    const review =
      n.recipientRole === 'CONTRACTOR_REPRESENTATIVE' || n.recipientRole === 'SITE_MANAGER';
    const pending = n.event === 'CHANGE_REQUESTED' || n.event === 'SWAP_CONFIRMED';
    return {
      id: n.id,
      event: n.event,
      siteId: n.siteId,
      ...n.content,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
      target: {
        siteId: n.siteId,
        requestType: n.requestType,
        requestId: n.requestId,
        tab: review ? 'review' : 'schedule',
        view: review
          ? pending
            ? 'pending'
            : 'history'
          : n.event === 'SWAP_REQUESTED'
            ? 'coworker'
            : 'requests',
      },
    };
  }

  async list(
    actor: AuthenticatedUser,
    readStatus: string = 'ALL',
    offset = 0,
    limit = 20,
  ): Promise<UserNotificationListResponse> {
    if (readStatus !== 'ALL' && readStatus !== 'UNREAD')
      invalid('Invalid notification read status');
    const pagination = page(offset, limit);
    this.assertActor(actor);
    // A single repeatable snapshot keeps items, total and unreadCount consistent during delivery/read.
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const query = manager
        .getRepository(UserNotificationEntity)
        .createQueryBuilder('n')
        .where('n.recipient_user_id = :userId', { userId: actor.id })
        .andWhere('n.deleted_at IS NULL')
        .andWhere(scope);
      const unreadCount = await query.clone().andWhere('n.read_at IS NULL').getCount();
      if (readStatus === 'UNREAD') query.andWhere('n.read_at IS NULL');
      const [items, total] = await query
        .orderBy('n.created_at', 'DESC')
        .addOrderBy('n.id', 'DESC')
        .skip(pagination.offset)
        .take(pagination.limit)
        .getManyAndCount();
      // Legacy representative notices contain no worker name. Resolve only days
      // belonging to the already authorized notification's Site and Contractor.
      const missingCheckoutIds = items
        .filter((n) => n.requestType === 'ATTENDANCE' && n.event === 'MISSING_CHECKOUT')
        .map((n) => n.id);
      if (missingCheckoutIds.length) {
        const workers: Array<{
          notification_id: string;
          display_name: string;
          external_id: string;
          work_date: string;
        }> = await manager.query(
          `SELECT n.id AS notification_id, w.display_name, w.external_id, d.work_date::text
           FROM user_notification n
           JOIN attendance_day d ON d.id::text = COALESCE(n.content->>'dayId', n.request_id::text) AND d.site_id = n.site_id
           JOIN worker w ON w.id = d.worker_id AND w.site_id = n.site_id AND w.contractor_id = n.contractor_id
           WHERE n.id = ANY($1::uuid[])`,
          [missingCheckoutIds],
        );
        for (const n of items) {
          const worker = workers.find((w) => w.notification_id === n.id);
          if (worker)
            n.content = {
              ...n.content,
              message: `Worker ${worker.display_name} (${worker.external_id}) is missing checkout for the shift on ${worker.work_date}. The shift ended more than five minutes ago. Hours remain provisional.`,
            };
        }
      }
      const contexts = await attendanceNoticeContexts(manager, items);
      const documentIds = items.filter((n) => n.requestType === 'DOCUMENT').map((n) => n.id);
      const documentWorkers: { notification_id: string; display_name: string }[] =
        documentIds.length
          ? await manager.query(
              `SELECT n.id AS notification_id,w.display_name FROM user_notification n
            JOIN worker w ON w.id::text=n.content->>'documentWorkerId' AND w.site_id=n.site_id AND w.contractor_id=n.contractor_id
            WHERE n.id=ANY($1::uuid[])`,
              [documentIds],
            )
          : [];
      return {
        items: items.map((n): UserNotificationResponse => {
          const result = this.response(n);
          const context = contexts.get(n.id);
          const status = context ? processingStatus(n.event, n.recipientRole, context) : undefined;
          const workerName =
            context?.display_name ??
            documentWorkers.find((w) => w.notification_id === n.id)?.display_name;
          return {
            ...result,
            recipientRole: n.recipientRole,
            ...(workerName ? { workerName } : {}),
            ...(status ? { processingStatus: status } : {}),
            ...(context?.pending_correction_id &&
            n.recipientRole === 'CONTRACTOR_REPRESENTATIVE' &&
            ['MISSING_ATTENDANCE', 'MISSING_CHECKOUT'].includes(n.event) &&
            result.target.tab === 'attendance'
              ? {
                  target: {
                    ...result.target,
                    requestId: context.pending_correction_id,
                    requestType: 'TIME' as const,
                  },
                }
              : {}),
          };
        }),
        total,
        unreadCount,
      };
    });
  }

  async read(actor: AuthenticatedUser, id: string): Promise<{ id: string; readAt: string }> {
    const notificationId = uuid(id);
    this.assertActor(actor);
    const [rows]: [Array<{ id: string; read_at: Date }>, number] = await this.dataSource.query(
      `
      UPDATE user_notification n SET read_at = COALESCE(n.read_at, CURRENT_TIMESTAMP)
      WHERE n.id = $1 AND n.recipient_user_id = $2 AND n.deleted_at IS NULL AND ${scope} RETURNING n.id, n.read_at`,
      [notificationId, actor.id],
    );
    if (!rows[0]) missing();
    return { id: rows[0].id, readAt: rows[0].read_at.toISOString() };
  }

  async readAll(actor: AuthenticatedUser): Promise<{ updated: number }> {
    this.assertActor(actor);
    const result: [unknown[], number] = await this.dataSource.query(
      `
      UPDATE user_notification n SET read_at = CURRENT_TIMESTAMP
      WHERE n.recipient_user_id = $1 AND n.read_at IS NULL AND n.deleted_at IS NULL AND ${scope} RETURNING n.id`,
      [actor.id],
    );
    return { updated: result[1] };
  }

  async deleteRead(actor: AuthenticatedUser): Promise<NotificationDeleteReadResponse> {
    this.assertActor(actor);
    const result: [unknown[], number] = await this.dataSource.query(
      `
      UPDATE user_notification n SET deleted_at = CURRENT_TIMESTAMP
      WHERE n.recipient_user_id = $1 AND n.read_at IS NOT NULL AND n.deleted_at IS NULL
        AND ${scope} RETURNING n.id`,
      [actor.id],
    );
    return { deleted: result[1] };
  }

  async delete(actor: AuthenticatedUser, id: string): Promise<{ id: string }> {
    const notificationId = uuid(id);
    this.assertActor(actor);
    const [rows]: [Array<{ id: string }>, number] = await this.dataSource.query(
      `
      UPDATE user_notification n SET deleted_at = CURRENT_TIMESTAMP, read_at = COALESCE(n.read_at, CURRENT_TIMESTAMP)
      WHERE n.id = $1 AND n.recipient_user_id = $2 AND n.deleted_at IS NULL AND ${scope} RETURNING n.id`,
      [notificationId, actor.id],
    );
    if (!rows[0]) missing();
    return { id: rows[0].id };
  }
}
