import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import * as runtime from './smartsite-runtime-lib.mjs';

import {
  buildAiEnvironment,
  buildHiddenLaunchOptions,
  buildTapoRtspUrl,
  buildWindowsProcessInspectionScript,
  decideStart,
  loadRuntimeConfig,
  parseCredentialDocument,
  parseRuntimeArguments,
  processIdentityMatches,
  redactSensitiveText,
  selectChildEnvironment,
  splitAiEnvironments,
  validateRuntimeInputs,
} from './smartsite-runtime-lib.mjs';

const execFileAsync = promisify(execFile);

test('uses the configured Backend URL for the browser build despite inherited Compose values', () => {
  const inherited = { PATH: 'safe-path', SMARTSITE_WEB_API_URL: 'http://localhost:3000' };
  const environment = runtime.buildComposeEnvironment({
    baseEnv: inherited,
    backendUrl: 'http://127.0.0.1:3000',
    evidenceRoot: 'D:/SmartSiteData/evidence',
    cameraId: 'camera-uuid',
    serviceToken: 'synthetic-token',
  });
  assert.equal(environment.SMARTSITE_WEB_API_URL, 'http://127.0.0.1:3000');
  assert.equal(environment.EVIDENCE_LOCAL_HOST_ROOT, 'D:/SmartSiteData/evidence');
  assert.equal(environment.AI_CONFIGURATION_CAMERA_IDS, 'camera-uuid');
  assert.equal(environment.SMARTSITE_AI_SERVICE_TOKEN, 'synthetic-token');
  assert.equal(environment.PATH, inherited.PATH);
  assert.equal(inherited.SMARTSITE_WEB_API_URL, 'http://localhost:3000');
});

test('accepts the argument separator passed through by pnpm scripts', () => {
  assert.deepEqual(parseRuntimeArguments(['--', 'status', '--config', 'D:/runtime/control.json']), {
    command: 'status',
    source: undefined,
    configPath: 'D:/runtime/control.json',
    build: false,
  });
  assert.equal(parseRuntimeArguments(['--', 'start', '--source', 'mp4']).command, 'start');
});

test('accepts only the supported commands and named source profiles', () => {
  assert.deepEqual(
    parseRuntimeArguments([
      'start',
      '--source',
      'mp4',
      '--config',
      'D:/SmartSiteData/runtime/control.json',
    ]),
    {
      command: 'start',
      source: 'mp4',
      configPath: 'D:/SmartSiteData/runtime/control.json',
      build: false,
    },
  );
  assert.deepEqual(parseRuntimeArguments(['status', '--config', 'runtime.json']), {
    command: 'status',
    source: undefined,
    configPath: 'runtime.json',
    build: false,
  });
  assert.throws(
    () => parseRuntimeArguments(['start', '--source', 'rtsp://admin:secret@camera/stream']),
    /source must be one of mp4, laptop, tapo/i,
  );
});

test('redacts credentials, authorization and token values from operator output', () => {
  const text = [
    'opening rtsp://operator:camera-password@192.168.1.54:554/stream1',
    'opening rtsps://operator:secure-password@camera.example/stream1',
    'Authorization: Bearer top-secret-token',
    'SMARTSITE_AI_BACKEND_SERVICE_TOKEN=top-secret-token',
    'password=hunter2',
    'Password: another-secret',
    'camera healthy',
  ].join('\n');

  const redacted = redactSensitiveText(text);

  assert.equal(redacted.includes('camera-password'), false);
  assert.equal(redacted.includes('top-secret-token'), false);
  assert.equal(redacted.includes('hunter2'), false);
  assert.equal(redacted.includes('another-secret'), false);
  assert.equal(redacted.includes('secure-password'), false);
  assert.match(redacted, /rtsp:\/\/<redacted>@192\.168\.1\.54:554\/stream1/);
  assert.match(redacted, /camera healthy/);
});

test('launches child processes without a shell or visible Windows console', () => {
  const options = buildHiddenLaunchOptions({
    cwd: 'D:/Ky9-FPT/SmartSite/repos/smartsite-ai',
    env: { SAFE_VALUE: 'present' },
    stdoutFd: 8,
    stderrFd: 9,
  });

  assert.equal(options.cwd, 'D:/Ky9-FPT/SmartSite/repos/smartsite-ai');
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(options.detached, true);
  assert.deepEqual(options.stdio, ['ignore', 8, 9]);
  assert.equal(options.env.SAFE_VALUE, 'present');
});

test('start is idempotent for the same live source and rejects a conflicting source', () => {
  const state = {
    source: 'mp4',
    processes: {
      aiApi: { pid: 101 },
      aiSource: { pid: 102 },
    },
  };
  const alive = (pid) => pid === 101 || pid === 102;

  assert.deepEqual(decideStart(state, 'mp4', alive), { action: 'already-running' });
  assert.throws(() => decideStart(state, 'laptop', alive), /stop the mp4 runtime first/i);
  assert.deepEqual(
    decideStart(state, 'mp4', () => false),
    { action: 'replace-stale-state' },
  );
  assert.deepEqual(
    decideStart(state, 'mp4', (pid) => pid === 101),
    {
      action: 'restart-source',
    },
  );
});

test('loads a local config that contains paths and rejects embedded secret values', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'smartsite-runtime-test-'));
  try {
    const configPath = path.join(directory, 'runtime.json');
    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: '1',
        dataRoot: path.join(directory, 'data'),
        aiRepo: path.join(directory, 'smartsite-ai'),
        pythonPath: path.join(directory, 'python.exe'),
        demoConfigurationPath: path.join(directory, 'demo.json'),
        modelSpecPath: path.join(directory, 'model.json'),
        evidenceRoot: path.join(directory, 'evidence'),
        sourceManifests: {
          mp4: path.join(directory, 'mp4.json'),
          laptop: path.join(directory, 'laptop.json'),
          tapo: path.join(directory, 'tapo.json'),
        },
        tapoCredentialPath: path.join(directory, 'tapo-credentials.txt'),
        backendServiceCredentialPath: path.join(directory, 'backend-service-token.txt'),
      }),
    );

    const config = await loadRuntimeConfig(configPath);
    assert.equal(config.schemaVersion, '1');
    assert.equal(config.sourceManifests.mp4, path.join(directory, 'mp4.json'));

    await writeFile(
      configPath,
      JSON.stringify({
        schemaVersion: '1',
        dataRoot: directory,
        aiRepo: directory,
        pythonPath: 'python',
        demoConfigurationPath: 'demo.json',
        modelSpecPath: 'model.json',
        evidenceRoot: 'evidence',
        sourceManifests: { mp4: 'mp4.json', laptop: 'laptop.json', tapo: 'tapo.json' },
        tapoCredentialPath: 'tapo.txt',
        backendServiceCredentialPath: 'backend-token.txt',
        password: 'must-not-be-here',
      }),
    );
    await assert.rejects(() => loadRuntimeConfig(configPath), /must not contain secret values/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('parses local credential references and safely builds the Tapo RTSP source', () => {
  const credentials = parseCredentialDocument(
    ['Username: camera user', 'Password: p@ss/word', 'Host: 192.168.1.54', 'Stream: stream1'].join(
      '\n',
    ),
    ['Username', 'Password', 'Host', 'Stream'],
  );

  assert.equal(
    buildTapoRtspUrl(credentials),
    'rtsp://camera%20user:p%40ss%2Fword@192.168.1.54:554/stream1',
  );
  assert.throws(
    () => buildTapoRtspUrl({ ...credentials, Host: '192.168.1.54/path' }),
    /host is invalid/i,
  );
});

test('builds a YOLO11s child environment without putting secrets in arguments or state', () => {
  const environment = buildAiEnvironment({
    baseEnv: { PATH: 'safe-path' },
    serviceToken: 'local-token',
    backendUrl: 'http://127.0.0.1:3000',
    aiRepo: 'D:/SmartSite/smartsite-ai',
    modelSpec: {
      artifactId: 'smartsite-yolo11s-ppe-local-trained',
      version: 'yolo11s-ppe-test',
      modelFamily: 'yolo11s',
      artifactPath: 'D:/SmartSiteData/models/best.pt',
      sha256: 'a'.repeat(64),
      sourceUrl: 'https://github.com/smartsite-sep490/smartsite-ai',
      license: 'AGPL-3.0-only',
      classMap: { 0: 'Person', 1: 'Hardhat' },
      confidenceThreshold: 0.25,
      device: 'cuda:0',
    },
    demoConfiguration: {
      cameraExternalId: 'CAM-DEMO-01',
      ppeRegionId: 'ppe-region-id',
    },
    sourceManifest: {
      cameras: [{ source: { kind: 'path', path: 'D:/SmartSiteData/demo.mp4' } }],
    },
    classMapPath: 'D:/SmartSiteData/runtime/control/class-map.json',
    regionConfigurationPath: 'D:/SmartSiteData/runtime/control/region.json',
  });

  assert.equal(environment.PYTHONPATH, 'D:/SmartSite/smartsite-ai/src');
  assert.equal(environment.SMARTSITE_AI_BACKEND_SERVICE_TOKEN, 'local-token');
  assert.equal(environment.SMARTSITE_AI_REALTIME_MODEL_FAMILY, 'yolo11s');
  assert.equal(environment.SMARTSITE_AI_REALTIME_SOURCE, 'D:/SmartSiteData/demo.mp4');
  assert.equal(environment.SMARTSITE_AI_REALTIME_CAMERA_EXTERNAL_ID, 'CAM-DEMO-01');
  assert.equal(environment.SMARTSITE_AI_REALTIME_PPE_REGION_ID, 'ppe-region-id');

  assert.throws(
    () =>
      buildAiEnvironment({
        baseEnv: {},
        serviceToken: 'local-token',
        backendUrl: 'http://127.0.0.1:3000',
        aiRepo: 'D:/SmartSite/smartsite-ai',
        modelSpec: {
          artifactId: 'artifact',
          version: 'version',
          modelFamily: 'yolo11s',
          artifactPath: 'D:/model.pt',
          sha256: 'a'.repeat(64),
          sourceUrl: 'https://example.test/model',
          license: 'test',
          confidenceThreshold: 0.25,
          device: 'cpu',
        },
        demoConfiguration: { cameraExternalId: 'camera', ppeRegionId: 'region' },
        sourceManifest: {
          cameras: [{ source: { kind: 'path', path: 'rtsp://user:secret@camera/stream' } }],
        },
        classMapPath: 'D:/class-map.json',
        regionConfigurationPath: 'D:/region.json',
      }),
    /credentialed camera sources must use an environment reference/i,
  );
});

test('locks the selected source manifest to the same model and Backend camera configuration', () => {
  const config = { modelSpecPath: 'D:/SmartSiteData/runtime/model.json' };
  const demo = {
    cameraId: 'camera-uuid',
    cameraExternalId: 'CAM-DEMO-01',
    ppeRegionId: 'ppe-region-uuid',
  };
  const manifest = {
    schemaVersion: '1',
    modelSpec: 'D:/SmartSiteData/runtime/model.json',
    cameras: [
      {
        cameraId: 'camera-uuid',
        cameraExternalId: 'CAM-DEMO-01',
        ppeRegionId: 'ppe-region-uuid',
        source: { kind: 'path', path: 'D:/demo.mp4' },
      },
    ],
  };

  assert.equal(validateRuntimeInputs(config, demo, manifest), manifest);
  assert.throws(
    () =>
      validateRuntimeInputs(config, demo, {
        ...manifest,
        cameras: [{ ...manifest.cameras[0], cameraId: 'different-camera' }],
      }),
    /cameraId does not match/i,
  );
  assert.throws(
    () => validateRuntimeInputs(config, demo, { ...manifest, modelSpec: 'D:/other.json' }),
    /modelSpec does not match/i,
  );
});

test('matches a tracked PID only when its creation time and command fingerprint are unchanged', () => {
  const expected = { createdAt: '2026-09-30T01:02:03.000Z', commandSha256: 'a'.repeat(64) };
  assert.equal(processIdentityMatches(expected, { ...expected }), true);
  assert.equal(
    processIdentityMatches(expected, { ...expected, createdAt: '2026-09-30T01:03:03.000Z' }),
    false,
  );
  assert.equal(
    processIdentityMatches(expected, { ...expected, commandSha256: 'b'.repeat(64) }),
    false,
  );
  assert.equal(processIdentityMatches(undefined, expected), false);
});

test('failed cleanup requires an explicit stop before another start even when AI PIDs exited', () => {
  assert.throws(
    () =>
      decideStart({ stage: 'cleanup-required', source: 'mp4', processes: {} }, 'mp4', () => false),
    /cleanup.*stop/i,
  );
  assert.throws(
    () =>
      decideStart(
        {
          stage: 'cleanup-required',
          source: 'mp4',
          processes: { aiApi: { pid: 101 }, aiSource: { pid: 102 } },
        },
        'mp4',
        () => true,
      ),
    /cleanup.*stop/i,
  );
});

test(
  'Windows process inspection script returns a real creation timestamp for the current process',
  { skip: process.platform !== 'win32' },
  async () => {
    const script = buildWindowsProcessInspectionScript(process.pid);
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 10_000 },
    );
    const inspected = JSON.parse(stdout);

    assert.equal(typeof inspected.createdAt, 'string');
    assert.notEqual(inspected.createdAt, '');
    assert.equal(typeof inspected.commandLine, 'string');
    assert.notEqual(inspected.commandLine, '');
  },
);

test('allowlists child environment keys and keeps exclusive sources out of the realtime API', () => {
  const selected = selectChildEnvironment({
    PATH: 'safe-path',
    SYSTEMROOT: 'C:/Windows',
    CUDA_PATH: 'C:/CUDA',
    SMARTSITE_AI_STALE_SECRET: 'must-not-pass',
    UNRELATED_SECRET: 'must-not-pass',
  });
  assert.deepEqual(selected, {
    PATH: 'safe-path',
    SYSTEMROOT: 'C:/Windows',
    CUDA_PATH: 'C:/CUDA',
  });

  const combined = {
    ...selected,
    SMARTSITE_AI_REALTIME_SOURCE: 'rtsp://<credentialed-source>',
    SMARTSITE_AI_CAMERA_TAPO_SOURCE: 'rtsp://<credentialed-source>',
    SMARTSITE_AI_BACKEND_SERVICE_TOKEN: 'local-token',
  };
  const split = splitAiEnvironments(combined, 'tapo', {
    cameras: [{ source: { kind: 'env', name: 'SMARTSITE_AI_CAMERA_TAPO_SOURCE' } }],
  });
  assert.equal(split.worker.SMARTSITE_AI_REALTIME_SOURCE, 'rtsp://<credentialed-source>');
  assert.equal(split.api.SMARTSITE_AI_REALTIME_SOURCE, undefined);
  assert.equal(split.api.SMARTSITE_AI_CAMERA_TAPO_SOURCE, undefined);
  assert.equal(split.api.SMARTSITE_AI_BACKEND_SERVICE_TOKEN, 'local-token');
});

test('keeps durable ingestion with the worker while diagnostic preview stays read-only', () => {
  for (const profile of ['mp4', 'laptop', 'tapo']) {
    const combined = {
      SMARTSITE_AI_BACKEND_INGESTION_URL: 'http://127.0.0.1:3000',
      SMARTSITE_AI_BACKEND_SERVICE_TOKEN: 'local-token',
      SMARTSITE_AI_REALTIME_SOURCE: 'D:/sample.mp4',
    };
    const split = splitAiEnvironments(combined, profile, {
      cameras: [{ source: { kind: 'path', value: 'D:/sample.mp4' } }],
    });
    assert.equal(
      split.worker.SMARTSITE_AI_BACKEND_INGESTION_URL,
      combined.SMARTSITE_AI_BACKEND_INGESTION_URL,
    );
    assert.equal(split.worker.SMARTSITE_AI_BACKEND_SERVICE_TOKEN, 'local-token');
    // An explicit empty value also overrides an ingestion URL in the AI .env.
    assert.equal(split.api.SMARTSITE_AI_BACKEND_INGESTION_URL, '');
    assert.equal(split.api.SMARTSITE_AI_BACKEND_SERVICE_TOKEN, 'local-token');
    assert.equal(combined.SMARTSITE_AI_BACKEND_INGESTION_URL, 'http://127.0.0.1:3000');
  }
});
