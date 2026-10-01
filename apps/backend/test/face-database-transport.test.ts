import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { HttpFaceEnrollmentAdapter } from '../src/modules/workforce/face-enrollment.adapter.js';

test('DB template transport requires encrypted enrollment and keeps candidates in the authenticated service request', async () => {
  const ciphertext = 'gAAAA' + 'a'.repeat(150) + '==';
  let includeTemplate = true;
  let captured: { authorization?: string; body?: unknown } = {};
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += String(chunk);
    captured = {
      authorization: request.headers.authorization,
      body: body ? (JSON.parse(body) as unknown) : null,
    };
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/complete'))
      response.end(
        JSON.stringify({
          status: 'ENROLLED',
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
    includeTemplate = false;
    await assert.rejects(adapter.completeEnrollment('synthetic-session'));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
