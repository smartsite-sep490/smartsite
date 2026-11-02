import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/environment.js';

test('camera authoring origins default deny and require exact configured HTTP origins', () => {
  assert.deepEqual(validateEnvironment({ NODE_ENV: 'test' }).SMARTSITE_AI_PREVIEW_SOURCES, {});
  assert.deepEqual(
    validateEnvironment({
      NODE_ENV: 'test',
      SMARTSITE_AI_PREVIEW_SOURCES: '{"camera-a":"http://127.0.0.1:8001"}',
    }).SMARTSITE_AI_PREVIEW_SOURCES,
    { 'camera-a': 'http://127.0.0.1:8001' },
  );
  for (const value of [
    '[]',
    'null',
    'bad-json',
    '{"camera-a":"http://user:private-sentinel@example.test"}',
    '{"camera-a":"http://example.test/path"}',
    '{"camera-a":"http://example.test?query"}',
    '{"camera-a":"http://example.test#fragment"}',
    '{"camera-a":"ftp://example.test"}',
  ])
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'test', SMARTSITE_AI_PREVIEW_SOURCES: value }),
      (error: unknown) => error instanceof Error && !error.message.includes('private-sentinel'),
    );
});
