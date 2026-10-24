import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { validateEnvironment } from '../src/config/environment.js';
import { backendDirectory } from '../src/config/runtime-environment.js';

test('preview upstreams are explicit validated server-only origins', () => {
  const config = validateEnvironment({
    NODE_ENV: 'test',
    SMARTSITE_AI_PREVIEW_SOURCES: '{"camera-a":"http://127.0.0.1:8001"}',
  });
  assert.deepEqual((config as unknown as Record<string, unknown>).SMARTSITE_AI_PREVIEW_SOURCES, {
    'camera-a': 'http://127.0.0.1:8001',
  });
  for (const input of [
    '[]',
    'not-json',
    '{"a":"http://user:fake-secret@localhost"}',
    '{"a":"http://localhost/private"}',
    '{"a":"http://localhost/?token=fake"}',
    '{"a":"file:///D:/image"}',
    '{"a":"http://localhost/#fragment"}',
  ]) {
    assert.throws(() =>
      validateEnvironment({ NODE_ENV: 'test', SMARTSITE_AI_PREVIEW_SOURCES: input }),
    );
  }
});

test('deployment never forwards server AI credentials or a direct AI endpoint into the Web build', () => {
  const infra = path.resolve(backendDirectory, '../../infra');
  for (const file of ['compose.yaml', 'docker/web.Dockerfile']) {
    const source = fs.readFileSync(path.join(infra, file), 'utf8');
    assert.doesNotMatch(source, /VITE_AI_[A-Z_]+/, `${file} exposes obsolete browser AI settings`);
  }
  const compose = fs.readFileSync(path.join(infra, 'compose.yaml'), 'utf8');
  assert.match(compose, /SMARTSITE_AI_BACKEND_SERVICE_TOKEN:/);
  assert.match(compose, /SMARTSITE_AI_SERVICE_TOKEN:/);
});
