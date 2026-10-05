import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../src/config/environment.js';
import {
  SafetyUploadService,
  validateSafetyJpeg,
} from '../src/modules/safety/safety-upload.service.js';
import { command } from '../src/common/configuration/commands.js';
import {
  CreateIncidentDto,
  SubmitResultDto,
} from '../src/modules/safety/safety-workflow.commands.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import type { SafetyEvidenceEntity } from '../src/database/entities/safety-workflow.entity.js';
const error = (code: string) => (e: unknown) =>
  e instanceof PublicHttpException && e.publicPayload.code === code;
const bytes = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
test('MF08 boundaries reject forged JPEG, excess size, extra actor fields, naive time and invalid version', () => {
  assert.throws(
    () => validateSafetyJpeg({ buffer: bytes, mimetype: 'image/png', size: bytes.length }),
    error('UNSUPPORTED_MEDIA_TYPE'),
  );
  assert.throws(
    () => validateSafetyJpeg({ buffer: Buffer.from('not jpeg'), mimetype: 'image/jpeg', size: 8 }),
    error('UNSUPPORTED_MEDIA_TYPE'),
  );
  assert.throws(
    () =>
      validateSafetyJpeg({ buffer: Buffer.alloc(1048577), mimetype: 'image/jpeg', size: 1048577 }),
    error('PAYLOAD_TOO_LARGE'),
  );
  assert.throws(
    () =>
      command(SubmitResultDto, {
        commandId: '11111111-1111-4111-8111-111111111111',
        expectedVersion: 0,
        resultDescription: 'x',
      }),
    error('VALIDATION_FAILED'),
  );
  const value = {
    commandId: '11111111-1111-4111-8111-111111111111',
    title: 'Incident',
    description: 'Hazard',
    severity: 'HIGH',
    occurredAt: '2026-10-02T10:00:00Z',
    alertIds: [],
  };
  assert.throws(
    () => command(CreateIncidentDto, { ...value, actorId: 'forged' }),
    error('VALIDATION_FAILED'),
  );
  assert.throws(
    () => command(CreateIncidentDto, { ...value, occurredAt: '2026-10-02T10:00:00' }),
    error('VALIDATION_FAILED'),
  );
  assert.equal(
    command(SubmitResultDto, {
      commandId: value.commandId,
      expectedVersion: '1',
      resultDescription: ' done ',
    }).expectedVersion,
    1,
  );
});
test('MF08 private store verifies digest, fails unavailable and refuses path traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mf08-upload-'));
  const store = new SafetyUploadService(
    new ConfigService(validateEnvironment({ NODE_ENV: 'test', SAFETY_UPLOAD_LOCAL_ROOT: root })),
  );
  try {
    const saved = await store.save({ buffer: bytes, mimetype: 'image/jpeg', size: bytes.length });
    const evidence = { ...saved } as SafetyEvidenceEntity;
    assert.deepEqual(await store.read(evidence), bytes);
    await writeFile(
      join(root, saved.storageKey),
      Buffer.from([255, 216, 255, 225, 0, 2, 255, 217]),
    );
    await assert.rejects(store.read(evidence), error('SERVICE_UNAVAILABLE'));
    await unlink(join(root, saved.storageKey));
    await assert.rejects(store.read(evidence), error('SERVICE_UNAVAILABLE'));
    await assert.rejects(
      store.read({ ...evidence, storageKey: '../external.jpg' }),
      error('SERVICE_UNAVAILABLE'),
    );
    const unconfigured = new SafetyUploadService(
      new ConfigService(validateEnvironment({ NODE_ENV: 'test' })),
    );
    await assert.rejects(
      unconfigured.save({ buffer: bytes, mimetype: 'image/jpeg', size: bytes.length }),
      error('SERVICE_UNAVAILABLE'),
    );
    assert.equal(
      validateEnvironment({ SAFETY_UPLOAD_LOCAL_ROOT: resolve('private-test') })
        .SAFETY_UPLOAD_LOCAL_ROOT,
      resolve('private-test'),
    );
    for (const path of ['', ' ', 'relative/path'])
      assert.throws(() => validateEnvironment({ SAFETY_UPLOAD_LOCAL_ROOT: path }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
