import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { HttpFaceEnrollmentAdapter } from '../src/modules/workforce/face-enrollment.adapter.js';

test('DB template transport requires encrypted enrollment and keeps candidates in the authenticated service request', async () => {
  const ciphertext = 'gAAAA' + 'a'.repeat(150) + '==';
  let includeTemplate = true;
  let captured: { authorization?: string; body?: unknown } = {};
  let qualityReason = 'FACE_QUALITY_ACCEPTED';
  let qualityStatus = 'UNKNOWN';
  let completionStatus = 'ENROLLED';
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    captured = {
      authorization: request.headers.authorization,
      body: body ? (JSON.parse(body) as unknown) : null,
    };
    response.setHeader('content-type', 'application/json');
    if ((captured.body as { enrollmentTarget?: string } | null)?.enrollmentTarget) {
      response.end(JSON.stringify({ status: qualityStatus, reasonCode: qualityReason }));
    } else if (request.url?.endsWith('/complete'))
      response.end(
        JSON.stringify({
          status: completionStatus,
          reasonCode: qualityReason,
          modelVersion: 'synthetic-v1',
          profileReference: 'fp_demo',
          ...(includeTemplate ? { encryptedTemplate: ciphertext } : {}),
        }),
      );
    else
      response.end(
        JSON.stringify({
          status: 'MATCHED',
          modelVersion: 'synthetic-v1',
          candidateProfileReference: 'fp_demo',
          scoreBand: 'HIGH',
        }),
      );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const adapter = new HttpFaceEnrollmentAdapter(
    `http://127.0.0.1:${address.port}`,
    'synthetic-service-token',
  );
  try {
    const result = await adapter.completeEnrollment('synthetic-session');
    assert.equal(result.encryptedTemplate, ciphertext);
    assert.equal(captured.authorization, 'Bearer synthetic-service-token');
    const templates = [{ profileReferenceHash: 'a'.repeat(64), encryptedTemplate: ciphertext }];
    const jpeg = Buffer.from('synthetic-jpeg');
    const match = await adapter.verify({
      verificationId: 'synthetic-verification',
      jpeg,
      templates,
    });
    assert.equal(match.status, 'MATCHED');
    assert.deepEqual(captured.body, { jpegBase64: jpeg.toString('base64'), templates });
    assert.equal('encryptedTemplate' in match, false);
    assert.deepEqual(await adapter.assessSampleQuality(jpeg, 'left'), {
      status: 'ACCEPTED',
      reasonCode: 'FACE_QUALITY_ACCEPTED',
    });
    assert.deepEqual(captured.body, {
      jpegBase64: jpeg.toString('base64'),
      templates: [],
      enrollmentTarget: 'left',
    });
    qualityStatus = 'QUALITY_FAILED';
    qualityReason = 'FACE_BLURRY';
    assert.deepEqual(await adapter.assessSampleQuality(jpeg, 'right'), {
      status: 'QUALITY_FAILED',
      reasonCode: 'FACE_BLURRY',
    });
    qualityStatus = 'UNKNOWN';
    qualityReason = 'NO_ENROLLMENTS';
    assert.equal((await adapter.assessSampleQuality(jpeg, 'front')).status, 'AI_UNAVAILABLE'); // old service cannot acknowledge pose quality
    completionStatus = 'QUALITY_FAILED';
    qualityReason = 'FACE_POSE_LEFT_REQUIRED';
    await assert.rejects(adapter.completeEnrollment('synthetic-session'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /góc trái/);
      assert.equal(error.message.includes('one clear face'), false);
      return true;
    });
    qualityReason = 'service-secret-untrusted';
    await assert.rejects(adapter.completeEnrollment('synthetic-session'), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes('service-secret-untrusted'), false);
      return true;
    });
    completionStatus = 'ENROLLED';
    includeTemplate = false;
    await assert.rejects(adapter.completeEnrollment('synthetic-session'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
