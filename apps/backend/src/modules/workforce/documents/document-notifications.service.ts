import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager } from 'typeorm';
import type { WorkerDocumentNotificationEvent } from '@smartsite/contracts';
import type { BackendEnvironment } from '../../../config/environment.js';
import { WorkerDocumentEntity } from '../../../database/entities/worker-document.entity.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import { UserNotificationEntity } from '../../../database/entities/user-notification.entity.js';
import { SiteEntity } from '../../../database/entities/site.entity.js';
import { complianceDate } from './worker-compliance.js';

const labels = {
  SAFETY_CARD: 'Thẻ an toàn lao động nhóm 3',
  HEALTH_CERTIFICATE: 'Giấy khám sức khỏe',
  PERSONAL_INSURANCE: 'Bảo hiểm cá nhân',
} as const;
@Injectable()
export class DocumentNotificationsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(DocumentNotificationsService.name);
  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}
  get noticeDays() {
    return this.config.get('WORKER_DOCUMENT_NOTICE_DAYS', { infer: true });
  }
  onModuleInit() {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    const run = () => {
      if (this.running) return;
      this.running = true;
      void this.sweep()
        .catch(() => this.logger.error({ event: 'document_expiry_check_failed' }))
        .finally(() => {
          this.running = false;
        });
    };
    this.timer = setInterval(run, 3600000);
    this.timer.unref();
    run();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async record(
    manager: EntityManager,
    worker: WorkerEntity,
    doc: WorkerDocumentEntity,
    event: WorkerDocumentNotificationEvent,
  ) {
    if (!worker.contractorId) return;
    const site = await manager.getRepository(SiteEntity).findOneByOrFail({ id: worker.siteId });
    const recipients = await manager.query<
      { id: string; role: 'WORKER' | 'CONTRACTOR_REPRESENTATIVE' | 'SAFETY_OFFICER' }[]
    >(
      `SELECT DISTINCT u.id,r.role FROM app_user u JOIN user_role_assignment r ON r.user_id=u.id AND r.site_id=$1
      WHERE u.is_active AND ((r.role='SAFETY_OFFICER' AND $4 IN ('DOCUMENT_SUBMITTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED'))
      OR (r.role='WORKER' AND u.id=$2 AND $4<>'DOCUMENT_SUBMITTED')
      OR (r.role='CONTRACTOR_REPRESENTATIVE' AND $4<>'DOCUMENT_SUBMITTED' AND EXISTS(SELECT 1 FROM contractor_representative_grant g WHERE g.user_id=u.id AND g.contractor_id=$3)))`,
      [worker.siteId, worker.userId, worker.contractorId, event],
    );
    const title =
      event === 'DOCUMENT_SUBMITTED'
        ? 'Hồ sơ công nhân chờ duyệt'
        : event === 'DOCUMENT_APPROVED'
          ? 'Giấy tờ công nhân đã duyệt'
          : event === 'DOCUMENT_REJECTED'
            ? 'Giấy tờ cần bổ sung'
            : event === 'DOCUMENT_EXPIRING'
              ? 'Giấy tờ sắp hết hạn'
              : 'Giấy tờ đã hết hạn';
    const suffix =
      event === 'DOCUMENT_SUBMITTED'
        ? 'Cần Cán bộ an toàn xem bản gốc và duyệt.'
        : event === 'DOCUMENT_APPROVED'
          ? 'Hạn mới chỉ được áp dụng sau lần duyệt này; công nhân cần đủ cả ba giấy tờ hợp lệ.'
          : event === 'DOCUMENT_REJECTED'
            ? `Cần nộp lại: ${doc.reviewNote ?? ''}`
            : `${event === 'DOCUMENT_EXPIRING' ? 'Sắp hết hạn' : 'Đã hết hạn'} ngày ${doc.expiresOn}. Cần nộp bản mới và được duyệt lại để gia hạn.`;
    for (const recipient of recipients)
      await manager
        .getRepository(UserNotificationEntity)
        .createQueryBuilder()
        .insert()
        .values({
          id: randomUUID(),
          recipientUserId: recipient.id,
          recipientRole: recipient.role,
          workerId: recipient.role === 'WORKER' ? worker.id : null,
          siteId: worker.siteId,
          contractorId: worker.contractorId,
          requestType: 'DOCUMENT',
          requestId: doc.id,
          event,
          content: {
            siteName: site.name,
            title,
            message: `${worker.displayName} (${worker.externalId}) — ${labels[doc.kind]}. ${suffix}`,
            documentWorkerId: worker.id,
          },
          readAt: null,
          deletedAt: null,
        })
        .orIgnore()
        .execute();
  }
  async sweep(at = new Date()) {
    const today = complianceDate(at);
    const days = this.config.get('WORKER_DOCUMENT_NOTICE_DAYS', { infer: true });
    const notice = complianceDate(new Date(at.getTime() + days * 86400000));
    let cursor = '';
    for (;;) {
      const batch = await this.source
        .getRepository(WorkerDocumentEntity)
        .createQueryBuilder('d')
        .where("d.status='APPROVED' AND d.expires_on<=:notice AND d.id>:cursor", {
          notice,
          cursor: cursor || '00000000-0000-0000-0000-000000000000',
        })
        .orderBy('d.id', 'ASC')
        .take(100)
        .getMany();
      if (!batch.length) return;
      for (const candidate of batch)
        await this.source.transaction(async (manager) => {
          const worker = await manager
            .getRepository(WorkerEntity)
            .findOne({ where: { id: candidate.workerId }, lock: { mode: 'pessimistic_write' } });
          if (!worker) return;
          const doc = await manager
            .getRepository(WorkerDocumentEntity)
            .findOneBy({ id: candidate.id, status: 'APPROVED' });
          if (doc?.expiresOn && doc.expiresOn <= notice)
            await this.record(
              manager,
              worker,
              doc,
              doc.expiresOn < today ? 'DOCUMENT_EXPIRED' : 'DOCUMENT_EXPIRING',
            );
        });
      cursor = batch[batch.length - 1]!.id;
    }
  }
}
