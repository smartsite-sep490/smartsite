import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { BackendEnvironment } from '../../config/environment.js';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const filePath = z
  .string()
  .max(256)
  .regex(/^[a-zA-Z0-9_./-]+$/)
  .refine(
    (v) => !isAbsolute(v) && !v.split('/').some((part) => !part || part === '.' || part === '..'),
  );
const manifestSchema = z.strictObject({
  version: z.literal('MF06_REVIEWED_CUTOVER_RELEASE_V1'),
  releaseCommit: z.string().regex(/^[0-9a-f]{40}$/),
  captureProfile: z.literal('NAMED_V2_CONTROLLED_CUTOVER_V1'),
  provenance: z.enum(['OPERATIONAL_REVIEWED', 'SYNTHETIC_TEST']),
  sourceRegistryHash: digest,
  files: z
    .array(z.strictObject({ path: filePath, sha256: digest }))
    .min(1)
    .max(512),
  runtimeFiles: z
    .array(z.strictObject({ path: filePath, sha256: digest }))
    .min(1)
    .max(512),
  writerReview: z
    .object({
      protocol: z.literal('PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1'),
      sourceIndexSha256: digest,
      methods: z.number().int().positive().max(4096),
      files: z.number().int().positive().max(512),
      exactQuotesAndSourcePinsVerified: z.literal(true),
      missingOrDuplicateMethods: z.literal(false),
      completeWriterClosureEstablished: z.literal(true),
      rows: z
        .array(
          z
            .object({
              file: filePath,
              method: z.string().min(1).max(256),
              fileSha256: digest,
              methodBodySha256: digest,
              classification: z.enum([
                'MASKED_COMMAND',
                'OUTSIDE_MASK',
                'CANONICAL_BLOCKED_LEGACY',
                'INTERNAL_ONLY',
              ]),
            })
            .passthrough(),
        )
        .min(1)
        .max(4096),
    })
    .passthrough(),
});

export interface MainAuthorityCutoverReleaseConfig {
  /** Trusted operator configuration, never an HTTP DTO or a caller-approved flag. */
  readonly manifestPath: string;
  readonly reviewedManifestSha256: string;
  readonly releaseRoot: string;
  readonly releaseCommit: string;
}

export const MAIN_AUTHORITY_CUTOVER_RELEASE_FILES = [
  'common/configuration/main-configuration-authority.ts',
  'common/configuration/main-authority-capture-preflight.ts',
  'common/configuration/main-authority-sources.ts',
  'common/configuration/authorization-history-cutover-bodies-v1.ts',
  'common/configuration/main-team-authority-sources.ts',
  'modules/auth/configuration-command-context.ts',
  'modules/auth/user-auth.guard.ts',
  'modules/auth/auth.service.ts',
  'modules/zones/main-authority-cutover.service.ts',
  'modules/zones/main-authority-cutover-release.ts',
  'modules/zones/main-authority-read-snapshot.ts',
  'modules/zones/main-authority-captured-state.reader.ts',
  'modules/zones/main-authority-archive-codec.ts',
  'modules/zones/main-authority-baseline-profile.ts',
  'modules/zones/main-team-authority-archive.ts',
  'modules/zones/main-qualified-authority.reader.ts',
].map((path) => `apps/backend/src/${path}`);

export const MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES = MAIN_AUTHORITY_CUTOVER_RELEASE_FILES.map(
  (path) => path.slice('apps/backend/src/'.length).replace(/\.ts$/, '.js'),
);

/** Rechecks an out-of-band reviewed artifact and its release bytes; it does not conduct that review. */
export async function verifyMainAuthorityCutoverRelease(
  config: MainAuthorityCutoverReleaseConfig,
  environment: BackendEnvironment['NODE_ENV'],
) {
  if (
    !digest.safeParse(config.reviewedManifestSha256).success ||
    !/^[0-9a-f]{40}$/.test(config.releaseCommit) ||
    !isAbsolute(config.releaseRoot) ||
    !isAbsolute(config.manifestPath)
  )
    throw new Error('Invalid trusted cutover release configuration');
  const bytes = await boundedRead(config.manifestPath);
  if (sha256(bytes) !== config.reviewedManifestSha256)
    throw new Error('Cutover review pin mismatch');
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (manifest.provenance === 'SYNTHETIC_TEST' && environment !== 'test')
    throw new Error('Synthetic cutover release is test-only');
  if (manifest.releaseCommit !== config.releaseCommit) throw new Error('Cutover release mismatch');
  const files = new Map(manifest.files.map((file) => [file.path, file.sha256]));
  if (
    files.size !== manifest.files.length ||
    MAIN_AUTHORITY_CUTOVER_RELEASE_FILES.some((path) => !files.has(path))
  )
    throw new Error('Incomplete cutover release pins');
  const root = await realpath(config.releaseRoot);
  const runtimeRoot = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '../..'));
  const runtimeFiles = new Map(manifest.runtimeFiles.map((file) => [file.path, file.sha256]));
  if (
    runtimeFiles.size !== manifest.runtimeFiles.length ||
    MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES.some((path) => !runtimeFiles.has(path))
  )
    throw new Error('Incomplete loaded runtime pins');
  let total = 0;
  for (const [base, pins] of [
    [root, files],
    [runtimeRoot, runtimeFiles],
  ] as const) {
    for (const [path, expected] of pins) {
      const actualPath = await realpath(resolve(base, path));
      const within = relative(base, actualPath);
      if (!within || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within))
        throw new Error('Cutover release pin escapes its root');
      const actual = await boundedRead(actualPath);
      total += actual.length;
      if (total > 16 * 1024 * 1024 || sha256(actual) !== expected)
        throw new Error('Cutover release bytes mismatch or exceed budget');
    }
  }
  const review = manifest.writerReview;
  const methods = new Set(review.rows.map((row) => `${row.file}:${row.method}`));
  const writerFiles = new Set(review.rows.map((row) => row.file));
  if (
    methods.size !== review.methods ||
    review.rows.length !== review.methods ||
    writerFiles.size !== review.files ||
    review.rows.some(
      (row) =>
        files.get(`apps/backend/src/${row.file}`) !== row.fileSha256 ||
        !runtimeFiles.has(row.file.replace(/\.ts$/, '.js')),
    )
  )
    throw new Error('Cutover writer inventory does not match release pins');
  return Object.freeze({
    manifestSha256: config.reviewedManifestSha256,
    releaseCommit: manifest.releaseCommit,
    sourceRegistryHash: manifest.sourceRegistryHash,
    provenance: manifest.provenance,
  });
}

async function boundedRead(path: string): Promise<Buffer> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 2 * 1024 * 1024)
    throw new Error('Invalid cutover artifact size');
  const bytes = await readFile(path);
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Invalid cutover artifact size');
  return bytes;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
