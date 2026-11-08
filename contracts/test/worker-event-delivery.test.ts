import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const path = '../src/worker-event-delivery.js';
const api = await import(path).catch(() => ({}));

test('local wrapper schema resolves only known event versions; session equality remains parser responsibility', () => {
  const read = (name: string) =>
    JSON.parse(readFileSync(new URL(`../schemas/${name}.json`, import.meta.url), 'utf8'));
  const ajv = new Ajv2020.default({ strict: true, allErrors: true });
  addFormats.default(ajv);
  for (const version of ['v1', 'v1.1', 'v1.2', 'v1.3', 'v1.4'])
    ajv.addSchema(read(`${version}/technical-observation-event`));
  ajv.addSchema(read('v1/worker-event-delivery-context'));
  const validate = ajv.compile(read('v1/worker-event-delivery-envelope'));
  assert.equal(validate({ schemaVersion: '1.0.0', context, event }), true);
  assert.equal(
    validate({ schemaVersion: '1.0.0', context: { ...context, secret: 'extra' }, event }),
    false,
  );
  assert.equal(
    validate({ schemaVersion: '1.0.0', context, event: { ...event, schemaVersion: '99.0.0' } }),
    false,
  );
  const mismatch = {
    schemaVersion: '1.0.0',
    context,
    event: { ...event, streamSessionId: context.cameraId },
  };
  assert.equal(validate(mismatch), true);
  assert.equal(api.parseWorkerEventDeliveryEnvelope(mismatch), null);
});
const context = {
  schemaVersion: '1.0.0',
  cameraId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  workerGenerationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  streamSessionId: '22222222-2222-4222-8222-222222222222',
  configurationVersion: 2,
  bundleSha256: 'a'.repeat(64),
  viewRevision: 1,
  receiptCommandId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  sourceKind: 'LIVE',
};
const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  schemaVersion: '1.0.0',
  cameraExternalId: 'CAM-GATE-01',
  streamSessionId: context.streamSessionId,
  capturedAt: '2026-09-27T10:00:00Z',
  frameDimensions: { width: 1280, height: 720 },
  observations: [
    {
      type: 'ZONE_ENTRY',
      trackId: 7,
      regionId: '33333333-3333-4333-8333-333333333333',
      geometryVersion: 1,
      confidence: 0.9,
    },
  ],
  evidence: [],
};

test('bound envelope preserves raw event and returns detached context/event copies', () => {
  assert.equal(typeof api.parseWorkerEventDeliveryEnvelope, 'function');
  const envelope = { schemaVersion: '1.0.0', context, event };
  assert.deepEqual(api.parseWorkerEventDeliveryEnvelope(envelope), envelope);
  const parsed = api.parseWorkerEventDeliveryEnvelope(envelope);
  assert.notEqual(parsed.context, context);
  assert.notEqual(parsed.event, event);
});

test('strict context/envelope rejects scope shape mistakes, extras and session mismatch', () => {
  assert.equal(typeof api.parseWorkerEventDeliveryContext, 'function');
  for (const wrong of [
    null,
    [],
    {},
    { ...context, secret: 'never-store' },
    { ...context, configurationVersion: true },
    { ...context, configurationVersion: 0 },
    { ...context, configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...context, viewRevision: '1' },
    { ...context, receiptCommandId: null },
    { ...context, sourceKind: 'UNKNOWN' },
    { ...context, cameraId: 'bad' },
    { ...context, bundleSha256: 'A'.repeat(64) },
    { ...context, schemaVersion: '2.0.0' },
    { ...context, cameraId: context.cameraId + '\n' },
    { ...context, bundleSha256: context.bundleSha256 + '\n' },
  ])
    assert.equal(api.parseWorkerEventDeliveryContext(wrong), null);
  for (const wrong of [
    { schemaVersion: '1.0.0', context, event, secret: 'extra' },
    { schemaVersion: '1.0.0', context, event: { ...event, streamSessionId: context.cameraId } },
    { schemaVersion: '1.0.0', context, event: { ...event, observations: [] } },
    { schemaVersion: '1.0.0', context, event: { ...event, extra: 'unsupported' } },
  ])
    assert.equal(api.parseWorkerEventDeliveryEnvelope(wrong), null);
});

test('binding digest covers original event hash and every context dimension', () => {
  assert.equal(typeof api.computeWorkerEventBindingHash, 'function');
  const digest = api.computeWorkerEventBindingHash('f'.repeat(64), context);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(api.computeWorkerEventBindingHash('e'.repeat(64), context), digest);
  assert.notEqual(
    api.computeWorkerEventBindingHash('f'.repeat(64), { ...context, sourceKind: 'REPLAY' }),
    digest,
  );
  assert.throws(() => api.computeWorkerEventBindingHash('bad', context));
  assert.throws(() => api.computeWorkerEventBindingHash('f'.repeat(64) + '\n', context));
});

test('strict envelope rejects fields that JSON serialization would silently remove', () => {
  for (const extra of [{ secret: undefined }, { [Symbol('extra')]: true }])
    assert.equal(
      api.parseWorkerEventDeliveryEnvelope({
        schemaVersion: '1.0.0',
        context: { ...context, ...extra },
        event,
      }),
      null,
    );
  assert.equal(
    api.parseWorkerEventDeliveryEnvelope({
      schemaVersion: '1.0.0',
      context,
      event: { ...event, extra: undefined },
    }),
    null,
  );
});
