import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
  verifyMainAuthorityCutoverRelease,
  type MainAuthorityCutoverReleaseConfig,
} from '../src/modules/zones/main-authority-cutover-release.js';

const DIRECT_AUTHORITY_HELPER_STEMS = [
  'common/configuration/main-authority-sources.ts',
  'modules/zones/main-authority-baseline-profile.ts',
  'modules/zones/main-team-authority-archive.ts',
] as const;

const DIRECT_AUTHORITY_HELPER_SOURCE_FILES = DIRECT_AUTHORITY_HELPER_STEMS.map(
  (stem) => `apps/backend/src/${stem}` as const,
);

const DIRECT_AUTHORITY_HELPER_RUNTIME_FILES = DIRECT_AUTHORITY_HELPER_STEMS.map((stem) =>
  stem.replace(/\.ts$/, '.js'),
);

const ALL_PINNED_SOURCE_FILES = Array.from(
  new Set([...MAIN_AUTHORITY_CUTOVER_RELEASE_FILES, ...DIRECT_AUTHORITY_HELPER_SOURCE_FILES]),
);

const ALL_PINNED_RUNTIME_FILES = Array.from(
  new Set([...MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES, ...DIRECT_AUTHORITY_HELPER_RUNTIME_FILES]),
);

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

const RELEASE_COMMIT = 'a'.repeat(40);
const SOURCE_REGISTRY_HASH = 'd'.repeat(64);

interface SyntheticCutoverManifest {
  version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1';
  releaseCommit: string;
  captureProfile: 'NAMED_V2_CONTROLLED_CUTOVER_V1';
  provenance: 'SYNTHETIC_TEST';
  sourceRegistryHash: string;
  files: Array<{ path: string; sha256: string }>;
  runtimeFiles: Array<{ path: string; sha256: string }>;
  writerReview: {
    protocol: 'PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1';
    sourceIndexSha256: string;
    methods: number;
    files: number;
    exactQuotesAndSourcePinsVerified: true;
    missingOrDuplicateMethods: false;
    completeWriterClosureEstablished: true;
    rows: Array<{
      file: string;
      method: string;
      fileSha256: string;
      methodBodySha256: string;
      classification: 'MASKED_COMMAND';
    }>;
  };
}

let fixtureRoot = '';
let baseManifest: SyntheticCutoverManifest;
let baseConfig: MainAuthorityCutoverReleaseConfig;
let manifestCounter = 0;

async function writeRepinnedConfig(
  candidateManifest: SyntheticCutoverManifest,
): Promise<MainAuthorityCutoverReleaseConfig> {
  manifestCounter += 1;
  const manifestPath = join(fixtureRoot, `synthetic-cutover-manifest-${manifestCounter}.json`);
  const bytes = JSON.stringify(candidateManifest);
  await writeFile(manifestPath, bytes, { flag: 'wx' });
  return {
    manifestPath,
    reviewedManifestSha256: sha256(bytes),
    releaseRoot: fixtureRoot,
    releaseCommit: RELEASE_COMMIT,
  };
}

before(async () => {
  fixtureRoot = await mkdtemp('D:/Ky9-FPT/SmartSiteData/runs/cutover-helper-pins-synthetic-');
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
  const sourceRoot = process.env.CUTOVER_TEST_SOURCE_ROOT;
  assert(sourceRoot, 'Explicit current source root is required');

  const files: Array<{ path: string; sha256: string }> = [];
  for (const relPath of ALL_PINNED_SOURCE_FILES) {
    const target = resolve(fixtureRoot, relPath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(sourceRoot, relPath), target);
    files.push({ path: relPath, sha256: sha256(await readFile(target)) });
  }

  const runtimeFiles: Array<{ path: string; sha256: string }> = [];
  for (const relRuntimePath of ALL_PINNED_RUNTIME_FILES) {
    const runtimeTarget = resolve(runtimeRoot, relRuntimePath);
    runtimeFiles.push({
      path: relRuntimePath,
      sha256: sha256(await readFile(runtimeTarget)),
    });
  }

  const writerFilePin = files.find(
    (entry) => entry.path === 'apps/backend/src/modules/auth/auth.service.ts',
  );
  assert(writerFilePin, 'Expected pinned auth.service.ts entry for synthetic writer review');

  baseManifest = {
    version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1',
    releaseCommit: RELEASE_COMMIT,
    captureProfile: 'NAMED_V2_CONTROLLED_CUTOVER_V1',
    provenance: 'SYNTHETIC_TEST',
    sourceRegistryHash: SOURCE_REGISTRY_HASH,
    files,
    runtimeFiles,
    writerReview: {
      protocol: 'PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1',
      sourceIndexSha256: 'b'.repeat(64),
      methods: 1,
      files: 1,
      exactQuotesAndSourcePinsVerified: true,
      missingOrDuplicateMethods: false,
      completeWriterClosureEstablished: true,
      rows: [
        {
          file: 'modules/auth/auth.service.ts',
          method: 'syntheticFixtureOnly',
          fileSha256: writerFilePin.sha256,
          methodBodySha256: 'c'.repeat(64),
          classification: 'MASKED_COMMAND',
        },
      ],
    },
  };

  baseConfig = await writeRepinnedConfig(baseManifest);
});

test('valid synthetic cutover release fixture with all direct authority helper pins passes verification', async () => {
  const verified = await verifyMainAuthorityCutoverRelease(baseConfig, 'test');
  assert.deepEqual(verified, {
    manifestSha256: baseConfig.reviewedManifestSha256,
    releaseCommit: RELEASE_COMMIT,
    sourceRegistryHash: SOURCE_REGISTRY_HASH,
    provenance: 'SYNTHETIC_TEST',
  });
});

test('cancelled release verification rejects before inspecting any artifact', async () => {
  const controller = new AbortController();
  controller.abort(new Error('TEST_VERIFICATION_CANCELLED'));
  await assert.rejects(
    verifyMainAuthorityCutoverRelease(baseConfig, 'test', controller.signal),
    /TEST_VERIFICATION_CANCELLED/,
  );
});

for (const helperSourcePath of DIRECT_AUTHORITY_HELPER_SOURCE_FILES) {
  test(`dropping helper source pin ${helperSourcePath} is rejected as incomplete cutover release pins`, async () => {
    const configWithoutHelperSource = await writeRepinnedConfig({
      ...baseManifest,
      files: baseManifest.files.filter((entry) => entry.path !== helperSourcePath),
    });
    await assert.rejects(
      verifyMainAuthorityCutoverRelease(configWithoutHelperSource, 'test'),
      /Incomplete cutover release pins/,
    );
  });
}

for (const helperRuntimePath of DIRECT_AUTHORITY_HELPER_RUNTIME_FILES) {
  test(`dropping helper runtime pin ${helperRuntimePath} is rejected as incomplete loaded runtime pins`, async () => {
    const configWithoutHelperRuntime = await writeRepinnedConfig({
      ...baseManifest,
      runtimeFiles: baseManifest.runtimeFiles.filter((entry) => entry.path !== helperRuntimePath),
    });
    await assert.rejects(
      verifyMainAuthorityCutoverRelease(configWithoutHelperRuntime, 'test'),
      /Incomplete loaded runtime pins/,
    );
  });
}

test('tampering any included direct authority helper source file on disk is rejected by release verification', async () => {
  for (const helperSourcePath of DIRECT_AUTHORITY_HELPER_SOURCE_FILES) {
    const targetPath = resolve(fixtureRoot, helperSourcePath);
    const originalBytes = await readFile(targetPath);
    try {
      await writeFile(targetPath, Buffer.concat([originalBytes, Buffer.from('\n// tampered\n')]));
      await assert.rejects(
        verifyMainAuthorityCutoverRelease(baseConfig, 'test'),
        /Cutover release bytes mismatch or exceed budget/,
      );
    } finally {
      await writeFile(targetPath, originalBytes);
    }
  }
  const restored = await verifyMainAuthorityCutoverRelease(baseConfig, 'test');
  assert.equal(restored.manifestSha256, baseConfig.reviewedManifestSha256);
});
