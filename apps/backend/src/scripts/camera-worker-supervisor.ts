import { randomUUID } from 'node:crypto';
import type { IssuedWorkerGeneration } from './provision-camera-worker.js';
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
  /** In-process signal from the trusted Backend launch adapter for this worker only. */
  sourceGapSignal?: AbortSignal;
  stop(): Promise<void>;
}
export interface SupervisorPorts {
  issue(args: string[]): Promise<IssuedWorkerGeneration>;
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

function issuerArguments(options: SupervisorOptions, output: string, previous?: string): string[] {
  return [
    '--camera-id',
    options.cameraId,
    '--lease-ms',
    String(options.leaseMs),
    '--output',
    output,
    '--database-identity',
    options.databaseIdentity,
    ...(previous ? ['--expected-current-generation', previous] : []),
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
  // Caller-owned configuration may change while issuance or shutdown is awaiting I/O.
  options = { ...options, allowedCameraIds: [...options.allowedCameraIds] };
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
  let previous: string | undefined;
  const generations = new Set<string>(),
    sessions = new Set<string>();
  const exits: { code: number | null; termination: 'EXITED' | 'FORCED' }[] = [];
  try {
    while (starts < options.maximumStarts) {
      if (signal.aborted) return { status: 'CANCELLED', starts, exits };
      const credentialFile = path.join(
        options.credentialDirectory,
        `${cameraId}-${randomUUID()}.json`,
      );
      uncertain = true;
      // Start before issuance so slow provisioning never extends the child's lease budget.
      const deadline = performance.now() + options.leaseMs;
      // An issuance error may follow a committed transaction: never automatically retry it.
      const issued = await ports.issue(
        issuerArguments({ ...options, cameraId }, credentialFile, previous),
      );
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      if (
        issued.cameraId !== cameraId ||
        !uuid.test(issued.workerGenerationId) ||
        !uuid.test(issued.streamSessionId) ||
        generations.has(issued.workerGenerationId) ||
        sessions.has(issued.streamSessionId) ||
        !Number.isFinite(Date.parse(issued.expiresAt))
      )
        throw new Error('Invalid committed generation binding');
      previous = issued.workerGenerationId;
      generations.add(previous);
      sessions.add(issued.streamSessionId);
      uncertain = false;
      if (signal.aborted) return { status: 'CANCELLED', starts, exits };
      const remainingLease = Math.min(
        deadline - performance.now(),
        Date.parse(issued.expiresAt) - Date.now(),
      );
      if (remainingLease <= 0) {
        uncertain = true;
        throw new Error('Issuance consumed worker lease');
      }
      const workerDeadline = performance.now() + remainingLease;
      uncertain = true;
      const worker = await ports.launch({
        cameraId,
        credentialFile,
        outboxPath: options.outboxPath,
      });
      starts++;
      const stopSignal = worker.sourceGapSignal
        ? AbortSignal.any([signal, worker.sourceGapSignal])
        : signal;
      let aborted!: () => void;
      const cancellation = new Promise<'STOP_REQUESTED'>((resolve) => {
        aborted = () => resolve('STOP_REQUESTED');
        stopSignal.addEventListener('abort', aborted, { once: true });
        if (stopSignal.aborted) aborted();
      });
      const leaseTimer = new AbortController();
      try {
        const expiry = delay(Math.max(0, workerDeadline - performance.now()), 'EXPIRED' as const, {
          signal: leaseTimer.signal,
        });
        const exit = await Promise.race([worker.exited, cancellation, expiry]);
        if (typeof exit === 'string') {
          await worker.stop();
          exits.push(await worker.exited);
          uncertain = false;
          if (signal.aborted) return { status: 'CANCELLED', starts, exits };
        } else {
          exits.push(exit);
          uncertain = false;
        }
      } finally {
        leaseTimer.abort();
        stopSignal.removeEventListener('abort', aborted);
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
