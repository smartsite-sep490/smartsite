import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface WorkerGenerationCredential {
  workerGenerationId: string;
  streamSessionId: string;
  secret: string;
  expiresAt: string;
}

export function parseWorkerGenerationArguments(args: string[]): {
  cameraId: string;
  leaseMs: number;
  output: string;
  databaseIdentity: string;
} {
  const names = ['--camera-id', '--lease-ms', '--output', '--database-identity'];
  const values = new Map<string, string>();
  if (args.length !== 8) throw new Error('Invalid operator arguments');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!key || !names.includes(key) || values.has(key) || !value || value.startsWith('--'))
      throw new Error('Invalid operator arguments');
    values.set(key, value);
  }
  const cameraId = values.get('--camera-id')!.toLowerCase();
  const rawLease = values.get('--lease-ms')!;
  const leaseMs = Number(rawLease);
  const output = values.get('--output')!;
  const databaseIdentity = values.get('--database-identity')!;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(cameraId) ||
    !/^\d+$/.test(rawLease) ||
    !Number.isSafeInteger(leaseMs) ||
    leaseMs < 1000 ||
    leaseMs > 86400000 ||
    !path.isAbsolute(output) ||
    databaseIdentity.includes('@') ||
    !/^[^/\s]+:\d+\/[^/\s]+\/[^/\s]+$/.test(databaseIdentity)
  )
    throw new Error('Invalid operator arguments');
  return { cameraId, leaseMs, output, databaseIdentity };
}

export async function deliverWorkerGeneration(
  output: string,
  cameraId: string,
  issue: (deliver: (credential: WorkerGenerationCredential) => Promise<void>) => Promise<unknown>,
): Promise<void> {
  if (!path.isAbsolute(output)) throw new Error('Absolute credential output required');
  const parent = path.dirname(path.resolve(output));
  const resolved = await realpath(parent);
  const sameParent =
    process.platform === 'win32'
      ? resolved.toLowerCase() === parent.toLowerCase()
      : resolved === parent;
  const metadata = await stat(parent);
  if (!sameParent || !metadata.isDirectory())
    throw new Error('Credential parent must be a real directory');
  // Windows inherits directory ACLs: operators must use a pre-protected private directory.
  if (
    process.platform !== 'win32' &&
    ((metadata.mode & 0o077) !== 0 || metadata.uid !== process.getuid?.())
  )
    throw new Error('Credential parent must be private');
  const file = await open(output, 'wx', 0o600);
  let delivered = false;
  try {
    await issue(async (credential) => {
      if (delivered) throw new Error('Credential delivery must occur once');
      delivered = true;
      await file.writeFile(
        JSON.stringify({ schemaVersion: '1.0.0', cameraId, ...credential }) + '\n',
      );
      await file.sync();
    });
    if (!delivered) throw new Error('Issuer did not deliver a credential');
  } finally {
    await file.close();
  }
}
