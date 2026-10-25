import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { z } from 'zod';
import { PublicHttpException } from '../common/http/public-http-exception.js';
import { validateEnvironment, type BackendEnvironment } from '../config/environment.js';
import { buildTypeOrmOptions } from '../database/typeorm.options.js';
import { AuthService, type AuthenticatedRequest } from '../modules/auth/auth.service.js';
import { AuthTokenService } from '../modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../modules/auth/user-auth.guard.js';
import {
  verifyMainAuthorityCutoverRelease,
  type MainAuthorityCutoverReleaseConfig,
} from '../modules/zones/main-authority-cutover-release.js';
import { MainAuthorityCutoverService } from '../modules/zones/main-authority-cutover.service.js';

export const MAX_CUTOVER_STDIN_BYTES = 16 * 1024;

const stdinPayloadSchema = z.strictObject({
  action: z.literal('ACTIVATE'),
  accessToken: z.string().min(1).max(4096).regex(/^\S+$/),
  expectedPreviousEpochId: z
    .uuid()
    .transform((value) => value.toLowerCase())
    .nullable(),
});

export type CutoverStdinPayload = z.infer<typeof stdinPayloadSchema>;

export function parseCutoverStdinPayload(raw: string | Buffer): CutoverStdinPayload {
  const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CUTOVER_STDIN_BYTES)
    throw new Error('Invalid cutover stdin payload size');
  try {
    return stdinPayloadSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch {
    throw new Error('Invalid cutover stdin payload');
  }
}

export async function readCutoverStdinPayload(
  input: AsyncIterable<Buffer | string> = process.stdin,
): Promise<CutoverStdinPayload> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of input) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    total += buffer.byteLength;
    if (total > MAX_CUTOVER_STDIN_BYTES) throw new Error('Cutover stdin payload exceeds 16 KiB');
    chunks.push(buffer);
  }
  return parseCutoverStdinPayload(Buffer.concat(chunks, total));
}

export function resolveCutoverOperatorEnvironment(
  rawEnv: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv.slice(2),
): { env: BackendEnvironment; release: MainAuthorityCutoverReleaseConfig } {
  if (argv.length > 0) throw new Error('CLI arguments are forbidden; use bounded stdin JSON');
  if (!rawEnv.NODE_ENV?.trim() || !rawEnv.DATABASE_URL?.trim() || !rawEnv.AUTH_JWT_SECRET?.trim())
    throw new Error('NODE_ENV, DATABASE_URL, and AUTH_JWT_SECRET must be explicitly set');
  if (
    (rawEnv.MF06_ENQUEUE_ENABLED !== undefined && rawEnv.MF06_ENQUEUE_ENABLED !== 'false') ||
    (rawEnv.MF06_WORKER_ENABLED !== undefined && rawEnv.MF06_WORKER_ENABLED !== 'false')
  )
    throw new Error('MF06 enqueue and worker must be disabled in cutover operator process');
  const env = validateEnvironment({
    ...rawEnv,
    MF06_ENQUEUE_ENABLED: 'false',
    MF06_WORKER_ENABLED: 'false',
  });
  if (
    !env.MF06_CUTOVER_MANIFEST_PATH ||
    !env.MF06_CUTOVER_MANIFEST_SHA256 ||
    !env.MF06_CUTOVER_RELEASE_ROOT ||
    !env.MF06_CUTOVER_RELEASE_COMMIT
  )
    throw new Error('Trusted MF06 cutover release configuration must be explicitly set');
  return {
    env,
    release: Object.freeze({
      manifestPath: env.MF06_CUTOVER_MANIFEST_PATH,
      reviewedManifestSha256: env.MF06_CUTOVER_MANIFEST_SHA256,
      releaseRoot: env.MF06_CUTOVER_RELEASE_ROOT,
      releaseCommit: env.MF06_CUTOVER_RELEASE_COMMIT,
    }),
  };
}

export function assertOperationalCutoverManifest<T extends { provenance: string }>(verified: T): T {
  if (verified.provenance !== 'OPERATIONAL_REVIEWED')
    throw new Error('Operational cutover requires an OPERATIONAL_REVIEWED release manifest');
  return verified;
}

export function formatCutoverStdoutReceipt(
  receipt: Awaited<ReturnType<MainAuthorityCutoverService['activate']>>,
): string {
  assertOperationalCutoverManifest(receipt);
  if (receipt.commitStatus !== 'COMMITTED' || typeof receipt.witnessConfirmed !== 'boolean')
    throw new Error('Invalid cutover commit receipt');
  const {
    epochId,
    commandId,
    capturedAt,
    snapshotHash,
    manifestSha256,
    provenance,
    commitStatus,
    witnessConfirmed,
  } = receipt;
  return JSON.stringify({
    epochId,
    commandId,
    capturedAt,
    snapshotHash,
    manifestSha256,
    provenance,
    commitStatus,
    witnessConfirmed,
  });
}

export function formatSanitizedCutoverError(error: unknown): string {
  const code =
    error instanceof PublicHttpException
      ? (error.getResponse() as { code?: unknown })?.code
      : undefined;
  const suffix = typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : '';
  return `Authority cutover failed${suffix}; commit may have occurred—inspect authority control and epoch state before retry.`;
}

async function main(): Promise<void> {
  const { env, release } = resolveCutoverOperatorEnvironment(process.env, process.argv.slice(2));
  if (process.stdin.isTTY)
    throw new Error('Pipe private JSON input; do not type credentials in a terminal');
  const payload = await readCutoverStdinPayload(process.stdin);
  assertOperationalCutoverManifest(await verifyMainAuthorityCutoverRelease(release, env.NODE_ENV));
  const dataSource = new DataSource(
    buildTypeOrmOptions({
      DATABASE_URL: env.DATABASE_URL,
      DATABASE_SCHEMA: env.DATABASE_SCHEMA,
      DATABASE_TIMEOUT_MS: env.DATABASE_TIMEOUT_MS,
    }),
  );
  try {
    await dataSource.initialize();
    const config = new ConfigService<BackendEnvironment, true>(env);
    const guard = new UserAuthGuard(
      new AuthService(dataSource, new AuthTokenService(new JwtService(), config)),
    );
    const request: AuthenticatedRequest = {
      headers: { authorization: `Bearer ${payload.accessToken}` },
    };
    await guard.authenticateRequest(request);
    const receipt = await new MainAuthorityCutoverService(
      dataSource,
      guard,
      release,
      config,
    ).activate(request, payload.expectedPreviousEpochId);
    process.stdout.write(`${formatCutoverStdoutReceipt(receipt)}\n`);
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${formatSanitizedCutoverError(error)}\n`);
    process.exitCode = 1;
  });
}
