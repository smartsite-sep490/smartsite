import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../src/config/environment.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import type { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { CameraSourceService } from '../src/modules/cameras/camera-source.service.js';

const site = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const camera = '33333333-3333-4333-8333-333333333333';
const caps = {
  schemaVersion: '1.0.0',
  hostId: 'edge',
  label: 'Local host',
  sourceKinds: ['WEBCAM'],
  webcams: [{ id: 'usb-front', label: 'Webcam 0' }],
  videos: [],
  browserCameraSupported: false,
  applySupported: false,
};
const probe = {
  schemaVersion: '1.0.0',
  state: 'TESTED',
  receiptId: camera,
  expiresAt: '2026-11-20T01:01:00Z',
  sourceKind: 'LIVE',
  frame: {
    width: 640,
    height: 480,
    capturedAt: '2026-11-20T01:00:00Z',
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  },
};
function setup(
  fetcher: typeof fetch,
  role: UserRole = UserRole.SITE_MANAGER,
  origin = 'http://127.0.0.1:62035',
  assignmentsForAuthentication: (
    call: number,
  ) => { role: UserRole; siteId: string | null }[] = () => [{ role, siteId: site }],
) {
  let authentications = 0;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    SMARTSITE_AI_SERVICE_TOKEN: 'server-only-token',
    SMARTSITE_AI_SOURCE_HOSTS: JSON.stringify([
      { id: 'edge', label: 'Local host', siteIds: [site], origin },
      { id: 'other', label: 'Other site host', siteIds: [other], origin: 'https://other.example' },
    ]),
  });
  const auth = {
    authenticate: async () => {
      authentications++;
      return {
        user: {
          mustChangePassword: false,
          roleAssignments: assignmentsForAuthentication(authentications),
        },
      };
    },
  } as unknown as AuthService;
  const cameras = {
    get: async () => ({ id: camera, siteId: site, externalId: 'camera-a' }),
  } as unknown as CameraConfigurationService;
  return {
    service: new CameraSourceService(config, auth, cameras, fetcher),
    authentications: () => authentications,
  };
}

test('global Admin and foreign-site roles cannot read or probe camera source hosts', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json(caps);
  }) as typeof fetch;
  for (const assignments of [
    [{ role: UserRole.ADMIN, siteId: null }],
    [{ role: UserRole.SITE_MANAGER, siteId: other }],
    [{ role: UserRole.SAFETY_OFFICER, siteId: other }],
    [],
  ]) {
    const { service } = setup(fetcher, UserRole.SITE_MANAGER, undefined, () => assignments);
    const forbidden = (e: unknown) => (e as { getStatus(): number }).getStatus() === 403;
    await assert.rejects(service.list('token', site, camera), forbidden);
    await assert.rejects(
      service.probe('token', site, camera, 'edge', { kind: 'WEBCAM', deviceId: 'usb-front' }),
      forbidden,
    );
  }
  assert.equal(calls, 0);
});

test('revoking the site role during host I/O denies results even when global Admin remains', async () => {
  let calls = 0;
  const { service, authentications } = setup(
    (async () => {
      calls++;
      return Response.json(caps);
    }) as typeof fetch,
    UserRole.SITE_MANAGER,
    undefined,
    (call) => [
      { role: UserRole.ADMIN, siteId: null },
      ...(call === 1 ? [{ role: UserRole.SITE_MANAGER, siteId: site }] : []),
    ],
  );
  await assert.rejects(
    service.list('token', site, camera),
    (e) => (e as { getStatus(): number }).getStatus() === 403,
  );
  assert.equal(calls, 1);
  assert.equal(authentications(), 2);
});

test('explicit site roles retain source access independently of global Admin', async () => {
  const officer = setup((async () => Response.json(caps)) as typeof fetch, UserRole.SAFETY_OFFICER);
  assert.equal((await officer.service.list('token', site, camera)).hosts[0]?.available, true);
  const manager = setup(
    (async (url) => Response.json(String(url).endsWith('/probe') ? probe : caps)) as typeof fetch,
    UserRole.SITE_MANAGER,
    undefined,
    () => [
      { role: UserRole.ADMIN, siteId: null },
      { role: UserRole.SITE_MANAGER, siteId: site },
    ],
  );
  assert.equal((await manager.service.list('token', site, camera)).hosts[0]?.available, true);
  assert.equal(
    (
      await manager.service.probe('token', site, camera, 'edge', {
        kind: 'WEBCAM',
        deviceId: 'usb-front',
      })
    ).state,
    'TESTED',
  );
});

test('host list is site-scoped, validates capabilities, and never sends service credentials to the browser', async () => {
  const calls: string[] = [];
  const { service } = setup((async (url, init) => {
    calls.push(String(url));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer server-only-token');
    return Response.json(caps);
  }) as typeof fetch);
  const result = await service.list('user-token', site, camera);
  assert.equal(result.hosts.length, 1);
  assert.equal(result.hosts[0]?.available, true);
  assert.match(calls[0]!, new RegExp(`/source-control/${site}/camera-a/capabilities$`));
  assert.doesNotMatch(JSON.stringify(result), /server-only-token|62035|other.example/);
});

test('an explicit missing camera scope is distinct from an unreachable source operator', async () => {
  for (const [status, body, reason] of [
    [404, { code: 'SOURCE_SCOPE_NOT_FOUND' }, 'CAMERA_UNBOUND'],
    [404, { code: 'UNKNOWN_ROUTE' }, 'AGENT_UNAVAILABLE'],
    [404, { code: 'SOURCE_SCOPE_NOT_FOUND', secret: 'must-not-leak' }, 'AGENT_UNAVAILABLE'],
    [401, { code: 'SOURCE_SCOPE_NOT_FOUND' }, 'AGENT_UNAVAILABLE'],
    [503, { code: 'SOURCE_SCOPE_NOT_FOUND' }, 'AGENT_UNAVAILABLE'],
  ] as const) {
    const { service } = setup((async () => Response.json(body, { status })) as typeof fetch);
    assert.deepEqual((await service.list('token', site, camera)).hosts, [
      { id: 'edge', label: 'Local host', available: false, reason },
    ]);
  }
  const offline = setup((async () => {
    throw new Error('private connection details');
  }) as typeof fetch);
  assert.deepEqual((await offline.service.list('token', site, camera)).hosts, [
    { id: 'edge', label: 'Local host', available: false, reason: 'AGENT_UNAVAILABLE' },
  ]);
});

test('only site manager can test sources; foreign host and arbitrary source fields never reach the agent', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json(probe);
  }) as typeof fetch;
  await assert.rejects(
    setup(fetcher, UserRole.SAFETY_OFFICER).service.probe('token', site, camera, 'edge', {
      kind: 'WEBCAM',
      deviceId: 'usb-front',
    }),
    (e) => (e as { getStatus(): number }).getStatus() === 403,
  );
  await assert.rejects(
    setup(fetcher).service.probe('token', site, camera, 'other', {
      kind: 'WEBCAM',
      deviceId: 'usb-front',
    }),
  );
  await assert.rejects(
    setup(fetcher).service.probe('token', site, camera, 'edge', {
      kind: 'WEBCAM',
      deviceId: 'usb-front',
      origin: 'https://attacker.example',
    }),
  );
  assert.equal(calls, 0);
});

test('probe uses pinned agent, refuses redirects and validates LIVE versus REPLAY', async () => {
  const { service, authentications } = setup((async (_url, init) => {
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), { kind: 'WEBCAM', deviceId: 'usb-front' });
    return Response.json(probe);
  }) as typeof fetch);
  assert.equal(
    (await service.probe('token', site, camera, 'edge', { kind: 'WEBCAM', deviceId: 'usb-front' }))
      .state,
    'TESTED',
  );
  assert.equal(authentications(), 2);
  const wrong = setup((async () =>
    Response.json({ ...probe, sourceKind: 'REPLAY' })) as typeof fetch);
  await assert.rejects(
    wrong.service.probe('token', site, camera, 'edge', { kind: 'WEBCAM', deviceId: 'usb-front' }),
  );
});

test('insecure remote origins, oversized response and cancelled requests fail closed', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return Response.json(probe, { headers: { 'content-length': '999999999' } });
  }) as typeof fetch;
  await assert.rejects(
    setup(fetcher, UserRole.SITE_MANAGER, 'http://192.168.1.5').service.list('token', site, camera),
  );
  assert.equal(calls, 0);
  await assert.rejects(
    setup(fetcher).service.probe('token', site, camera, 'edge', {
      kind: 'WEBCAM',
      deviceId: 'usb-front',
    }),
  );
  const before = calls;
  await assert.rejects(
    setup(fetcher).service.probe(
      'token',
      site,
      camera,
      'edge',
      { kind: 'WEBCAM', deviceId: 'usb-front' },
      AbortSignal.abort(),
    ),
  );
  assert.equal(calls, before);
});
