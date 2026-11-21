import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const key = (secret: string, purpose: string) =>
  createHash('sha256').update(`${purpose}:${secret}`).digest();
export function sealJson(value: unknown, secret: string, purpose: string): string {
  const nonce = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(secret, purpose), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}
export function openJson(value: string, secret: string, purpose: string): unknown {
  const [version, nonce, tag, encrypted, extra] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !encrypted || extra)
    throw new Error('Invalid secure envelope');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key(secret, purpose),
    Buffer.from(nonce, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  ) as unknown;
}
