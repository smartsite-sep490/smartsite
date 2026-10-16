import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server } from 'node:http';
import { BoundedExpressAdapter } from '../src/common/http/bounded-express-adapter.js';

test('default HTTP drain disconnects stalled connections with time left for final teardown', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const adapter = new BoundedExpressAdapter();
  let disconnected = 0;
  adapter.setHttpServer({ closeAllConnections: () => disconnected++ } as unknown as Server);
  adapter.beforeClose();

  t.mock.timers.tick(26_999);
  assert.equal(disconnected, 0);
  assert.equal(adapter.drainDeadlineExceeded, false);
  t.mock.timers.tick(1);
  assert.equal(disconnected, 1, 'HTTP may not consume the entire 30-second process budget');
  assert.equal(adapter.drainDeadlineExceeded, true);
  t.mock.timers.tick(3_000);
  assert.equal(disconnected, 1);
});

test('a second drain request does not postpone the original teardown reserve', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const adapter = new BoundedExpressAdapter();
  let disconnected = 0;
  adapter.setHttpServer({ closeAllConnections: () => disconnected++ } as unknown as Server);
  adapter.beforeClose();
  t.mock.timers.tick(10_000);
  adapter.beforeClose();
  t.mock.timers.tick(17_000);
  assert.equal(disconnected, 1);
  assert.equal(adapter.isDraining, true);
});

test('an explicit shorter HTTP deadline retains its original behavior', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const adapter = new BoundedExpressAdapter(50);
  let disconnected = 0;
  adapter.setHttpServer({ closeAllConnections: () => disconnected++ } as unknown as Server);
  adapter.beforeClose();
  t.mock.timers.tick(49);
  assert.equal(disconnected, 0);
  t.mock.timers.tick(1);
  assert.equal(disconnected, 1);
});
