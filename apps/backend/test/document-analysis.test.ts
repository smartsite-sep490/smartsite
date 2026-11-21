import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestConfig } from './support/config.js';
import { DocumentAnalysisService } from '../src/modules/workforce/documents/document-analysis.service.js';

const key = 'sk-synthetic-key';
const bytes = Buffer.from('synthetic document');
const mediaType = 'application/pdf';
const fields = {
  detectedKind: 'HEALTH_CERTIFICATE',
  issuedOn: '2026-02-28',
  expiresOn: null,
  nationalId: '000000000001',
};
const service = new DocumentAnalysisService(createTestConfig({ OPENAI_API_KEY: key }));

function completion(content: unknown, status = 'completed') {
  return Response.json({ status, output: [{ type: 'message', content: [content] }] });
}

test('sends original validated upload bytes in a single structured Responses request', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () =>
    completion({ type: 'output_text', text: JSON.stringify(fields) }),
  );
  for (const mime of [mediaType, 'image/jpeg', 'image/png']) {
    assert.deepEqual(await service.analyze(bytes, mime), { status: 'COMPLETE', ...fields });
    const [url, init] = request.mock.calls.at(-1)!.arguments as Parameters<typeof fetch>;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ' + key);
    const dataUrl = 'data:' + mime + ';base64,' + bytes.toString('base64');
    const expected =
      mime === mediaType
        ? { type: 'input_file', filename: 'document.pdf', file_data: dataUrl, detail: 'high' }
        : { type: 'input_image', image_url: dataUrl, detail: 'high' };
    assert.partialDeepStrictEqual(JSON.parse(String(init?.body)), {
      model: 'gpt-4.1-mini',
      store: false,
      input: [{ role: 'user', content: [expected] }],
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['detectedKind', 'issuedOn', 'expiresOn', 'nationalId'],
          },
        },
      },
    });
  }
  assert.equal(request.mock.callCount(), 3);
});

test('omits optional analysis without a server key', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('OpenAI is disabled');
  });
  const disabled = new DocumentAnalysisService(createTestConfig());
  assert.equal(await disabled.analyze(bytes, mediaType), null);
  assert.equal(request.mock.callCount(), 0);
});

test('uses the configured model and leaves the output budget to OpenAI', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () =>
    completion({ type: 'output_text', text: JSON.stringify(fields) }),
  );
  const configured = new DocumentAnalysisService(
    createTestConfig({ OPENAI_API_KEY: key, WORKER_DOCUMENT_OPENAI_MODEL: 'gpt-6-luna' }),
  );

  assert.deepEqual(await configured.analyze(bytes, mediaType), { status: 'COMPLETE', ...fields });
  assert.equal(request.mock.callCount(), 1);
  const [, init] = request.mock.calls[0]!.arguments as Parameters<typeof fetch>;
  const body = JSON.parse(String(init?.body));
  assert.equal(body.model, 'gpt-6-luna');
  assert.equal(Object.hasOwn(body, 'max_output_tokens'), false);
});

test('returns unavailable on timeout after one attempt with a configured 30-second default deadline', async (t) => {
  const expired = AbortSignal.abort(new DOMException('Synthetic timeout', 'TimeoutError'));
  const deadline = t.mock.method(AbortSignal, 'timeout', () => expired);
  const request = t.mock.method(
    globalThis,
    'fetch',
    async (_url: URL | RequestInfo, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      throw new Error('Missing abort signal');
    },
  );
  assert.deepEqual(await service.analyze(bytes, mediaType), { status: 'UNAVAILABLE' });
  assert.equal(request.mock.callCount(), 1);
  assert.equal(request.mock.calls[0]!.arguments[1]?.signal, expired);
  assert.deepEqual(deadline.mock.calls[0]!.arguments, [30_000]);
  const configured = new DocumentAnalysisService(
    createTestConfig({ OPENAI_API_KEY: key, WORKER_DOCUMENT_OPENAI_TIMEOUT_MS: '7500' }),
  );
  assert.deepEqual(await configured.analyze(bytes, mediaType), { status: 'UNAVAILABLE' });
  assert.deepEqual(deadline.mock.calls[1]!.arguments, [7500]);
  assert.equal(request.mock.callCount(), 2);
});

test('refusals, incomplete responses, invalid fields and provider failures remain advisory', async (t) => {
  const invalid = [
    completion({ type: 'refusal', refusal: 'Synthetic refusal' }),
    completion({ type: 'output_text', text: JSON.stringify(fields) }, 'incomplete'),
    completion({ type: 'output_text', text: '{ invalid' }),
    completion({
      type: 'output_text',
      text: JSON.stringify({ ...fields, issuedOn: '2026-02-30' }),
    }),
    completion({ type: 'output_text', text: JSON.stringify({ ...fields, nationalId: '12345' }) }),
    completion({ type: 'output_text', text: JSON.stringify({ ...fields, approval: true }) }),
    new Response('Synthetic error', { status: 429 }),
  ];
  const responses = invalid.values();
  const request = t.mock.method(globalThis, 'fetch', async () => responses.next().value!);
  for (let index = 0; index < invalid.length; index++)
    assert.deepEqual(await service.analyze(bytes, mediaType), { status: 'UNAVAILABLE' });
  assert.equal(request.mock.callCount(), invalid.length);
});
