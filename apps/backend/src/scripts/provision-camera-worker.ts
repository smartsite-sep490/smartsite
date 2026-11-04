import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { resolveCliEnvironment } from '../config/cli-environment.js';
import { buildTypeOrmOptions } from '../database/typeorm.options.js';
import { provisionCameraWorkerGeneration } from '../modules/cameras/camera-worker-generations.js';
import {
  deliverWorkerGeneration,
  parseWorkerGenerationArguments,
} from './worker-generation-delivery.js';

export async function provisionCameraWorker(args: string[], env = process.env): Promise<void> {
  const input = parseWorkerGenerationArguments(args);
  if (!env.DATABASE_SCHEMA || !(env.DATABASE_URL || env.DIRECT_URL || env.DATABASE_URL_UNPOOLED))
    throw new Error('Explicit database connection and schema required');
  const schema = env.DATABASE_SCHEMA;
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema) || schema === 'public' || schema.startsWith('pg_'))
    throw new Error('Explicit private schema required');
  const config = resolveCliEnvironment(undefined, { ...env, NODE_ENV: 'production' });
  const url = new URL(config.DATABASE_URL);
  if (url.searchParams.has('options')) throw new Error('Connection options override is forbidden');
  const identity = `${url.hostname}:${url.port || '5432'}/${url.pathname.slice(1)}/${schema}`;
  if (identity !== input.databaseIdentity) throw new Error('Database identity mismatch');
  const allowed = (env.AI_CONFIGURATION_CAMERA_IDS ?? '')
    .split(',')
    .map((id) => id.trim().toLowerCase());
  if (!allowed.includes(input.cameraId))
    throw new Error('Camera is outside the operator allowlist');
  await deliverWorkerGeneration(input.output, input.cameraId, async (deliver) => {
    const options = buildTypeOrmOptions(config);
    if (options.type !== 'postgres') throw new Error('PostgreSQL required');
    const source = new DataSource({
      ...options,
      schema,
      extra: { ...options.extra, options: `-c search_path=${schema}` },
    });
    try {
      await source.initialize();
      const [actual] = await source.query(
        'SELECT current_database() AS database, current_schema() AS schema',
      );
      if (
        actual?.database !== decodeURIComponent(url.pathname.slice(1)) ||
        actual?.schema !== schema
      )
        throw new Error('Connected database identity mismatch');
      await provisionCameraWorkerGeneration(
        source,
        input.cameraId,
        allowed,
        input.leaseMs,
        deliver,
      );
    } finally {
      if (source.isInitialized) await source.destroy();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void provisionCameraWorker(process.argv.slice(2)).then(
    () =>
      process.stdout.write('Worker generation provisioned; credential saved to requested file.\n'),
    () => {
      // Driver/validation errors may contain credentials; never print raw errors or arguments.
      process.stderr.write(
        'Worker provisioning failed; inspect the target database and recovery artifact before retrying.\n',
      );
      process.exitCode = 1;
    },
  );
}
