import { createHash, randomUUID } from 'node:crypto';
import { workDateAt } from '../attendance/attendance-calculation.js';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import type {
  AttendanceNotificationEvent,
  SchedulingNotificationEvent,
  UserNotificationListResponse,
  UserNotificationResponse,
  NotificationDeleteReadResponse,
} from '@smartsite/contracts';
import { invalid, missing, page, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { UserNotificationEntity } from '../../../database/entities/user-notification.entity.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import { ShiftEntity } from '../../../database/entities/shift.entity.js';
import { SiteEntity } from '../../../database/entities/site.entity.js';
import { WorkerScheduleEntity } from '../../../database/entities/worker-schedule.entity.js';
import { ShiftChangeRequestEntity } from '../../../database/entities/shift-change-request.entity.js';
import { ShiftSwapRequestEntity } from '../../../database/entities/shift-swap-request.entity.js';
import { ShiftRequestStatus } from '../../../database/entities/enums.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';

// The same SQL policy gates list/count/read and event delivery. Tokens alone do not prove current scope.
export const schedulingScope = `
  EXISTS (SELECT 1 FROM app_user u WHERE u.id = n.recipient_user_id AND u.is_active = true)
  AND EXISTS (SELECT 1 FROM user_role_assignment r WHERE r.user_id = n.recipient_user_id
    AND r.site_id = n.site_id AND r.role = n.recipient_role)
  AND EXISTS (SELECT 1 FROM contractor c WHERE c.id = n.contractor_id AND c.is_active = true)
  AND EXISTS (SELECT 1 FROM contractor_site_participation p WHERE p.contractor_id = n.contractor_id
    AND p.site_id = n.site_id AND p.is_active = true AND p.valid_from <= CURRENT_TIMESTAMP
    AND (p.valid_until IS NULL OR p.valid_until > CURRENT_TIMESTAMP))
  AND ((n.recipient_role = 'WORKER' AND EXISTS (SELECT 1 FROM worker w WHERE w.id = n.worker_id
    AND w.user_id = n.recipient_user_id AND w.site_id = n.site_id
    AND w.contractor_id = n.contractor_id AND w.is_active = true))
    OR (n.recipient_role = 'CONTRACTOR_REPRESENTATIVE' AND EXISTS
      (SELECT 1 FROM contractor_representative_assignment a WHERE a.user_id = n.recipient_user_id
        AND a.site_id = n.site_id AND a.contractor_id = n.contractor_id)))`;

// Safety uses its own grants and current handover, without changing scheduling policy.
const safetyScope = `
  EXISTS (SELECT 1 FROM app_user u WHERE u.id=n.recipient_user_id AND u.is_active=true)
  AND EXISTS (SELECT 1 FROM user_role_assignment r WHERE r.user_id=n.recipient_user_id AND r.site_id=n.site_id AND r.role='CONTRACTOR_REPRESENTATIVE')
  AND EXISTS (SELECT 1 FROM contractor_representative_assignment g WHERE g.user_id=n.recipient_user_id AND g.contractor_id=n.contractor_id AND g.site_id=n.site_id)
  AND EXISTS (SELECT 1 FROM contractor c WHERE c.id=n.contractor_id AND c.is_active=true)
  AND EXISTS (SELECT 1 FROM contractor_site_participation p WHERE p.contractor_id=n.contractor_id AND p.site_id=n.site_id AND p.is_active=true AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP))
  AND EXISTS (SELECT 1 FROM incident i JOIN corrective_action a ON a.incident_id=i.id
    WHERE i.id=(n.content->>'incidentId')::uuid AND a.id=(n.content->>'actionId')::uuid
      AND i.site_id=n.site_id AND i.contractor_id=n.contractor_id AND a.assigned_to=n.recipient_user_id AND a.superseded_at IS NULL)`;
const checklistScope = `
 EXISTS (SELECT 1 FROM app_user u WHERE u.id=n.recipient_user_id AND u.is_active AND NOT u.must_change_password)
 AND EXISTS (SELECT 1 FROM user_role_assignment r WHERE r.user_id=n.recipient_user_id AND r.site_id=n.site_id AND r.role=n.recipient_role)
 AND EXISTS (SELECT 1 FROM safety_checklist_assignment a WHERE a.id=(n.content->>'checklistId')::uuid AND a.site_id=n.site_id AND a.contractor_id=n.contractor_id
  AND (n.recipient_role='SAFETY_OFFICER' OR (n.recipient_role='CONTRACTOR_REPRESENTATIVE' AND a.assigned_to=n.recipient_user_id
   AND EXISTS(SELECT 1 FROM contractor_representative_assignment g WHERE g.user_id=n.recipient_user_id AND g.contractor_id=n.contractor_id AND g.site_id=n.site_id)
   AND EXISTS(SELECT 1 FROM contractor c WHERE c.id=n.contractor_id AND c.is_active)
   AND EXISTS(SELECT 1 FROM contractor_site_participation p WHERE p.site_id=n.site_id AND p.contractor_id=n.contractor_id AND p.is_active AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP)))))`;

const scope = `((n.request_type IN ('CHANGE','SWAP','ATTENDANCE','SCHEDULE') AND (${schedulingScope}) AND NOT (n.request_type='ATTENDANCE' AND n.event='TIME_REQUESTED' AND n.recipient_role='WORKER')) OR (n.request_type='SAFETY' AND (${safetyScope})) OR (n.request_type='CHECKLIST' AND (${checklistScope})))`;
type SchedulingRequest = ShiftChangeRequestEntity | ShiftSwapRequestEntity;
type Recipient = Pick<
  UserNotificationEntity,
  'recipientUserId' | 'recipientRole' | 'workerId' | 'contractorId'
>;

@Injectable()
export class SchedulingNotificationService {
  private readonly logger = new Logger(SchedulingNotificationService.name);
  constructor(private readonly dataSource: DataSource) {}
  async recordScheduleChange(
    manager: EntityManager,
    input: {
      requestId: string;
      workers: WorkerEntity[];
      schedules: WorkerScheduleEntity[];
      shifts: ShiftEntity[];
      replacement: ShiftEntity | null;
      reason: string;
    },
  ): Promise<void> {
    for (const worker of input.workers) {
      if (!worker.userId || !worker.contractorId) continue;
      const rows = input.schedules.filter(
        (row) => row.workerId === worker.id && row.shiftId !== input.replacement?.id,
      );
      if (!rows.length) continue;
      const eligible: unknown[] = await manager.query(
        `SELECT 1 FROM (SELECT $1::uuid AS recipient_user_id,$2::uuid AS site_id,$3::uuid AS contractor_id,$4::uuid AS worker_id,'WORKER'::varchar AS recipient_role) n WHERE ${schedulingScope}`,
        [worker.userId, worker.siteId, worker.contractorId, worker.id],
      );
      if (!eligible.length) continue;
      const dates = [...new Set(rows.map((row) => row.workDate))].sort();
      const fromShiftName = [
        ...new Set(rows.map((row) => input.shifts.find((shift) => shift.id === row.shiftId)!.name)),
      ].join(', ');
      const site = await manager.getRepository(SiteEntity).findOneByOrFail({ id: worker.siteId });
      await manager.query(
        `INSERT INTO user_notification(id,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,request_id,event,content) VALUES($1,$2,$3,$4,$5,'WORKER','SCHEDULE',$6,$7,$8::jsonb) ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING`,
        [
          randomUUID(),
          worker.userId,
          worker.siteId,
          worker.contractorId,
          worker.id,
          input.requestId,
          input.replacement ? 'SCHEDULE_CHANGED' : 'SCHEDULE_CANCELLED',
          JSON.stringify({
            siteName: site.name,
            title: input.replacement ? 'Schedule changed' : 'Schedule cancelled',
            workDate: dates[0],
            fromShiftName,
            toShiftName: input.replacement?.name,
            message: `Your contractor ${input.replacement ? `changed ${fromShiftName} to ${input.replacement.name}` : `cancelled ${fromShiftName}`} for ${rows.length} schedule(s). Dates: ${dates.join(', ')}. Reason: ${input.reason}`,
          }),
        ],
      );
    }
  }
  async recordNoScheduleDenial(manager: EntityManager, worker: WorkerEntity, at = new Date()) {
    const workDate = workDateAt(at, 'Asia/Ho_Chi_Minh');
    // One durable warning per Worker/Site/day across Face, QR and manual retries.
    const digest = createHash('sha256')
      .update(`no-schedule:${worker.siteId}:${worker.id}:${workDate}`)
      .digest('hex');
    const id = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
    await this.recordAttendance(manager, {
      worker,
      id,
      event: 'ENTRY_DENIED_NO_SCHEDULE',
      representatives: false,
      workDate,
      message: `You are not scheduled for a shift on ${workDate} at this site and entry is not permitted. Please contact your contractor representative.`,
    });
  }
  async recordAttendance(
    manager: EntityManager,
    input: {
      worker: WorkerEntity;
      id: string;
      event: AttendanceNotificationEvent;
      message: string;
      representatives: boolean;
      workDate: string;
      dayId?: string;
    },
  ) {
    const worker = input.worker;
    if (!worker.contractorId) return;
    const recipients: Recipient[] = [];
    if (worker.userId && input.event !== 'TIME_REQUESTED')
      recipients.push({
        recipientUserId: worker.userId,
        recipientRole: 'WORKER',
        workerId: worker.id,
        contractorId: worker.contractorId,
      });
    if (input.representatives) {
      const representatives: Array<{ user_id: string }> = await manager.query(
        'SELECT user_id FROM contractor_representative_assignment WHERE site_id=$1 AND contractor_id=$2',
        [worker.siteId, worker.contractorId],
      );
      recipients.push(
        ...representatives.map((r) => ({
          recipientUserId: r.user_id,
          recipientRole: 'CONTRACTOR_REPRESENTATIVE' as const,
          workerId: null,
          contractorId: worker.contractorId!,
        })),
      );
      if (!representatives.length)
        this.logger.warn({
          action: 'attendance.notification.no_representative',
          siteId: worker.siteId,
          workerId: worker.id,
        });
    }
    const site = await manager.getRepository(SiteEntity).findOneByOrFail({ id: worker.siteId });
    const seen = new Set<string>();
    for (const r of recipients) {
      if (seen.has(r.recipientUserId)) continue;
      const eligible: unknown[] = await manager.query(
        `SELECT 1 FROM (SELECT $1::uuid AS recipient_user_id,$2::uuid AS site_id,$3::uuid AS contractor_id,$4::uuid AS worker_id,$5::varchar AS recipient_role) n WHERE ${schedulingScope}`,
        [r.recipientUserId, worker.siteId, r.contractorId, r.workerId, r.recipientRole],
      );
      if (!eligible.length) continue;
      seen.add(r.recipientUserId);
      await manager.query(
        `INSERT INTO user_notification(id,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,request_id,event,content) VALUES($1,$2,$3,$4,$5,$6,'ATTENDANCE',$7,$8,$9::jsonb) ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING`,
        [
          randomUUID(),
          r.recipientUserId,
          worker.siteId,
          r.contractorId,
          r.workerId,
          r.recipientRole,
          input.id,
          input.event,
          JSON.stringify({
            siteName: site.name,
            title: input.event.replaceAll('_', ' '),
            message: input.message,
            workDate: input.workDate,
            ...(input.event === 'ENTRY_DENIED_NO_SCHEDULE'
              ? {}
              : { dayId: input.dayId ?? input.id }),
          }),
        ],
      );
    }
  }

  private assertActor(actor: AuthenticatedUser) {
    if (!actor.isActive || actor.mustChangePassword) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Notifications are unavailable for this account',
      });
    }
  }

  async record(
    manager: EntityManager,
    requestType: 'CHANGE' | 'SWAP',
    request: SchedulingRequest,
    event: SchedulingNotificationEvent,
    actorId: string | null,
    reviewOnly = false,
  ): Promise<void> {
    const change = requestType === 'CHANGE' ? (request as ShiftChangeRequestEntity) : null;
    const swap = requestType === 'SWAP' ? (request as ShiftSwapRequestEntity) : null;
    const requesterId = change?.workerId ?? swap!.requesterWorkerId;
    const requester = await manager
      .getRepository(WorkerEntity)
      .findOneBy({ id: requesterId, siteId: request.siteId });
    if (!requester?.contractorId) return;
    const coworker = swap
      ? await manager
          .getRepository(WorkerEntity)
          .findOneBy({ id: swap.coworkerWorkerId, siteId: request.siteId })
      : null;
    const site = await manager.getRepository(SiteEntity).findOneByOrFail({ id: request.siteId });
    const schedule = await manager
      .getRepository(WorkerScheduleEntity)
      .findOneByOrFail({ id: change?.workerScheduleId ?? swap!.requesterWorkerScheduleId });
    const from = await manager.getRepository(ShiftEntity).findOneByOrFail({
      id: change?.fromShiftId ?? swap!.requesterShiftId,
      siteId: request.siteId,
    });
    const to = await manager
      .getRepository(ShiftEntity)
      .findOneByOrFail({ id: change?.toShiftId ?? swap!.coworkerShiftId, siteId: request.siteId });
    const workers: WorkerEntity[] = [];
    const needsReview =
      event === 'CHANGE_REQUESTED' || event === 'SWAP_CONFIRMED' || event === 'REQUEST_CONFLICTED';
    if (!reviewOnly) {
      if (event === 'SWAP_REQUESTED') {
        if (coworker) workers.push(coworker);
      } else if (event !== 'CHANGE_REQUESTED') {
        workers.push(requester);
        if (coworker && event !== 'SWAP_CONFIRMED' && event !== 'SWAP_DECLINED')
          workers.push(coworker);
      }
    }
    const recipients: Recipient[] = workers.flatMap((w) =>
      w.userId && w.contractorId === requester.contractorId
        ? [
            {
              recipientUserId: w.userId,
              recipientRole: 'WORKER' as const,
              workerId: w.id,
              contractorId: requester.contractorId!,
            },
          ]
        : [],
    );
    if (needsReview) {
      const representatives: Array<{ user_id: string }> = await manager.query(
        'SELECT user_id FROM contractor_representative_assignment WHERE site_id = $1 AND contractor_id = $2',
        [request.siteId, requester.contractorId],
      );
      recipients.push(
        ...representatives
          .filter((r) => r.user_id !== request.requestedByUserId)
          .map((r) => ({
            recipientUserId: r.user_id,
            recipientRole: 'CONTRACTOR_REPRESENTATIVE' as const,
            workerId: null,
            contractorId: requester.contractorId!,
          })),
      );
    }
    const titles: Record<SchedulingNotificationEvent, string> = {
      CHANGE_REQUESTED: 'Shift change awaiting review',
      SWAP_REQUESTED: 'Coworker shift swap request',
      SWAP_CONFIRMED: 'Shift swap confirmed',
      SWAP_DECLINED: 'Coworker declined the swap',
      REQUEST_APPLIED: 'Shift request approved',
      REQUEST_REJECTED: 'Contractor rejected the request',
      REQUEST_CONFLICTED: 'Shift request could not be applied',
    };
    const messages: Record<SchedulingNotificationEvent, string> = {
      CHANGE_REQUESTED: `${requester.displayName} requested a change from ${from.name} to ${to.name}.`,
      SWAP_REQUESTED: `${requester.displayName} wants to swap ${from.name} with your ${to.name} shift.`,
      SWAP_CONFIRMED: `${coworker?.displayName ?? 'Your coworker'} confirmed the swap. Contractor review is required.`,
      SWAP_DECLINED: `${coworker?.displayName ?? 'Your coworker'} declined the swap.`,
      REQUEST_APPLIED: `The contractor approved the ${requestType === 'SWAP' ? 'swap' : 'shift change'}. The schedule has been updated.`,
      REQUEST_REJECTED: 'The contractor rejected the shift request.',
      REQUEST_CONFLICTED:
        'The schedule changed before approval. Review the current schedule and submit a new request if needed.',
    };
    // Worker recipients take precedence when a user has both roles: one record per event/account.
    const seen = new Set<string>();
    for (const recipient of recipients) {
      if (recipient.recipientUserId === actorId || seen.has(recipient.recipientUserId)) continue;
      const candidate = { ...recipient, siteId: request.siteId };
      const eligible: unknown[] = await manager.query(
        `SELECT 1 FROM (
        SELECT $1::uuid AS recipient_user_id, $2::uuid AS site_id, $3::uuid AS contractor_id,
        $4::uuid AS worker_id, $5::varchar AS recipient_role) n WHERE ${schedulingScope}`,
        [
          candidate.recipientUserId,
          candidate.siteId,
          candidate.contractorId,
          candidate.workerId,
          candidate.recipientRole,
        ],
      );
      if (!eligible.length) continue;
      seen.add(recipient.recipientUserId);
      const reason =
        request.reviewReason && (event === 'SWAP_DECLINED' || event === 'REQUEST_REJECTED')
          ? ` Reason: ${request.reviewReason}`
          : '';
      const coworkerPerspective = swap && candidate.workerId === swap.coworkerWorkerId;
      const content = {
        siteName: site.name,
        title: titles[event],
        message: messages[event] + reason,
        workDate: schedule.workDate,
        fromShiftName: coworkerPerspective ? to.name : from.name,
        toShiftName: coworkerPerspective ? from.name : to.name,
      };
      await manager.query(
        `INSERT INTO user_notification
        (id, recipient_user_id, site_id, contractor_id, worker_id, recipient_role, request_type, request_id, event, content)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING`,
        [
          randomUUID(),
          candidate.recipientUserId,
          candidate.siteId,
          candidate.contractorId,
          candidate.workerId,
          candidate.recipientRole,
          requestType,
          request.id,
          event,
          JSON.stringify(content),
        ],
      );
    }
    this.logger.log({
      action: 'scheduling.notification.record',
      requestId: request.id,
      siteId: request.siteId,
      event,
    });
  }

  /** The workflow validates the recipient under lock; delivery is part of the same transaction. */
  async recordSafetyHandover(
    manager: EntityManager,
    input: {
      commandId: string;
      siteId: string;
      contractorId: string;
      incidentId: string;
      actionId: string;
      recipientId: string;
      title: string;
    },
  ): Promise<void> {
    const site = await manager.getRepository(SiteEntity).findOneByOrFail({ id: input.siteId });
    const content = {
      siteName: site.name,
      title: 'Safety case handed over',
      message: input.title,
      incidentId: input.incidentId,
      actionId: input.actionId,
    };
    // SAFETY request_id is the handover command, so repeated transfers can notify again without replay duplicates.
    await manager.query(
      `INSERT INTO user_notification
      (id,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,request_id,event,content)
      VALUES($1,$2,$3,$4,NULL,'CONTRACTOR_REPRESENTATIVE','SAFETY',$5,'SAFETY_HANDOVER',$6::jsonb)
      ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING`,
      [
        randomUUID(),
        input.recipientId,
        input.siteId,
        input.contractorId,
        input.commandId,
        JSON.stringify(content),
      ],
    );
  }
  async recordChecklist(
    manager: EntityManager,
    input: {
      commandId: string;
      assignment: {
        id: string;
        siteId: string;
        contractorId: string;
        assignedTo: string;
        description: string;
      };
      event: import('@smartsite/contracts').ChecklistNotificationEvent;
    },
  ): Promise<void> {
    const a = input.assignment;
    const recipients =
      input.event === 'CHECKLIST_SUBMITTED'
        ? ((await manager.query(
            "SELECT DISTINCT u.id FROM app_user u JOIN user_role_assignment r ON r.user_id=u.id WHERE r.site_id=$1 AND r.role='SAFETY_OFFICER' AND u.is_active AND NOT u.must_change_password AND u.id<>$2 ORDER BY u.id",
            [a.siteId, a.assignedTo],
          )) as { id: string }[])
        : [{ id: a.assignedTo }];
    const site = await manager.getRepository(SiteEntity).findOneByOrFail({ id: a.siteId });
    const titles = {
      CHECKLIST_ASSIGNED: 'Safety checklist assigned',
      CHECKLIST_SUBMITTED: 'Checklist ready to record',
      CHECKLIST_RETURNED: 'Checklist update requested',
      CHECKLIST_RECORDED: 'Checklist report recorded',
    };
    for (const recipient of recipients)
      await manager.query(
        `INSERT INTO user_notification(id,recipient_user_id,site_id,contractor_id,worker_id,recipient_role,request_type,request_id,event,content)
      VALUES($1,$2,$3,$4,NULL,$5,'CHECKLIST',$6,$7,$8::jsonb) ON CONFLICT ON CONSTRAINT uq_notification_event_recipient DO NOTHING`,
        [
          randomUUID(),
          recipient.id,
          a.siteId,
          a.contractorId,
          input.event === 'CHECKLIST_SUBMITTED' ? 'SAFETY_OFFICER' : 'CONTRACTOR_REPRESENTATIVE',
          input.commandId,
          input.event,
          JSON.stringify({
            siteName: site.name,
            title: titles[input.event],
            message: a.description,
            checklistId: a.id,
          }),
        ],
      );
  }

  private response(n: UserNotificationEntity): UserNotificationResponse {
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
        target:
          n.event === 'ENTRY_DENIED_NO_SCHEDULE'
            ? { siteId: n.siteId, workDate: n.content.workDate ?? '', tab: 'schedule' }
            : { siteId: n.siteId, dayId: n.content.dayId ?? n.requestId, tab: 'attendance' },
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
    const review = n.recipientRole === 'CONTRACTOR_REPRESENTATIVE';
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
      return { items: items.map((n) => this.response(n)), total, unreadCount };
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

  async backfillPending(): Promise<number> {
    let processed = 0;
    for (const [type, entity] of [
      ['CHANGE', ShiftChangeRequestEntity],
      ['SWAP', ShiftSwapRequestEntity],
    ] as const) {
      let lastId: string | null = null;
      // Bounded batches and short per-request transactions; no production data is printed.
      while (true) {
        const query = this.dataSource
          .getRepository(entity)
          .createQueryBuilder('r')
          .where('r.status IN (:...statuses)', {
            statuses: [ShiftRequestStatus.PENDING_COWORKER, ShiftRequestStatus.PENDING_MANAGER],
          })
          .orderBy('r.id', 'ASC')
          .take(100);
        if (lastId) query.andWhere('r.id > :lastId', { lastId });
        const batch = await query.getMany();
        if (!batch.length) break;
        for (const item of batch) {
          await this.dataSource.transaction(async (manager) => {
            const r = await manager
              .getRepository(entity)
              .createQueryBuilder('r')
              .setLock('pessimistic_write')
              .where('r.id = :id', { id: item.id })
              .getOne();
            if (
              !r ||
              (r.status !== ShiftRequestStatus.PENDING_MANAGER &&
                r.status !== ShiftRequestStatus.PENDING_COWORKER)
            )
              return;
            if (type === 'CHANGE' && r.status !== ShiftRequestStatus.PENDING_MANAGER) return;
            const event =
              type === 'CHANGE'
                ? 'CHANGE_REQUESTED'
                : r.status === ShiftRequestStatus.PENDING_COWORKER
                  ? 'SWAP_REQUESTED'
                  : 'SWAP_CONFIRMED';
            await this.record(
              manager,
              type,
              r,
              event,
              null,
              r.status === ShiftRequestStatus.PENDING_MANAGER,
            );
            processed++;
          });
        }
        lastId = batch[batch.length - 1]!.id;
      }
    }
    return processed;
  }
}
