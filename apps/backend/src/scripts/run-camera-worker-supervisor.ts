import { open, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { operatorSupervisorPorts } from './camera-worker-supervisor-adapter.js';
import { superviseCameraWorker } from './camera-worker-supervisor.js';
import type { EventEmitter } from 'node:events';

const normalizePath = (value: string) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);

export function isSupervisorEntry(argument: string | undefined, modulePath: string): boolean {
  return argument !== undefined && normalizePath(argument) === normalizePath(modulePath);
}

export function bindSupervisorSignals(
  emitter: Pick<EventEmitter, 'on' | 'removeListener'>,
  controller: AbortController,
) {
  const stop = () => controller.abort();
  // Keep handlers installed during asynchronous owned-child cleanup, including repeated Ctrl+C.
  emitter.on('SIGINT', stop);
  emitter.on('SIGTERM', stop);
  return () => {
    emitter.removeListener('SIGINT', stop);
    emitter.removeListener('SIGTERM', stop);
  };
}

const absolutePath = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value));
const configuration = z
  .object({
    cameraId: z.uuid(),
    allowedCameraIds: z.array(z.uuid()).min(1).max(256),
    credentialDirectory: absolutePath,
    outboxPath: absolutePath,
    databaseIdentity: z
      .string()
      .regex(/^127\.0\.0\.1:5433\/smartsite_test\/[a-z_][a-z0-9_]{0,62}$/),
    leaseMs: z.number().int().min(1000).max(86400000),
    maximumStarts: z.number().int().min(1).max(3),
    initialExpectedGenerationId: z.uuid().optional(),
    worker: z
      .object({
        pythonExecutable: absolutePath,
        manifestFile: absolutePath,
        workingDirectory: absolutePath,
      })
      .strict(),
  })
  .strict()
  .refine((value) => {
    const schema = value.databaseIdentity.split('/').at(-1)!;
    return schema !== 'public' && !schema.startsWith('pg_');
  })
  .refine((value) =>
    value.allowedCameraIds.some((id) => id.toLowerCase() === value.cameraId.toLowerCase()),
  );

export function parseSupervisorConfiguration(input: unknown) {
  // Never expose validation issues: unknown fields may themselves contain credentials.
  const result = configuration.safeParse(input);
  if (!result.success) throw new Error('Invalid test supervisor configuration');
  return result.data;
}

export async function runOperatorSupervisor(
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  if (args.length !== 2 || args[0] !== '--config' || !path.isAbsolute(args[1]!))
    throw new Error('An explicit absolute --config file is required');
  const configPath = args[1]!;
  const metadata = await lstat(configPath);
  const resolved = await realpath(configPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    normalizePath(configPath) !== normalizePath(resolved)
  )
    throw new Error('A regular reviewed configuration file is required');
  const handle = await open(configPath, 'r');
  let input: unknown;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino)
      throw new Error('Reviewed configuration file changed during opening');
    if (opened.size > 65536) throw new Error('Supervisor configuration exceeds size limit');
    const buffer = Buffer.alloc(65537);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    if (total > 65536) throw new Error('Supervisor configuration exceeds size limit');
    input = JSON.parse(buffer.subarray(0, total).toString('utf8'));
  } finally {
    await handle.close();
  }
  const { worker, ...options } = parseSupervisorConfiguration(input);
  const workerEnvironment: Record<string, string> = {};
  for (const key of [
    'SMARTSITE_AI_BACKEND_SERVICE_TOKEN',
    'SMARTSITE_AI_BACKEND_INGESTION_URL',
    'SMARTSITE_AI_WORKER_SOURCE',
    'EVIDENCE_LOCAL_ROOT',
    'PYTHONDONTWRITEBYTECODE',
  ]) {
    if (environment[key] !== undefined) workerEnvironment[key] = environment[key]!;
  }
  const ports = await operatorSupervisorPorts({ ...worker, workerEnvironment }, environment);
  return superviseCameraWorker(options, ports, signal);
}

if (isSupervisorEntry(process.argv[1], fileURLToPath(import.meta.url))) {
  const controller = new AbortController();
  const releaseSignals = bindSupervisorSignals(process, controller);
  void runOperatorSupervisor(process.argv.slice(2), process.env, controller.signal)
    .then(
      (result) => {
        process.stdout.write(JSON.stringify(result) + '\n');
        // A bounded budget being consumed is not operational readiness.
        process.exitCode = result.status === 'CANCELLED' ? 0 : 2;
      },
      () => {
        process.stderr.write('Supervisor stopped; operator reconciliation may be required.\n');
        process.exitCode = 1;
      },
    )
    .finally(releaseSignals);
}
