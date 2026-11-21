import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { DataSource, type EntityManager, IsNull } from 'typeorm';
import type { BackendEnvironment } from '../../config/environment.js';
import { UserEntity } from '../../database/entities/user.entity.js';
import { AuthSessionEntity } from '../../database/entities/auth-session.entity.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { hashPassword, verifyPassword, validPassword } from './password.js';
import { PASSWORD_POLICY_MESSAGE } from '../../common/configuration/password-policy.js';
import {
  decryptAccountEmail,
  encryptAccountEmail,
  emailCodeHash,
  equalEmailHash,
} from './account-email-crypto.js';

type Language = 'vi' | 'en';
type EmailUser = Pick<UserEntity, 'id' | 'username' | 'passwordHash' | 'email'>;
type MailPayload = { subject: string; text: string; passwordVersion?: string };
const fingerprint = (value: string) => createHash('sha256').update(value).digest('hex');
const invalidCode = () =>
  new PublicHttpException(400, {
    code: 'INVALID_EMAIL_CODE',
    message: 'Verification code is invalid or expired',
  });

@Injectable()
export class AccountEmailService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AccountEmailService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly source: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}
  private secret() {
    return this.config.getOrThrow('AUTH_JWT_SECRET', { infer: true });
  }
  assertConfigured() {
    if (
      !this.config.get('RESEND_API_KEY', { infer: true }) ||
      !this.config.get('RESEND_FROM_EMAIL', { infer: true })
    )
      throw new PublicHttpException(503, {
        code: 'ACCOUNT_EMAIL_UNAVAILABLE',
        message: 'Account email delivery is not configured',
      });
  }
  onApplicationBootstrap() {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    try {
      this.assertConfigured();
    } catch {
      return;
    }
    this.timer = setInterval(() => void this.flush(), 30000);
    this.timer.unref();
    void this.flush();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  private async queue(
    manager: EntityManager,
    user: EmailUser,
    purpose: 'VERIFY' | 'RESET',
    language: Language,
    password?: string,
  ) {
    if (!user.email) throw new Error('Account email required');
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000));
    await manager.query(
      `UPDATE account_email_challenge SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL`,
      [user.id, purpose],
    );
    await manager.query(
      `UPDATE account_email_outbox SET status='CANCELLED',payload_ciphertext=NULL WHERE user_id=$1 AND status IN ('PENDING','FAILED','SENDING') AND challenge_id IN (SELECT id FROM account_email_challenge WHERE user_id=$1 AND purpose=$2)`,
      [user.id, purpose],
    );
    await manager.query(
      `INSERT INTO account_email_challenge(id,user_id,email,purpose,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')`,
      [id, user.id, user.email, purpose, emailCodeHash(this.secret(), user.id, purpose, code)],
    );
    const vietnamese = language === 'vi';
    const subject = password
      ? vietnamese
        ? 'SmartSite - Tài khoản công nhân'
        : 'SmartSite - Your worker account'
      : purpose === 'RESET'
        ? vietnamese
          ? 'SmartSite - Đặt lại mật khẩu'
          : 'SmartSite - Reset your password'
        : vietnamese
          ? 'SmartSite - Xác minh email'
          : 'SmartSite - Verify your email';
    const credentials = password
      ? vietnamese
        ? `Tài khoản: ${user.username}\nMật khẩu ban đầu: ${password}\n\nĐăng nhập ứng dụng SmartSite, mở Hồ sơ > Email để xác minh địa chỉ này.\n\n`
        : `Username: ${user.username}\nInitial password: ${password}\n\nSign in to SmartSite, then open Profile > Email to verify this address.\n\n`
      : '';
    const action =
      purpose === 'RESET'
        ? vietnamese
          ? 'Mã đặt lại mật khẩu'
          : 'Password reset code'
        : vietnamese
          ? 'Mã xác minh email'
          : 'Email verification code';
    const text = `${credentials}${action}: ${code}\n${vietnamese ? 'Mã có hiệu lực 10 phút. Không chia sẻ mã cho người khác. Nếu bạn không yêu cầu, hãy bỏ qua email này.' : 'The code expires in 10 minutes. Do not share it. If you did not request this email, ignore it.'}`;
    const payload: MailPayload = {
      subject,
      text,
      ...(password ? { passwordVersion: fingerprint(user.passwordHash) } : {}),
    };
    await manager.query(
      `INSERT INTO account_email_outbox(id,user_id,challenge_id,recipient,payload_ciphertext) VALUES($1,$2,$3,$4,$5)`,
      [randomUUID(), user.id, id, user.email, encryptAccountEmail(payload, this.secret())],
    );
  }
  async queueWelcome(
    manager: EntityManager,
    user: EmailUser,
    password: string,
    language: Language = 'vi',
  ) {
    this.assertConfigured();
    await this.queue(manager, user, 'VERIFY', language, password);
  }
  private async recentlyRequested(manager: EntityManager, userId: string, purpose: string) {
    const [row] = await manager.query<{ recent: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM account_email_challenge WHERE user_id=$1 AND purpose=$2 AND created_at>now()-interval '60 seconds') AS recent`,
      [userId, purpose],
    );
    return !!row?.recent;
  }
  async requestReset(identifier: string, language: Language = 'vi') {
    this.assertConfigured();
    await this.source.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('u')
        .setLock('pessimistic_write')
        .where('(u.username=:identifier OR u.email=:identifier) AND u.is_active=true', {
          identifier,
        })
        .getOne();
      // Same public result for unknown, unverified and rate-limited accounts.
      if (
        !user?.email ||
        !user.emailVerifiedAt ||
        (await this.recentlyRequested(manager, user.id, 'RESET'))
      )
        return;
      await this.queue(manager, user, 'RESET', language);
    });
    return { accepted: true as const };
  }
  private async consume(
    manager: EntityManager,
    user: UserEntity,
    purpose: 'VERIFY' | 'RESET',
    code: string,
  ) {
    const [challenge] = await manager.query<{ id: string; token_hash: string; attempts: number }[]>(
      `SELECT id,token_hash,attempts FROM account_email_challenge WHERE user_id=$1 AND email=$2 AND purpose=$3 AND consumed_at IS NULL AND expires_at>now() ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
      [user.id, user.email, purpose],
    );
    if (!challenge || challenge.attempts >= 5) return false;
    const matches = equalEmailHash(
      challenge.token_hash,
      emailCodeHash(this.secret(), user.id, purpose, code),
    );
    await manager.query(
      `UPDATE account_email_challenge SET attempts=attempts+1,consumed_at=CASE WHEN $2 OR attempts+1>=5 THEN now() ELSE NULL END WHERE id=$1`,
      [challenge.id, matches],
    );
    return matches;
  }
  async confirmReset(identifier: string, code: string, password: string) {
    if (!validPassword(password))
      throw new PublicHttpException(400, {
        code: 'INVALID_PASSWORD',
        message: PASSWORD_POLICY_MESSAGE,
      });
    const passwordHash = await hashPassword(password);
    const result = await this.source.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('u')
        .setLock('pessimistic_write')
        .where('(u.username=:identifier OR u.email=:identifier) AND u.is_active=true', {
          identifier,
        })
        .getOne();
      if (
        !user?.email ||
        !user.emailVerifiedAt ||
        !(await this.consume(manager, user, 'RESET', code))
      )
        return false;
      user.passwordHash = passwordHash;
      user.mustChangePassword = false;
      await manager.getRepository(UserEntity).save(user);
      await manager
        .getRepository(AuthSessionEntity)
        .update({ userId: user.id, revokedAt: IsNull() }, { revokedAt: new Date() });
      await manager.query(
        `UPDATE account_email_challenge SET consumed_at=now() WHERE user_id=$1 AND purpose='RESET' AND consumed_at IS NULL`,
        [user.id],
      );
      return true;
    });
    // Throw after commit: wrong-code attempt increments must never roll back.
    if (!result) throw invalidCode();
    return { accepted: true as const };
  }
  async resendVerification(userId: string, language: Language = 'vi') {
    this.assertConfigured();
    await this.source.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .findOne({ where: { id: userId, isActive: true }, lock: { mode: 'pessimistic_write' } });
      if (!user?.email)
        throw new PublicHttpException(400, {
          code: 'ACCOUNT_EMAIL_REQUIRED',
          message: 'Add an account email first',
        });
      if (user.emailVerifiedAt) return;
      if (await this.recentlyRequested(manager, user.id, 'VERIFY'))
        throw new PublicHttpException(429, {
          code: 'EMAIL_CODE_RATE_LIMITED',
          message: 'Wait before requesting another code',
        });
      await this.queue(manager, user, 'VERIFY', language);
    });
    return { accepted: true as const };
  }
  async setEmail(
    userId: string,
    email: string,
    currentPassword: string,
    language: Language = 'vi',
  ) {
    this.assertConfigured();
    const account = await this.source
      .getRepository(UserEntity)
      .findOneBy({ id: userId, isActive: true });
    if (!account || !(await verifyPassword(currentPassword, account.passwordHash)))
      throw new PublicHttpException(400, {
        code: 'CURRENT_PASSWORD_INVALID',
        message: 'Current password is incorrect',
      });
    try {
      await this.source.transaction(async (manager) => {
        const user = await manager
          .getRepository(UserEntity)
          .findOne({ where: { id: userId, isActive: true }, lock: { mode: 'pessimistic_write' } });
        if (!user || user.passwordHash !== account.passwordHash)
          throw new PublicHttpException(409, {
            code: 'ACCOUNT_CHANGED',
            message: 'Account changed; try again',
          });
        user.email = email;
        user.emailVerifiedAt = null;
        await manager.getRepository(UserEntity).save(user);
        await manager.query(
          `UPDATE account_email_challenge SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL`,
          [userId],
        );
        await manager.query(
          `UPDATE account_email_outbox SET status='CANCELLED',payload_ciphertext=NULL WHERE user_id=$1 AND status IN ('PENDING','SENDING','FAILED')`,
          [userId],
        );
        await this.queue(manager, user, 'VERIFY', language);
      });
    } catch (error) {
      if (
        (error as { code?: string; constraint?: string }).code === '23505' &&
        (error as { constraint?: string }).constraint === 'uq_user_email'
      )
        throw new PublicHttpException(409, {
          code: 'EMAIL_UNAVAILABLE',
          message: 'This email cannot be used',
        });
      throw error;
    }
    return { accepted: true as const };
  }
  async verify(userId: string, code: string) {
    const accepted = await this.source.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .findOne({ where: { id: userId, isActive: true }, lock: { mode: 'pessimistic_write' } });
      if (!user?.email || !(await this.consume(manager, user, 'VERIFY', code))) return false;
      user.emailVerifiedAt = new Date();
      await manager.getRepository(UserEntity).save(user);
      return true;
    });
    if (!accepted) throw invalidCode();
    return { accepted: true as const };
  }

  async flush() {
    if (this.running) return;
    this.running = true;
    try {
      this.assertConfigured();
      const rows = await this.source.query<{ id: string }[]>(
        `SELECT id FROM account_email_outbox WHERE attempts<5 AND next_attempt_at<=now() AND (status='PENDING' OR (status='SENDING' AND attempted_at<now()-interval '5 minutes')) ORDER BY created_at LIMIT 10`,
      );
      for (const row of rows) await this.deliver(row.id);
    } catch {
      this.logger.warn({ action: 'account_email.flush_unavailable' });
    } finally {
      this.running = false;
    }
  }
  private async deliver(id: string) {
    // TypeORM returns [rows, affected] for UPDATE. The outer SELECT keeps a
    // flat row list while preserving the atomic claim and retry conditions.
    const [row] = await this.source.query<
      {
        id: string;
        user_id: string;
        challenge_id: string;
        recipient: string;
        payload_ciphertext: string;
        attempts: number;
      }[]
    >(
      `WITH claimed AS (
        UPDATE account_email_outbox SET status='SENDING',attempts=attempts+1,attempted_at=now()
        WHERE id=$1 AND attempts<5 AND next_attempt_at<=now()
          AND (status='PENDING' OR (status='SENDING' AND attempted_at<now()-interval '5 minutes'))
        RETURNING *
      ) SELECT * FROM claimed`,
      [id],
    );
    if (!row) return;
    let providerStatus: number | undefined;
    try {
      const [current] = await this.source.query<
        { email: string; password_hash: string; valid: boolean }[]
      >(
        `SELECT u.email,u.password_hash,(u.is_active AND c.consumed_at IS NULL AND c.expires_at>now() AND c.email=u.email AND o.recipient=u.email) AS valid FROM app_user u JOIN account_email_challenge c ON c.user_id=u.id JOIN account_email_outbox o ON o.challenge_id=c.id WHERE c.id=$1 AND o.id=$2`,
        [row.challenge_id, row.id],
      );
      const payload = decryptAccountEmail(row.payload_ciphertext, this.secret()) as MailPayload;
      if (
        !current?.valid ||
        (payload.passwordVersion && payload.passwordVersion !== fingerprint(current.password_hash))
      ) {
        await this.source.query(
          `UPDATE account_email_outbox SET status='CANCELLED',payload_ciphertext=NULL WHERE id=$1 AND attempts=$2 AND status='SENDING'`,
          [id, row.attempts],
        );
        return;
      }
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${this.config.getOrThrow('RESEND_API_KEY', { infer: true })}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `account-email/${id}`,
        },
        body: JSON.stringify({
          from: `SmartSite <${this.config.getOrThrow('RESEND_FROM_EMAIL', { infer: true })}>`,
          to: [current.email],
          subject: payload.subject,
          text: payload.text,
        }),
      });
      providerStatus = response.status;
      if (!response.ok) throw new Error('Email delivery rejected');
      const acknowledgement: unknown = await response.json();
      if (
        !acknowledgement ||
        typeof acknowledgement !== 'object' ||
        !('id' in acknowledgement) ||
        typeof acknowledgement.id !== 'string'
      )
        throw new Error('Invalid acknowledgement');
      await this.source.query(
        `UPDATE account_email_outbox SET status='SENT',sent_at=now(),payload_ciphertext=NULL WHERE id=$1 AND attempts=$2 AND status='SENDING'`,
        [id, row.attempts],
      );
    } catch {
      await this.source.query(
        `UPDATE account_email_outbox SET status=CASE WHEN attempts>=5 THEN 'FAILED' ELSE 'PENDING' END,next_attempt_at=now()+make_interval(secs=>LEAST(300,30*attempts)) WHERE id=$1 AND attempts=$2 AND status='SENDING'`,
        [id, row.attempts],
      );
      this.logger.warn({
        action: 'account_email.delivery_failed',
        outboxId: id,
        ...(providerStatus !== undefined ? { providerStatus } : {}),
      });
    }
  }
}
