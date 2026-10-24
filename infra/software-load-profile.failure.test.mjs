import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';
import { test } from 'node:test';
import { runLoadProfile } from './software-load-profile.mjs';

test(
  'observer failure stops and drains every actor before rejecting the profile',
  { timeout: 25000 },
  async (t) => {
    const actors = Array.from({ length: 2 }, () => {
      const id = randomUUID();
      return {
        id,
        token: `synthetic-${id}`,
        cookie: `smartsite_refresh=synthetic-${id}`,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    });
    let activeHeldResponses = 0;
    let metadataCalls = 0;
    let markHeld;
    let markClosed;
    const held = new Promise((resolve) => (markHeld = resolve));
    const closed = new Promise((resolve) => (markClosed = resolve));
    const controller = new AbortController();
    const server = createServer((request, response) => {
      const actor = actors.find((item) => request.headers.authorization === `Bearer ${item.token}`);
      response.setHeader('content-type', 'application/json');
      if (!actor) {
        response.writeHead(401);
        response.end('{}');
        return;
      }
      if (request.url === '/api/v1/auth/me') {
        response.end(JSON.stringify({ id: actor.id, isActive: true, mustChangePassword: false }));
        return;
      }
      metadataCalls++;
      if (actor.id === actors[1].id) {
        activeHeldResponses++;
        response.once('close', () => {
          activeHeldResponses--;
          markClosed();
        });
        response.flushHeaders();
        markHeld();
        return;
      }
      response.end(JSON.stringify({ items: [], total: 0 }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(async () => {
      controller.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    const observerFailure = new Error('CONTROLLED_OBSERVER_FAILURE');
    let cleanupTimeout;
    try {
      await assert.rejects(
        runLoadProfile(
          {
            baseUrl: `http://127.0.0.1:${server.address().port}/api/v1`,
            origin: 'http://127.0.0.1:5173',
            durationMs: 30000,
            warmupMs: 0,
            thinkMs: 100,
            timeoutMs: 10000,
            maxBodyBytes: 1024,
            actors,
            routes: [
              { name: 'sites', kind: 'metadata', method: 'GET', path: '/sites', response: 'PAGE' },
            ],
          },
          {
            signal: controller.signal,
            onProgress: async () => {
              await held;
              throw observerFailure;
            },
          },
        ),
        (error) => error === observerFailure,
      );
      const callsWhenRejected = metadataCalls;
      await wait(100);
      assert.equal(activeHeldResponses, 0, 'A peer actor is still consuming the owned HTTP target');
      assert.equal(
        metadataCalls,
        callsWhenRejected,
        'Actors sent new requests after the profile failed',
      );
      assert.equal(
        controller.signal.aborted,
        false,
        'Internal failure must not mutate caller cancellation',
      );
    } finally {
      controller.abort();
      await Promise.race([
        closed,
        new Promise((resolve) => (cleanupTimeout = setTimeout(resolve, 250))),
      ]);
      clearTimeout(cleanupTimeout);
    }
  },
);
