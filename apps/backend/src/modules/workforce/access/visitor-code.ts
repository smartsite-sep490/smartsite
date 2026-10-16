import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newVisitorCode() {
  return Array.from(randomBytes(8), (b) => alphabet[b & 31]).join('');
}
function key(secret: string) {
  return Buffer.from(hkdfSync('sha256', secret, 'smartsite', 'visitor-booking-code-v1', 32));
}
export function encryptVisitorCode(code: string, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret), nonce);
  const data = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString('base64url');
}
export function decryptVisitorCode(encrypted: string, secret: string): string {
  const data = Buffer.from(encrypted, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(secret), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}
