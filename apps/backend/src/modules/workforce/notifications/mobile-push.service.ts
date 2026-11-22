import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';
import type { RegisterMobilePushCommand, MobilePushSettingsResponse } from '@smartsite/contracts';
import {
  AuthClientType,
  AuthSessionEntity,
} from '../../../database/entities/auth-session.entity.js';
import type { AuthenticatedUser } from '../../auth/auth.service.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { uuid, knownUnique } from '../../../common/configuration/commands.js';
import { openJson, sealJson } from '../../../common/secure-envelope.js';
import { notificationVisibilityScope } from './scheduling-notification.service.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const pushInstallationHash = (id: string, secret: string) =>
  hash(`mobile-push-installation-v1:${id}:${secret}`);
export function pushInstallationMatches(id: string, secret: string, expected: string) {
  return (
    /^[a-f0-9]{64}$/.test(expected) &&
    timingSafeEqual(
      Buffer.from(pushInstallationHash(id, secret), 'hex'),
      Buffer.from(expected, 'hex'),
    )
  );
}
const denied = () =>
  new PublicHttpException(403, {
    code: 'FORBIDDEN',
    message: 'Push device is outside your session',
  });
type Delivery = {
  device_id: string;
  notification_id: string;
  attempts: number;
  token_hash: string;
  token_ciphertext: string;
  language: string;
};

@Injectable()
export class MobilePushService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(MobilePushService.name);
  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}
  private enabled() {
    return this.config.get('EXPO_PUSH_ENABLED', { infer: true });
  }
  private secret() {
    return this.config.getOrThrow('AUTH_JWT_SECRET', { infer: true });
  }
  async settings(actor: AuthenticatedUser): Promise<MobilePushSettingsResponse> {
    const devices = await this.source.query<MobilePushSettingsResponse['devices']>(
      `SELECT d.id,d.platform,(d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.expires_at>now() AND s.client_type='MOBILE') AS active FROM mobile_push_device d JOIN auth_session s ON s.id=d.session_id AND s.user_id=d.user_id WHERE d.user_id=$1 ORDER BY d.updated_at DESC LIMIT 50`,
      [actor.id],
    );
    return { enabled: this.enabled(), devices };
  }
  async register(
    actor: AuthenticatedUser,
    sessionId: string | undefined,
    idValue: string,
    input: RegisterMobilePushCommand,
  ) {
    if (!this.enabled())
      throw new PublicHttpException(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Remote push is not configured',
      });
    if (!sessionId) throw denied();
    const id = uuid(idValue),
      tokenHash = hash(input.expoPushToken);
    try {
      await this.source.transaction(async (manager) => {
        const session = await manager
          .getRepository(AuthSessionEntity)
          .findOneBy({ id: sessionId, userId: actor.id, clientType: AuthClientType.MOBILE });
        if (!session || session.revokedAt || session.expiresAt <= new Date()) throw denied();
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`mobile-push:${id}`]);
        const [existing] = await manager.query<
          {
            user_id: string;
            session_id: string;
            installation_secret_hash: string;
            token_hash: string;
          }[]
        >(
          `SELECT user_id,session_id,installation_secret_hash,token_hash FROM mobile_push_device WHERE id=$1 FOR UPDATE`,
          [id],
        );
        if (
          existing &&
          !pushInstallationMatches(id, input.installationSecret, existing.installation_secret_hash)
        )
          throw denied();
        const changed =
          !existing ||
          existing.user_id !== actor.id ||
          existing.session_id !== sessionId ||
          existing.token_hash !== tokenHash;
        if (existing && changed)
          await manager.query(
            `UPDATE mobile_push_delivery SET status='CANCELLED' WHERE device_id=$1 AND status IN ('PENDING','SENDING','ACCEPTED')`,
            [id],
          );
        await manager.query(
          `INSERT INTO mobile_push_device(id,user_id,session_id,installation_secret_hash,token_hash,token_ciphertext,platform,language)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET user_id=$2,session_id=$3,token_hash=$5,token_ciphertext=$6,platform=$7,language=$8,revoked_at=NULL,updated_at=now(),registered_at=CASE WHEN $9 THEN now() ELSE mobile_push_device.registered_at END`,
          [
            id,
            actor.id,
            sessionId,
            pushInstallationHash(id, input.installationSecret),
            tokenHash,
            sealJson(input.expoPushToken, this.secret(), 'mobile-push-token-v1'),
            input.platform,
            input.language,
            changed,
          ],
        );
      });
    } catch (error) {
      knownUnique(error, ['uq_mobile_push_token']);
    }
    return { id };
  }
  async remove(actor: AuthenticatedUser, idValue: string, secret: string) {
    const id = uuid(idValue);
    await this.source.transaction(async (manager) => {
      const [device] = await manager.query<{ installation_secret_hash: string }[]>(
        `SELECT installation_secret_hash FROM mobile_push_device WHERE id=$1 AND user_id=$2 FOR UPDATE`,
        [id, actor.id],
      );
      if (!device || !pushInstallationMatches(id, secret, device.installation_secret_hash))
        throw denied();
      await manager.query(
        `UPDATE mobile_push_device SET revoked_at=now() WHERE id=$1 AND user_id=$2`,
        [id, actor.id],
      );
      await manager.query(
        `UPDATE mobile_push_delivery SET status='CANCELLED' WHERE device_id=$1 AND status IN ('PENDING','SENDING','ACCEPTED')`,
        [id],
      );
    });
    return { id };
  }
  onApplicationBootstrap() {
    if (!this.enabled() || this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    this.timer = setInterval(() => void this.flush(), 30000);
    this.timer.unref();
    void this.flush();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
  private headers() {
    const accessToken = this.config.get('EXPO_ACCESS_TOKEN', { infer: true });
    return {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };
  }
  private async post(endpoint: 'send' | 'getReceipts', body: unknown): Promise<unknown> {
    const response = await fetch(`https://exp.host/--/api/v2/push/${endpoint}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Push provider unavailable');
    return response.json();
  }
  private async revoke(deviceId: string, tokenHash: string) {
    await this.source.query(
      `UPDATE mobile_push_device SET revoked_at=now() WHERE id=$1 AND token_hash=$2`,
      [deviceId, tokenHash],
    );
  }
  private async finish(
    row: Pick<Delivery, 'device_id' | 'notification_id' | 'attempts'>,
    status: string,
    ticketId: string | null = null,
  ) {
    await this.source.query(
      `UPDATE mobile_push_delivery SET status=$4,ticket_id=$5,next_attempt_at=now()+interval '15 minutes' WHERE device_id=$1 AND notification_id=$2 AND attempts=$3 AND status='SENDING'`,
      [row.device_id, row.notification_id, row.attempts, status, ticketId],
    );
  }
  async flush() {
    if (this.running || !this.enabled()) return;
    this.running = true;
    try {
      await this.source.query(`INSERT INTO mobile_push_delivery(device_id,notification_id)
        SELECT d.id,n.id FROM mobile_push_device d JOIN auth_session s ON s.id=d.session_id AND s.user_id=d.user_id
        JOIN user_notification n ON n.recipient_user_id=d.user_id
        LEFT JOIN mobile_push_delivery sent ON sent.device_id=d.id AND sent.notification_id=n.id
        WHERE d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.expires_at>now() AND s.client_type='MOBILE'
          AND n.deleted_at IS NULL AND n.read_at IS NULL AND n.created_at>=d.registered_at AND sent.device_id IS NULL
          AND n.recipient_role IN ('WORKER','CONTRACTOR_REPRESENTATIVE') AND (${notificationVisibilityScope})
        ORDER BY n.created_at,n.id,d.id LIMIT 100 ON CONFLICT DO NOTHING`);
      const claimed = await this.source.query<
        Pick<Delivery, 'device_id' | 'notification_id' | 'attempts'>[]
      >(`WITH claimed AS (
        UPDATE mobile_push_delivery p SET status='SENDING',attempts=p.attempts+1,attempted_at=now()
        WHERE (p.device_id,p.notification_id) IN (SELECT device_id,notification_id FROM mobile_push_delivery WHERE attempts<5 AND next_attempt_at<=now() AND (status='PENDING' OR (status='SENDING' AND attempted_at<now()-interval '5 minutes')) ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING p.device_id,p.notification_id,p.attempts
      ) SELECT * FROM claimed`);
      const eligible: Delivery[] = [];
      for (const row of claimed) {
        const [device] = await this.source.query<
          Pick<Delivery, 'token_hash' | 'token_ciphertext' | 'language'>[]
        >(
          `SELECT d.token_hash,d.token_ciphertext,d.language FROM mobile_push_device d JOIN auth_session s ON s.id=d.session_id AND s.user_id=d.user_id JOIN user_notification n ON n.recipient_user_id=d.user_id
          WHERE d.id=$1 AND n.id=$2 AND d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.expires_at>now() AND n.deleted_at IS NULL AND n.read_at IS NULL AND (${notificationVisibilityScope})`,
          [row.device_id, row.notification_id],
        );
        if (!device) {
          await this.finish(row, 'CANCELLED');
          continue;
        }
        eligible.push({ ...row, ...device });
      }
      if (eligible.length) {
        try {
          const messages = eligible.map((row) => {
            const token = openJson(row.token_ciphertext, this.secret(), 'mobile-push-token-v1');
            if (typeof token !== 'string') throw new Error('Invalid push token');
            return {
              to: token,
              title: 'SmartSite',
              body:
                row.language === 'vi'
                  ? 'Bạn có thông báo mới. Mở ứng dụng để xem.'
                  : 'You have a new notification. Open the app to view it.',
              sound: 'default',
              channelId: 'smartsite',
              data: { kind: 'smartsite-notification', notificationId: row.notification_id },
            };
          });
          const response = (await this.post('send', messages)) as {
            data?: Array<{ status: string; id?: string; details?: { error?: string } }>;
          };
          if (!Array.isArray(response?.data) || response.data.length !== eligible.length)
            throw new Error('Invalid push acknowledgement');
          for (let index = 0; index < eligible.length; index++) {
            const row = eligible[index]!,
              ticket = response.data[index]!;
            if (ticket.status === 'ok' && typeof ticket.id === 'string')
              await this.finish(row, 'ACCEPTED', ticket.id);
            else {
              if (ticket.details?.error === 'DeviceNotRegistered')
                await this.revoke(row.device_id, row.token_hash);
              await this.finish(row, 'FAILED');
            }
          }
        } catch {
          for (const row of eligible)
            await this.source.query(
              `UPDATE mobile_push_delivery SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,next_attempt_at=now()+make_interval(secs=>LEAST(300,30*attempts)) WHERE device_id=$1 AND notification_id=$2 AND attempts=$3 AND status='SENDING'`,
              [row.device_id, row.notification_id, row.attempts],
            );
        }
      }
      await this.receipts();
    } catch {
      this.logger.warn({ action: 'mobile_push.flush_unavailable' });
    } finally {
      this.running = false;
    }
  }
  private async receipts() {
    await this.source.query(
      `UPDATE mobile_push_delivery SET status='FAILED' WHERE status='ACCEPTED' AND attempted_at<now()-interval '24 hours'`,
    );
    const rows = await this.source.query<
      Array<{ device_id: string; notification_id: string; ticket_id: string; token_hash: string }>
    >(
      `SELECT p.device_id,p.notification_id,p.ticket_id,d.token_hash FROM mobile_push_delivery p JOIN mobile_push_device d ON d.id=p.device_id WHERE p.status='ACCEPTED' AND p.next_attempt_at<=now() ORDER BY p.attempted_at LIMIT 100`,
    );
    if (!rows.length) return;
    const response = (await this.post('getReceipts', {
      ids: rows.map((row) => row.ticket_id),
    })) as { data?: Record<string, { status: string; details?: { error?: string } }> };
    if (!response?.data || typeof response.data !== 'object')
      throw new Error('Invalid push receipt');
    for (const row of rows) {
      const receipt = response.data[row.ticket_id];
      if (receipt?.details?.error === 'DeviceNotRegistered')
        await this.revoke(row.device_id, row.token_hash);
      await this.source.query(
        `UPDATE mobile_push_delivery SET status=$3,next_attempt_at=now()+interval '5 minutes' WHERE device_id=$1 AND notification_id=$2 AND status='ACCEPTED'`,
        [
          row.device_id,
          row.notification_id,
          receipt?.status === 'ok' ? 'SENT' : receipt?.status === 'error' ? 'FAILED' : 'ACCEPTED',
        ],
      );
    }
  }
}
