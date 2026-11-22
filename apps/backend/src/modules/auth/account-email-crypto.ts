import { createHmac, timingSafeEqual } from 'node:crypto';
import { sealJson, openJson } from '../../common/secure-envelope.js';
export function emailCodeHash(
  secret: string,
  userId: string,
  purpose: string,
  code: string,
): string {
  return createHmac('sha256', secret)
    .update(`account-email-v1:${userId}:${purpose}:${code}`)
    .digest('hex');
}
export function equalEmailHash(left: string, right: string): boolean {
  return (
    /^[a-f0-9]{64}$/.test(left) &&
    /^[a-f0-9]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
  );
}
export function encryptAccountEmail(value: unknown, secret: string): string {
  return sealJson(value, secret, 'account-email-outbox-v1');
}
export function decryptAccountEmail(value: string, secret: string): unknown {
  return openJson(value, secret, 'account-email-outbox-v1');
}
