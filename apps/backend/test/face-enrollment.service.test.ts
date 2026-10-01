import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { FaceEnrollmentService } from '../src/modules/workforce/face-enrollment.service.js';

const actor = {
  id: '00000000-0000-4000-8000-000000000001',
  mustChangePassword: false,
  roleAssignments: [],
};
const sessionId = '00000000-0000-4000-8000-000000000002';

function service() {
  return new FaceEnrollmentService(undefined as never, undefined as never);
}

test('FaceEnrollmentService rejects missing or malformed face samples before any adapter call', async () => {
  await assert.rejects(
    service().submitSample(actor, sessionId, undefined),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED',
  );
  await assert.rejects(
    service().submitSample(actor, sessionId, {
      mimetype: 'image/png',
      size: 3,
      buffer: Buffer.from([1, 2, 3]),
    }),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'UNSUPPORTED_MEDIA_TYPE',
  );
  await assert.rejects(
    service().submitSample(actor, sessionId, {
      mimetype: 'image/jpeg',
      size: 4,
      buffer: Buffer.from([1, 2, 3]),
    }),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED',
  );
});
