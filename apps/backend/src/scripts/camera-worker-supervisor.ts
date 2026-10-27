import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseWorkerGenerationArguments } from './worker-generation-delivery.js';

export interface SupervisorOptions {
  cameraId: string;
  allowedCameraIds: readonly string[];
  credentialDirectory: string;
  outboxPath: string;
  databaseIdentity: string;
  leaseMs: number;
  maximumStarts: number;
}
export interface OwnedWorker {
  exited: Promise<{ code: number | null; termination: 'EXITED' | 'FORCED' }>;
  stop(): Promise<void>;
}
export interface SupervisorPorts {
  issue(args: string[]): Promise<void>;
  launch(context: {
    cameraId: string;
    credentialFile: string;
    outboxPath: string;
  }): Promise<OwnedWorker>;
  backoff?(attempt: number, signal: AbortSignal): Promise<void>;
}

// Prototype ownership is process-local; cross-host/process fencing remains a release gate.
const ownedCameras = new Set<string>();
const systemEnvironment = new Set(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']);
const workerEnvironment = new Set([
  'SMARTSITE_AI_BACKEND_SERVICE_TOKEN',
  'SMARTSITE_AI_BACKEND_INGESTION_URL',
  'SMARTSITE_AI_WORKER_SOURCE',
  'EVIDENCE_LOCAL_ROOT',
  'PYTHONDONTWRITEBYTECODE',
]);
export function workerChildEnvironment(
  parent: NodeJS.ProcessEnv,
  supplied: Record<string, string>,
): NodeJS.ProcessEnv {
  if (Object.keys(supplied).some((key) => !workerEnvironment.has(key)))
    throw new Error('Unsupported worker environment');
  return {
    ...Object.fromEntries(Object.entries(parent).filter(([key]) => systemEnvironment.has(key))),
    ...supplied,
  };
}

function issuerArguments(options: SupervisorOptions, output: string): string[] {
  return [
    '--camera-id',
    options.cameraId,
    '--lease-ms',
    String(options.leaseMs),
    '--output',
    output,
    '--database-identity',
    options.databaseIdentity,
  ];
}

export async function superviseCameraWorker(
  options: SupervisorOptions,
  ports: SupervisorPorts,
  signal: AbortSignal,
): Promise<{
  status: 'CANCELLED' | 'EXHAUSTED';
  starts: number;
  exits: { code: number | null; termination: 'EXITED' | 'FORCED' }[];
}> {
  const cameraId = options.cameraId.toLowerCase();
  if (
    !path.isAbsolute(options.credentialDirectory) ||
    !path.isAbsolute(options.outboxPath) ||
    !/^127\.0\.0\.1:5433\/smartsite_test\/[^/\s]+$/.test(options.databaseIdentity) ||
    !Number.isInteger(options.maximumStarts) ||
    options.maximumStarts < 1 ||
    options.maximumStarts > 3 ||
    !options.allowedCameraIds.some((id) => id.toLowerCase() === cameraId)
  )
    throw new Error('Invalid test supervisor configuration');
  parseWorkerGenerationArguments(
    issuerArguments(options, path.join(options.credentialDirectory, 'validation.json')),
  );
  if (ownedCameras.has(cameraId))
    throw new Error('Camera supervisor already owned or reconciliation required');
  ownedCameras.add(cameraId);
  let uncertain = false;
  let starts = 0;
  const exits: { code: number | null; termination: 'EXITED' | 'FORCED' }[] = [];
  try {
    while (starts < options.maximumStarts) {
      if (signal.aborted) return { status: 'CANCELLED', starts, exits };
      const credentialFile = path.join(
        options.credentialDirectory,
        `${cameraId}-${randomUUID()}.json`,
      );
      uncertain = true;
      // An issuance error may follow a committed transaction: never automatically retry it.
      await ports.issue(issuerArguments({ ...options, cameraId }, credentialFile));
      uncertain = false;
      if (signal.aborted) return { status: 'CANCELLED', starts, exits };
      uncertain = true;
      const worker = await ports.launch({
        cameraId,
        credentialFile,
        outboxPath: options.outboxPath,
      });
      starts++;
      let aborted!: () => void;
      const cancellation = new Promise<'CANCELLED'>((resolve) => {
        aborted = () => resolve('CANCELLED');
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
      try {
        const exit = await Promise.race([worker.exited, cancellation]);
        if (exit === 'CANCELLED') {
          await worker.stop();
          exits.push(await worker.exited);
          uncertain = false;
          return { status: 'CANCELLED', starts, exits };
        }
        exits.push(exit);
        uncertain = false;
      } finally {
        signal.removeEventListener('abort', aborted);
      }
      if (starts < options.maximumStarts) {
        try {
          await (
            ports.backoff ??
            ((attempt, abortSignal) => delay(1000 * attempt, undefined, { signal: abortSignal }))
          )(starts, signal);
        } catch {
          if (!signal.aborted) throw new Error('Backoff failed');
        }
      }
    }
    return { status: signal.aborted ? 'CANCELLED' : 'EXHAUSTED', starts, exits };
  } catch {
    throw new Error('Worker supervisor requires operator reconciliation');
  } finally {
    if (!uncertain) ownedCameras.delete(cameraId);
  }
}
