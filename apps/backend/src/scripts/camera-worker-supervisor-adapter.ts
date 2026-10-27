import { spawn, type SpawnOptions } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { provisionCameraWorker } from './provision-camera-worker.js';
import {
  workerChildEnvironment,
  type OwnedWorker,
  type SupervisorPorts,
} from './camera-worker-supervisor.js';

export interface WorkerRuntimeInput {
  pythonExecutable: string;
  manifestFile: string;
  workingDirectory: string;
  workerEnvironment: Record<string, string>;
}
type Context = Parameters<SupervisorPorts['launch']>[0];

export function workerRuntimeCommand(
  input: WorkerRuntimeInput,
  context: Context,
  parent: NodeJS.ProcessEnv,
) {
  if (
    [
      input.pythonExecutable,
      input.manifestFile,
      input.workingDirectory,
      context.credentialFile,
      context.outboxPath,
    ].some((value) => !path.isAbsolute(value))
  )
    throw new Error('Absolute reviewed worker paths required');
  return {
    executable: input.pythonExecutable,
    args: [
      '-I',
      '-B',
      '-m',
      'smartsite_ai.tools.run_camera_runtime',
      '--manifest',
      input.manifestFile,
      '--generation-credential-file',
      context.credentialFile,
      '--expected-camera-id',
      context.cameraId,
      '--expected-outbox',
      context.outboxPath,
    ],
    options: {
      cwd: input.workingDirectory,
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
      env: workerChildEnvironment(parent, input.workerEnvironment),
    } satisfies SpawnOptions,
  };
}

async function checkedPath(value: string, directory: boolean): Promise<void> {
  if (!path.isAbsolute(value)) throw new Error('Invalid reviewed worker path');
  const metadata = await lstat(value),
    resolved = await realpath(value);
  const normalize = (entry: string) =>
    process.platform === 'win32' ? path.resolve(entry).toLowerCase() : path.resolve(entry);
  if (
    metadata.isSymbolicLink() ||
    normalize(value) !== normalize(resolved) ||
    (directory ? !metadata.isDirectory() : !metadata.isFile())
  )
    throw new Error('Invalid reviewed worker path');
}

/** Test-only operator composition; importing it does not issue credentials or start a worker. */
export async function operatorSupervisorPorts(
  input: WorkerRuntimeInput,
  issuerEnvironment: NodeJS.ProcessEnv,
): Promise<SupervisorPorts> {
  const issuer = { ...issuerEnvironment };
  const worker = { ...input, workerEnvironment: { ...input.workerEnvironment } };
  workerChildEnvironment(issuer, worker.workerEnvironment);
  await checkedPath(worker.pythonExecutable, false);
  await checkedPath(worker.manifestFile, false);
  await checkedPath(worker.workingDirectory, true);
  // Refuse implicit dotenv discovery; protected-directory/ACL verification is still an operator gate.
  const dotenv = await lstat(path.join(worker.workingDirectory, '.env')).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw new Error('Invalid worker working directory');
    },
  );
  if (dotenv) throw new Error('Worker working directory must not contain dotenv');
  return {
    issue: (args) => provisionCameraWorker(args, issuer),
    launch: async (context): Promise<OwnedWorker> => {
      const command = workerRuntimeCommand(worker, context, issuer);
      const child = spawn(command.executable, command.args, command.options);
      let forced = false;
      const exited = new Promise<{ code: number | null; termination: 'EXITED' | 'FORCED' }>(
        (resolve, reject) => {
          child.once('error', () => reject(new Error('Owned worker process failed')));
          child.once('close', (code) =>
            resolve({ code, termination: forced ? 'FORCED' : 'EXITED' }),
          );
        },
      );
      // Attach a handler before awaiting spawn so launch errors cannot become unhandled rejections.
      void exited.catch(() => {});
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => reject(new Error('Owned worker process could not start')));
      });
      return {
        exited,
        stop: async () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            await exited;
            return;
          }
          if (process.platform === 'win32') {
            forced = true;
            if (!child.kill('SIGTERM')) throw new Error('Owned worker stop was not confirmed');
          } else {
            if (!child.kill('SIGINT')) throw new Error('Owned worker stop was not confirmed');
            const deadline = Symbol();
            if (
              (await Promise.race([exited, delay(2000, deadline, { ref: false })])) === deadline
            ) {
              forced = true;
              if (!child.kill('SIGKILL')) throw new Error('Owned worker stop was not confirmed');
            }
          }
          await exited;
        },
      };
    },
  };
}
