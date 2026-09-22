import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELISM = 3;
const MAX_MEMORY = 64 * 1024 * 1024;
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELISM,
        maxmem: MAX_MEMORY,
      },
      (error, key) => (error ? reject(error) : resolve(key as Buffer)),
    );
  });
}

export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 15 && value.length <= 128;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (
    parts.length !== 6 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== String(COST) ||
    parts[2] !== String(BLOCK_SIZE) ||
    parts[3] !== String(PARALLELISM)
  )
    return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  if (salt.length !== 16 || expected.length !== KEY_LENGTH) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(actual, expected);
}
