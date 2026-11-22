import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import type { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { CameraSourceService } from '../src/modules/cameras/camera-source.service.js';
import { resumeAcceptedCameraSource } from '../src/modules/cameras/camera-source-resume.js';
const command = { commandId: 'command', expectedRevision: 3, expectedConfigurationVersion: 12 };
const owner = 'old-owner',
  generation = {
    workerGenerationId: 'new-owner',
    streamSessionId: 'new-session',
    secret: 'private-credential',
    expiresAt: '2026-11-21T01:00:00Z',
  };
const prepared = {
  state: 'PREPARED' as const,
  commandId: command.commandId,
  sourceRevision: 3,
  sourceKind: 'LIVE' as const,
  currentGenerationId: owner,
};
test('resume preserves source revision, rechecks authority, and only returns public host state', async () => {
  const calls: string[] = [];
  const result = await resumeAcceptedCameraSource(command, owner, {
    authorize: async () => {
      calls.push('auth');
    },
    prepare: async () => {
      calls.push('stop');
      return prepared;
    },
    issue: async (id, cmd) => {
      assert.equal(id, owner);
      assert.equal(cmd, command.commandId);
      calls.push('issue');
      return generation;
    },
    commit: async (cmd, issued) => {
      assert.equal(issued.secret, generation.secret);
      calls.push('start');
      return {
        ...prepared,
        state: 'RUNNING',
        commandId: cmd,
        currentGenerationId: issued.workerGenerationId,
      };
    },
  });
  assert.deepEqual(calls, ['auth', 'stop', 'auth', 'issue', 'auth', 'start']);
  assert.equal(result.sourceRevision, 3);
  assert.doesNotMatch(JSON.stringify(result), /private-credential/);
});
test('foreign owner or source revision and revoked caller never start a worker', async () => {
  for (const changed of [{ currentGenerationId: 'foreign' }, { sourceRevision: 4 }]) {
    let issued = 0;
    await assert.rejects(
      resumeAcceptedCameraSource(command, owner, {
        authorize: async () => {},
        prepare: async () => ({ ...prepared, ...changed }),
        issue: async () => {
          issued++;
          return generation;
        },
        commit: async () => {
          throw Error('must not start');
        },
      }),
    );
    assert.equal(issued, 0);
  }
  for (const revokeAt of [2, 3]) {
    let checks = 0,
      starts = 0;
    await assert.rejects(
      resumeAcceptedCameraSource(command, owner, {
        authorize: async () => {
          if (++checks === revokeAt) throw Error('revoked');
        },
        prepare: async () => prepared,
        issue: async () => generation,
        commit: async () => {
          starts++;
          throw Error('must not start');
        },
      }),
      /revoked/,
    );
    assert.equal(starts, 0);
  }
});
test('known running retry never issues again and uncertain commit is never retried', async () => {
  const running = {
    ...prepared,
    state: 'RUNNING' as const,
    currentGenerationId: generation.workerGenerationId,
  };
  let issues = 0,
    commits = 0;
  await resumeAcceptedCameraSource(command, generation.workerGenerationId, {
    authorize: async () => {},
    prepare: async () => running,
    issue: async () => {
      issues++;
      return generation;
    },
    commit: async () => {
      commits++;
      return running;
    },
  });
  assert.equal(issues, 0);
  assert.equal(commits, 0);
  await assert.rejects(
    resumeAcceptedCameraSource(command, owner, {
      authorize: async () => {},
      prepare: async () => prepared,
      issue: async () => generation,
      commit: async () => {
        commits++;
        throw Error('unknown outcome');
      },
    }),
    /unknown outcome/,
  );
  assert.equal(commits, 1);
});

test('resumeAfterSourceGap enforces feature flags, automaticResume camera allowlists, and database availability before remote calls', async () => {
  const site = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const camera = '33333333-3333-4333-8333-333333333333';
  const hostOrigin = 'http://127.0.0.1:62035';
  const basePolicy = {
    profile: {
      wireVersion: '1.7.0',
      routeEpoch: site,
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: [camera],
      clockToleranceMs: 5000,
    },
    pending: {
      pendingTtlMs: 30000,
      maxPendingFrames: 8,
      maxPendingParts: 16,
      maxPendingPayloadBytes: 100000,
    },
    heads: {
      firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
      maxCaptureGapMs: 10000,
      maxSourceSequenceGap: '1',
      maxSegmentRows: 32,
    },
    recovery: {
      intervalMs: 50,
      maxFramesPerCamera: 8,
      automaticResume: { hostId: 'edge', minPersistentMs: 2000, maxStarts: 3 },
    },
    maxRecipients: 8,
  };
  let fetchCalls = 0;
  let dbCalls = 0;
  const fetcher = (async () => {
    fetchCalls++;
    throw new Error('must not fetch when disabled');
  }) as typeof fetch;
  const fakeDb = {
    async query() {
      dbCalls++;
      return [];
    },
  } as unknown as DataSource;

  const makeService = (overrides: Record<string, unknown>, includeDb = true) => {
    const config = new ConfigService<BackendEnvironment, true>({
      NODE_ENV: 'test',
      SMARTSITE_AI_SERVICE_TOKEN: 'a'.repeat(32),
      AI_TRACKED_FRAME_RUNTIME_ENABLED: true,
      SMARTSITE_AI_SOURCE_APPLY_ENABLED: true,
      AI_CONFIGURATION_CAMERA_IDS: [camera],
      SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
        { id: 'edge', label: 'Local host', siteIds: [site], origin: hostOrigin },
      ]),
      AI_TRACKED_FRAME_RUNTIME_POLICY: basePolicy,
      ...overrides,
    });
    const auth = {
      authenticate: async () => {
        throw new Error('unexpected user auth');
      },
    } as unknown as AuthService;
    const cameras = {
      get: async () => {
        throw new Error('unexpected camera lookup');
      },
    } as unknown as CameraConfigurationService;
    return new CameraSourceService(config, auth, cameras, fetcher, includeDb ? fakeDb : undefined);
  };

  const source = { cameraId: camera, generationId: site, streamSessionId: other };
  const cases = [
    makeService({ AI_TRACKED_FRAME_RUNTIME_ENABLED: false }),
    makeService({ SMARTSITE_AI_SOURCE_APPLY_ENABLED: false }),
    makeService({
      AI_TRACKED_FRAME_RUNTIME_POLICY: {
        ...basePolicy,
        recovery: { intervalMs: 50, maxFramesPerCamera: 8 },
      },
    }),
    makeService({ AI_CONFIGURATION_CAMERA_IDS: [other] }),
    makeService({
      AI_TRACKED_FRAME_RUNTIME_POLICY: {
        ...basePolicy,
        profile: { ...basePolicy.profile, allowedCameraIds: [other] },
      },
    }),
    makeService({}, false),
  ];

  for (const service of cases) {
    await assert.rejects(
      service.resumeAfterSourceGap(source, async () => true),
      (err) => (err as { getStatus?: () => number }).getStatus?.() === 503,
    );
  }
  assert.equal(fetchCalls, 0);
  assert.equal(dbCalls, 0);
});
