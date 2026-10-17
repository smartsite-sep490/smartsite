import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import QRCode from 'qrcode';
import type { BackendEnvironment } from '../../../config/environment.js';
import { VisitorVisitEntity } from '../../../database/entities/qr-access.entity.js';
import { decryptVisitorCode } from './visitor-code.js';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function visitorEmailContent(
  visit: Pick<
    VisitorVisitEntity,
    'language' | 'visitorName' | 'groupSize' | 'validFrom' | 'validUntil' | 'targetArea'
  > &
    Partial<Pick<VisitorVisitEntity, 'status' | 'reviewNote'>>,
  code?: string,
) {
  const vi = visit.language === 'vi';
  const schedule = `${visit.validFrom.toLocaleString(vi ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })} – ${visit.validUntil.toLocaleString(vi ? 'vi-VN' : 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })} (UTC+7)`;
  let subject = vi
    ? 'SmartSite — QR khách đã được phê duyệt'
    : 'SmartSite — Your visitor QR is approved';
  let text = vi
    ? `Chào ${visit.visitorName},\nYêu cầu cho ${visit.groupSize} khách đã được duyệt.\nMã đặt chỗ: ${code}\nKhu vực: ${visit.targetArea}\nLịch vào công trường: ${schedule}\nMã QR đính kèm không tự hết hạn. Quyền vào vẫn theo lịch được duyệt và trạng thái chuyến thăm. Xuất trình QR hoặc mã đặt chỗ cho bảo vệ. Giữ riêng mã này.`
    : `Hello ${visit.visitorName},\nYour visit for ${visit.groupSize} visitors is approved.\nBooking code: ${code}\nArea: ${visit.targetArea}\nVisit schedule: ${schedule}\nThe attached QR does not expire automatically. Entry still requires the approved schedule and visit status. Show the QR or booking code to security. Keep this code private.`;
  if (visit.status === 'REJECTED' || visit.status === 'CANCELLED') {
    const cancelled = visit.status === 'CANCELLED';
    subject = vi
      ? `SmartSite — Chuyến thăm đã bị ${cancelled ? 'hủy' : 'từ chối'}`
      : `SmartSite — Your visit has been ${cancelled ? 'cancelled' : 'rejected'}`;
    text = vi
      ? `Chào ${visit.visitorName},\nYêu cầu cho ${visit.groupSize} khách đã bị ${cancelled ? 'hủy' : 'từ chối'}.\nKhu vực: ${visit.targetArea}\nLịch viếng thăm đã đăng ký: ${schedule}`
      : `Hello ${visit.visitorName},\nYour visit for ${visit.groupSize} visitors has been ${cancelled ? 'cancelled' : 'rejected'}.\nArea: ${visit.targetArea}\nRequested visit schedule: ${schedule}`;
    if (visit.reviewNote) text += `\n${vi ? 'Lý do' : 'Reason'}: ${visit.reviewNote}`;
    text += vi
      ? '\nChuyến thăm này không còn quyền vào công trường. Mã QR hoặc mã đặt chỗ đã cấp trước đó (nếu có) không còn hợp lệ. Vui lòng liên hệ người tiếp đón nếu cần hỗ trợ.'
      : '\nThis visit does not grant site entry. Any previously issued QR or booking code is no longer valid. Please contact your host if you need assistance.';
  }
  return {
    subject,
    text,
    html: `<div lang="${vi ? 'vi' : 'en'}"><h1>${escapeHtml(subject)}</h1><p>${escapeHtml(text).replaceAll('\n', '<br>')}</p></div>`,
  };
}

@Injectable()
export class VisitorEmailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(VisitorEmailService.name);
  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}
  private configured() {
    return (
      !!this.config.get('RESEND_API_KEY', { infer: true }) &&
      !!this.config.get('RESEND_FROM_EMAIL', { infer: true })
    );
  }
  onApplicationBootstrap() {
    if (!this.configured() || this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => {
      void this.flush();
    }, 30_000);
    this.timer.unref();
    void this.flush();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
  private async flush() {
    if (this.running) return;
    this.running = true;
    try {
      const rows = await this.source.query<{ id: string }[]>(`SELECT id FROM visitor_visit
        WHERE status IN ('APPROVED','REJECTED','CANCELLED') AND email IS NOT NULL AND email_attempts < 5
        AND (email_status='PENDING' OR (email_status='SENDING' AND email_attempted_at < now()-interval '5 minutes'))
        AND (email_next_attempt_at IS NULL OR email_next_attempt_at <= now()) ORDER BY created_at LIMIT 10`);
      for (const row of rows) await this.deliver(row.id);
    } catch {
      this.logger.warn('Visitor email queue temporarily unavailable');
    } finally {
      this.running = false;
    }
  }
  async deliver(visitId: string): Promise<void> {
    if (!this.configured()) return;
    // Claim a durable lease, then release the DB connection before calling Resend.
    const rows = await this.source.query<{ id: string; status: string; attemptedAt: string }[]>(
      `WITH claimed AS (UPDATE visitor_visit SET email_status='SENDING',
      email_attempts=email_attempts+1, email_attempted_at=now()
      WHERE id=$1 AND status IN ('APPROVED','REJECTED','CANCELLED') AND email IS NOT NULL
      AND (status<>'APPROVED' OR booking_code_ciphertext IS NOT NULL)
      AND email_attempts < 5 AND (email_next_attempt_at IS NULL OR email_next_attempt_at<=now())
      AND (email_status='PENDING' OR (email_status='SENDING' AND email_attempted_at<now()-interval '5 minutes'))
      RETURNING id, status, email_attempted_at::text AS "attemptedAt") SELECT * FROM claimed`,
      [visitId],
    );
    if (!rows.length) return;
    const claim = rows[0]!;
    try {
      const visit = await this.source
        .getRepository(VisitorVisitEntity)
        .createQueryBuilder('v')
        .addSelect('v.bookingCodeCiphertext')
        .where('v.id=:visitId', { visitId })
        .andWhere('v.status=:status AND v.email_attempted_at=:attemptedAt', claim)
        .getOneOrFail();
      const code =
        visit.status === 'APPROVED'
          ? decryptVisitorCode(
              visit.bookingCodeCiphertext!,
              this.config.getOrThrow('AUTH_JWT_SECRET', { infer: true }),
            )
          : undefined;
      const content = visitorEmailContent(visit, code);
      const attachments = code
        ? [
            {
              filename: 'smartsite-visitor-qr.png',
              content: (
                await QRCode.toBuffer(code, { type: 'png', width: 360, margin: 3 })
              ).toString('base64'),
            },
          ]
        : undefined;
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow('RESEND_API_KEY', { infer: true })}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `visitor-${visit.status.toLowerCase()}/${visit.id}`,
        },
        body: JSON.stringify({
          from: `SmartSite <${this.config.getOrThrow('RESEND_FROM_EMAIL', { infer: true })}>`,
          to: [visit.email],
          ...content,
          attachments,
        }),
      });
      if (!response.ok) throw new Error('Email provider rejected the request');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string')
        throw new Error('Invalid email acknowledgement');
      await this.source.query(
        `UPDATE visitor_visit SET email_status='SENT', email_sent_at=now(), email_next_attempt_at=NULL
         WHERE id=$1 AND status=$2 AND email_attempted_at=$3 AND email_status='SENDING'`,
        [visitId, claim.status, claim.attemptedAt],
      );
    } catch {
      // Do not log addresses, booking codes, API keys, or provider error bodies.
      await this.source.query(
        `UPDATE visitor_visit SET email_status=CASE WHEN email_attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,
        email_next_attempt_at=now()+interval '1 minute'*power(2,least(email_attempts,5))
        WHERE id=$1 AND status=$2 AND email_attempted_at=$3 AND email_status='SENDING'`,
        [visitId, claim.status, claim.attemptedAt],
      );
      this.logger.warn({ visitId }, 'Visitor email delivery will be retried');
    }
  }
}
