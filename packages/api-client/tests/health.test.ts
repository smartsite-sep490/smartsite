import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getBackendHealth } from '../src/index';

describe('backend health client HTTP boundary', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/slow/api/v1/health/live') return;
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/unavailable/api/v1/health/live') {
        res.writeHead(503).end('{"detail":"private infrastructure details"}');
      } else if (req.url === '/invalid/api/v1/health/live') {
        res.end('{"status":"ok","service":"a-different-service"}');
      } else if (req.url === '/html/api/v1/health/live') {
        res.end('<html>proxy error</html>');
      } else if (req.url === '/api/v1/health/live') {
        res.end('{"status":"ok","service":"smartsite-backend"}');
      } else {
        res.writeHead(404).end('{}');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('reads the versioned endpoint with and without trailing slash', async () => {
    for (const url of [baseUrl, `${baseUrl}/`]) {
      await expect(getBackendHealth(url)).resolves.toEqual({
        status: 'ok',
        service: 'smartsite-backend',
      });
    }
  });

  it('rejects non-success responses without exposing server response bodies', async () => {
    await expect(getBackendHealth(`${baseUrl}/unavailable`)).rejects.toMatchObject({
      code: 'http',
      status: 503,
    });
    await expect(getBackendHealth(`${baseUrl}/unavailable`)).rejects.not.toThrow(
      'private infrastructure details',
    );
  });

  it('rejects malformed payloads instead of reporting a healthy connection', async () => {
    for (const path of ['invalid', 'html']) {
      await expect(getBackendHealth(`${baseUrl}/${path}`)).rejects.toMatchObject({
        code: 'invalid-response',
      });
    }
  });

  it('bounds unresponsive requests with a timeout', async () => {
    await expect(getBackendHealth(`${baseUrl}/slow`, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('honors caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(getBackendHealth(baseUrl, { signal: controller.signal })).rejects.toMatchObject({
      code: 'cancelled',
    });
  });
});
