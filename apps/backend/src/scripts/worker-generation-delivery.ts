import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { TrustedTrackedTransition } from '../modules/cameras/camera-worker-generations.js';

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
  transition?: TrustedTrackedTransition;
  expectedCurrentGenerationId?: string;
} {
  const names = [
    '--camera-id',
    '--lease-ms',
    '--output',
    '--database-identity',
    '--transition-from-generation',
    '--transition-command',
    '--transition-reason',
    '--expected-current-generation',
  ];
  const values = new Map<string, string>();
  if (![8, 10, 14, 16].includes(args.length)) throw new Error('Invalid operator arguments');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i],
      value = args[i + 1];
    if (!key || !names.includes(key) || values.has(key) || !value || value.startsWith('--'))
      throw new Error('Invalid operator arguments');
    values.set(key, value);
  }
  if (names.slice(0, 4).some((key) => !values.has(key)))
    throw new Error('Invalid operator arguments');
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
  const expectedCurrentGenerationId = values.get('--expected-current-generation')?.toLowerCase();
  if (
    expectedCurrentGenerationId !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      expectedCurrentGenerationId,
    )
  )
    throw new Error('Invalid current generation condition');
  const condition =
    expectedCurrentGenerationId === undefined ? {} : { expectedCurrentGenerationId };
  const transitionNames = names.slice(4, 7);
  if (transitionNames.some((key) => values.has(key))) {
    const expectedGenerationId = values.get('--transition-from-generation')?.toLowerCase();
    const commandId = values.get('--transition-command')?.toLowerCase();
    const reason = values.get('--transition-reason');
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    if (
      !expectedGenerationId ||
      !commandId ||
      !uuid.test(expectedGenerationId) ||
      !uuid.test(commandId) ||
      ![
        'CONFIGURATION_CHANGED',
        'VIEW_CHANGED',
        'PROFILE_CHANGED',
        'SOURCE_RESTART',
        'LEASE_RENEWED',
      ].includes(reason ?? '')
    )
      throw new Error('Invalid tracked transition arguments');
    if (expectedCurrentGenerationId && expectedCurrentGenerationId !== expectedGenerationId)
      throw new Error('Generation owner conditions disagree');
    return {
      cameraId,
      leaseMs,
      output,
      databaseIdentity,
      ...condition,
      transition: {
        expectedGenerationId,
        commandId,
        reason: reason as TrustedTrackedTransition['reason'],
      },
    };
  }
  return { cameraId, leaseMs, output, databaseIdentity, ...condition };
}

export async function deliverWorkerGeneration<T>(
  output: string,
  cameraId: string,
  issue: (deliver: (credential: WorkerGenerationCredential) => Promise<void>) => Promise<T>,
): Promise<T> {
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
    const result = await issue(async (credential) => {
      if (delivered) throw new Error('Credential delivery must occur once');
      delivered = true;
      await file.writeFile(
        JSON.stringify({ schemaVersion: '1.0.0', cameraId, ...credential }) + '\n',
      );
      await file.sync();
    });
    if (!delivered) throw new Error('Issuer did not deliver a credential');
    return result;
  } finally {
    await file.close();
  }
}
