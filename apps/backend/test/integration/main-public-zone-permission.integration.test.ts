import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { SiteAccessSetupController } from '../../src/modules/workforce/site-access-setup.controller.js';
import { MainZonePermissionCommandService } from '../../src/modules/zones/main-zone-permission-command.service.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});
after(async () => {
  await database.dispose();
});
async function fixture(role = 'ADMIN') {
  const f = Object.fromEntries(
    [
      'actor',
      'site',
      'contractor',
      'participation',
      'worker',
      'zone',
      'assignment',
      'cp',
      'wp',
    ].map((k) => [k, randomUUID()]),
  ) as Record<
    | 'actor'
    | 'site'
    | 'contractor'
    | 'participation'
    | 'worker'
    | 'zone'
    | 'assignment'
    | 'cp'
    | 'wp',
    string
  >;
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [f.actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    f.site,
  ]);
  await db.query('INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    f.actor,
    role,
    role === 'ADMIN' ? null : f.site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [f.contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-01-01Z','2028-01-01Z')",
    [f.participation, f.contractor, f.site],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), f.actor, f.contractor],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [f.worker, f.site, f.contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [f.zone, f.site],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED','2026-10-01Z','2027-12-01Z',$6)",
    [f.assignment, f.worker, f.site, f.participation, f.zone, f.actor],
  );
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const contractorInput = (f: Fixture) => ({
  requestId: f.cp,
  siteContractorId: f.participation,
  zoneId: f.zone,
  validFrom: '2026-10-01T00:00:00.000001Z',
  validUntil: '2027-11-01T00:00:00.000009Z',
});
const workerInput = (f: Fixture) => ({
  requestId: f.wp,
  workerAssignmentId: f.assignment,
  contractorZonePermissionId: f.cp,
  validFrom: '2026-10-01T00:00:00.000003Z',
  validUntil: '2027-10-01T00:00:00.000007Z',
});
const base = (f: Fixture) => `/sites/${f.site}/access-setup`;
async function optionsData(f: Fixture) {
  await seedPair(f);
  const foreign = await fixture();
  const extra: Fixture = {
    ...f,
    contractor: foreign.contractor,
    participation: randomUUID(),
    worker: randomUUID(),
    assignment: randomUUID(),
    cp: randomUUID(),
    wp: randomUUID(),
  };
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-01-01Z','2028-01-01Z')",
    [extra.participation, extra.contractor, extra.site],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Other synthetic Worker')",
    [extra.worker, extra.site, extra.contractor],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED','2026-10-01Z','2027-12-01Z',$6)",
    [extra.assignment, extra.worker, extra.site, extra.participation, extra.zone, extra.actor],
  );
  await seedPair(extra);
  return { foreign, extra };
}

async function seedPair(f: Fixture, worker = true) {
  const cp = contractorInput(f);
  await db.query(
    'INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
    [f.cp, f.participation, f.zone, cp.validFrom, cp.validUntil, f.actor],
  );
  if (worker) {
    const wp = workerInput(f);
    await db.query(
      'INSERT INTO worker_zone_permission(id,worker_assignment_id,contractor_zone_permission_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4,$5,$6)',
      [f.wp, f.assignment, f.cp, wp.validFrom, wp.validUntil, f.actor],
    );
  }
}
async function withApi(
  f: Fixture,
  work: (
    request: (path: string, body?: unknown, method?: string) => Promise<Response>,
    guard: UserAuthGuard,
    logout: () => Promise<Response>,
  ) => Promise<void>,
) {
  const password = 'SyntheticPermission123!';
  await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
    f.actor,
    await hashPassword(password),
  ]);
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_FORMAT: 'json',
      THROTTLE_LIMIT: '1000',
    }),
  );
  const apiDatabase = new DataSource(db.options);
  await apiDatabase.initialize();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(apiDatabase)
    .overrideProvider(DataSource)
    .useValue(apiDatabase)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const login = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.actor, password, clientType: 'MOBILE' }),
    });
    assert.equal(login.status, 200);
    const session = (await login.json()) as { accessToken: string; refreshToken: string };
    const request = (path: string, body?: unknown, method = 'POST') =>
      fetch(`${url}/api/v1${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const controller = module.get(SiteAccessSetupController) as unknown as { auth: UserAuthGuard };
    await work(request, controller.auth, () =>
      request('/auth/logout', { clientType: 'MOBILE', refreshToken: session.refreshToken }),
    );
  } finally {
    await app.close();
    if (apiDatabase.isInitialized) await apiDatabase.destroy();
  }
}
test('actual public anchored Contractor grant retains main path, permission response and source fact', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    const r = await request(`${base(f)}/contractor-zone-permissions`, contractorInput(f));
    assert.equal(r.status, 201);
    const p = (await r.json()) as Record<string, unknown>;
    assert.equal(p.id, f.cp);
    assert.equal(p.siteContractorId, f.participation);
    assert.equal(p.grantedBy, f.actor);
    assert.equal(p.commandId, undefined);
    assert.equal(p.siteId, undefined);
    const fact = (
      await db.query(
        'SELECT c.actor_user_id,c.operation FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) WHERE f.source_id=$1 ORDER BY revision DESC LIMIT 1',
        [f.cp],
      )
    )[0];
    assert.equal(fact?.actor_user_id, f.actor);
    assert.equal(fact.operation, 'CONTRACTOR_ZONE_GRANT');
  });
});

for (const actorRole of ['ADMIN', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE'])
  test(`access setup options ${actorRole} retains main capabilities and scoped source projections`, async () => {
    const f = await fixture(actorRole);
    const { foreign, extra } = await optionsData(f);
    const n = await commands();
    const v = await policy(f);
    await withApi(f, async (request) => {
      const response = await request(base(f), undefined, 'GET');
      assert.equal(response.status, 200);
      const result = (await response.json()) as {
        canReviewAssignments: boolean;
        canGrantContractorZones: boolean;
        canGrantWorkerZones: boolean;
        participations: {
          id: string;
          contractorId: string;
          validFrom: string;
          validUntil: string | null;
        }[];
        workers: { id: string }[];
        zones: { id: string }[];
        assignments: { id: string; version: number; reviewNote: string | null }[];
        contractorPermissions: { id: string; validFrom: string; revokedAt: string | null }[];
        workerPermissions: { id: string }[];
      };
      const manager = actorRole !== 'CONTRACTOR_REPRESENTATIVE';
      assert.equal(result.canReviewAssignments, manager);
      assert.equal(result.canGrantContractorZones, manager);
      assert.equal(result.canGrantWorkerZones, actorRole !== 'SITE_MANAGER');
      for (const [list, primary, secondary] of [
        [result.participations, f.participation, extra.participation],
        [result.workers, f.worker, extra.worker],
        [result.assignments, f.assignment, extra.assignment],
        [result.contractorPermissions, f.cp, extra.cp],
        [result.workerPermissions, f.wp, extra.wp],
      ] as const)
        assert.deepEqual(
          new Set(list.map((row) => row.id)),
          new Set(manager ? [primary, secondary] : [primary]),
        );
      assert.deepEqual(
        result.zones.map((row) => row.id),
        [f.zone],
      );
      assert.equal(result.assignments.find((row) => row.id === f.assignment)?.version, 1);
      assert.equal(result.assignments.find((row) => row.id === f.assignment)?.reviewNote, null);
      assert.equal(
        result.contractorPermissions.find((row) => row.id === f.cp)?.validFrom,
        '2026-10-01T00:00:00.000Z',
      );
      const bytes = JSON.stringify(result);
      for (const value of [
        foreign.site,
        foreign.worker,
        foreign.participation,
        foreign.assignment,
        foreign.cp,
        foreign.wp,
      ])
        assert.equal(bytes.includes(value), false);
      for (const key of [
        'passwordHash',
        'password_hash',
        'faceProfile',
        'encryptedTemplate',
        'actorUserId',
        'commandId',
      ])
        assert.equal(bytes.includes(key), false);
    });
    assert.equal(await commands(), n);
    assert.equal(await policy(f), v);
  });

test('access setup options unknown or malformed Site is not a fabricated successful empty list', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    assert.equal(
      (await request(`/sites/${randomUUID()}/access-setup`, undefined, 'GET')).status,
      404,
    );
    assert.equal((await request('/sites/not-a-site/access-setup', undefined, 'GET')).status, 400);
  });
});

test('access setup options rejects Safety-only and wrong-Site manager roles', async () => {
  const f = await fixture('SAFETY_OFFICER');
  const other = await fixture();
  await withApi(f, async (request) => {
    assert.equal((await request(base(f), undefined, 'GET')).status, 403);
    await role(f, 'SITE_MANAGER', other.site);
    assert.equal((await request(base(f), undefined, 'GET')).status, 403);
  });
});

test('access setup options does not disclose setup metadata to a temporary-password account', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actor]);
    assert.equal((await request(base(f), undefined, 'GET')).status, 403);
  });
});

test('access setup options Representative without contractor grants sees no contractor-owned metadata', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE');
  await optionsData(f);
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actor]);
  await withApi(f, async (request) => {
    const response = await request(base(f), undefined, 'GET');
    assert.equal(response.status, 200);
    const result = await response.json();
    for (const field of [
      'participations',
      'workers',
      'assignments',
      'contractorPermissions',
      'workerPermissions',
    ])
      assert.deepEqual(result[field], []);
    assert.deepEqual(
      result.zones.map((row: { id: string }) => row.id),
      [f.zone],
    );
    assert.equal(result.canGrantWorkerZones, true);
  });
});

test('access setup options returns genuine empty metadata for an existing authorized empty Site', async () => {
  const f = await fixture();
  const site = randomUUID();
  await db.query(
    "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Empty synthetic Site')",
    [site],
  );
  await withApi(f, async (request) => {
    const response = await request(`/sites/${site}/access-setup`, undefined, 'GET');
    assert.equal(response.status, 200);
    const result = await response.json();
    for (const field of [
      'participations',
      'workers',
      'zones',
      'assignments',
      'contractorPermissions',
      'workerPermissions',
    ])
      assert.deepEqual(result[field], []);
  });
});
test('actual public anchored Worker grant retains approved assignment and Contractor permission anchors', async () => {
  const f = await fixture();
  await seedPair(f, false);
  await withApi(f, async (request) => {
    const r = await request(`${base(f)}/worker-zone-permissions`, workerInput(f));
    assert.equal(r.status, 201);
    const p = (await r.json()) as Record<string, unknown>;
    assert.equal(p.id, f.wp);
    assert.equal(p.workerAssignmentId, f.assignment);
    assert.equal(p.contractorZonePermissionId, f.cp);
    assert.equal(p.grantedBy, f.actor);
  });
});
for (const kind of ['contractor', 'worker'] as const)
  test(`actual public anchored ${kind} revoke retains main path and id-only response`, async () => {
    const f = await fixture();
    await seedPair(f);
    await withApi(f, async (request) => {
      const id = kind === 'contractor' ? f.cp : f.wp;
      const r = await request(`${base(f)}/${kind}-zone-permissions/${id}/revoke`);
      assert.equal(r.status, 201);
      assert.deepEqual(await r.json(), { id });
      const stored = (
        await db.query(`SELECT revoked_at FROM ${kind}_zone_permission WHERE id=$1`, [id])
      )[0];
      assert.ok(stored.revoked_at);
    });
  });

const service = () => new MainZonePermissionCommandService(db);
const ctx = (f: Fixture) => ({ actorUserId: f.actor });
const status = (n: number) => (e: unknown) =>
  (e as { getStatus?: () => number }).getStatus?.() === n;
async function policy(f: Fixture) {
  return (await db.query('SELECT access_policy_version AS n FROM site WHERE id=$1', [f.site]))[0]
    .n as number;
}
async function commands() {
  return (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n as number;
}
async function role(f: Fixture, r: string, site = f.site) {
  await db.query('UPDATE user_role_assignment SET role=$2,site_id=$3 WHERE user_id=$1', [
    f.actor,
    r,
    r === 'ADMIN' ? null : site,
  ]);
}

test('four public permission writes bind original bearer, actor facts, witness, audit and policy increments', async () => {
  const f = await fixture();
  await withApi(f, async (request, guard) => {
    const original = guard.authenticateRequest.bind(guard);
    let claims = 0;
    guard.authenticateRequest = async (r, m) => {
      if (m) {
        assert.equal(m.queryRunner?.isTransactionActive, true);
        claims++;
      }
      await original(r, m);
    };
    for (const [path, body] of [
      [`${base(f)}/contractor-zone-permissions`, contractorInput(f)],
      [`${base(f)}/worker-zone-permissions`, workerInput(f)],
      [`${base(f)}/worker-zone-permissions/${f.wp}/revoke`, undefined],
      [`${base(f)}/contractor-zone-permissions/${f.cp}/revoke`, undefined],
    ] as const)
      assert.equal((await request(path, body)).status, 201);
    assert.equal(claims, 4);
    assert.equal(await policy(f), 5);
    const facts = await db.query(
      'SELECT c.operation,c.actor_user_id,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=ANY($1::uuid[]) ORDER BY c.operation',
      [[f.cp, f.wp]],
    );
    assert.deepEqual(
      facts.map((r: { operation: string }) => r.operation),
      [
        'CONTRACTOR_ZONE_GRANT',
        'CONTRACTOR_ZONE_REVOKE',
        'WORKER_ZONE_GRANT',
        'WORKER_ZONE_REVOKE',
      ],
    );
    assert.ok(
      facts.every(
        (r: { actor_user_id: string; bound: boolean; witnessed: boolean }) =>
          r.actor_user_id === f.actor && r.bound && r.witnessed,
      ),
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM audit_log WHERE site_id=$1', [f.site]))[0].n,
      4,
    );
  });
});
for (const change of ['logout', 'role', 'inactive-account', 'representative-grant'] as const)
  test(`access setup options rechecks ${change} before a held authenticated read and discloses no stale metadata`, async () => {
    const f = await fixture(
      change === 'representative-grant' ? 'CONTRACTOR_REPRESENTATIVE' : 'ADMIN',
    );
    await optionsData(f);
    const n = await commands(),
      v = await policy(f);
    await withApi(f, async (request, guard, logout) => {
      let signal!: () => void, release!: () => void;
      const held = new Promise<void>((r) => {
        signal = r;
      });
      const resume = new Promise<void>((r) => {
        release = r;
      });
      const original = guard.authenticateRequest.bind(guard);
      guard.authenticateRequest = async (r, m) => {
        if (m) {
          signal();
          await resume;
        }
        await original(r, m);
      };
      const pending = request(base(f), undefined, 'GET');
      try {
        await Promise.race([
          held,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Access setup read claim not reached')),
              3000,
            ).unref();
          }),
        ]);
        if (change === 'logout') assert.equal((await logout()).status, 204);
        else if (change === 'role')
          await db.query(
            "UPDATE user_role_assignment SET role='SAFETY_OFFICER',site_id=$2 WHERE user_id=$1",
            [f.actor, f.site],
          );
        else if (change === 'inactive-account')
          await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actor]);
        else
          await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actor]);
      } finally {
        release();
      }
      const response = await pending;
      if (change === 'representative-grant') {
        assert.equal(response.status, 200);
        const result = (await response.json()) as {
          workers: unknown[];
          participations: unknown[];
          assignments: unknown[];
          contractorPermissions: unknown[];
          workerPermissions: unknown[];
        };
        for (const key of [
          'workers',
          'participations',
          'assignments',
          'contractorPermissions',
          'workerPermissions',
        ] as const)
          assert.deepEqual(result[key], []);
      } else {
        assert.equal(response.status, change === 'role' ? 403 : 401);
        assert.doesNotMatch(await response.text(), new RegExp([f.worker, f.cp, f.wp].join('|')));
      }
      assert.equal(await commands(), n);
      assert.equal(await policy(f), v);
    });
  });

test('access setup options retains main expired participation, inactive Worker, assignment status and revoked permission metadata', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE');
  await seedPair(f);
  await db.query(
    "UPDATE contractor_site_participation SET valid_from='2025-01-01Z',valid_until='2025-12-01Z' WHERE id=$1",
    [f.participation],
  );
  await db.query('UPDATE worker SET is_active=false WHERE id=$1', [f.worker]);
  await db.query(
    "UPDATE worker_site_zone_assignment SET status='PENDING',version=4,review_note='Synthetic retained review' WHERE id=$1",
    [f.assignment],
  );
  await db.query('UPDATE contractor_zone_permission SET revoked_at=now() WHERE id=$1', [f.cp]);
  await db.query('UPDATE worker_zone_permission SET revoked_at=now() WHERE id=$1', [f.wp]);
  await withApi(f, async (request) => {
    const response = await request(base(f), undefined, 'GET');
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      participations: { id: string }[];
      workers: { id: string }[];
      assignments: { id: string; status: string; version: number; reviewNote: string }[];
      contractorPermissions: { id: string; revokedAt: string | null }[];
      workerPermissions: { id: string; revokedAt: string | null }[];
    };
    assert.equal(result.participations[0]?.id, f.participation);
    assert.equal(result.workers[0]?.id, f.worker);
    assert.equal(result.assignments[0]?.id, f.assignment);
    assert.equal(result.assignments[0]?.status, 'PENDING');
    assert.equal(result.assignments[0]?.version, 4);
    assert.equal(result.assignments[0]?.reviewNote, 'Synthetic retained review');
    assert.equal(typeof result.contractorPermissions[0]?.revokedAt, 'string');
    assert.equal(typeof result.workerPermissions[0]?.revokedAt, 'string');
  });
});

test('access setup options excludes inactive participation and its contractor-owned rows for a Representative', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE');
  await seedPair(f);
  await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
    f.participation,
  ]);
  await withApi(f, async (request) => {
    const response = await request(base(f), undefined, 'GET');
    assert.equal(response.status, 200);
    const result = (await response.json()) as {
      participations: unknown[];
      workers: unknown[];
      assignments: unknown[];
      contractorPermissions: unknown[];
      workerPermissions: unknown[];
      zones: { id: string }[];
    };
    for (const key of [
      'participations',
      'workers',
      'assignments',
      'contractorPermissions',
      'workerPermissions',
    ] as const)
      assert.deepEqual(result[key], []);
    assert.equal(result.zones[0]?.id, f.zone);
  });
});

for (const op of [
  'contractor-grant',
  'worker-grant',
  'contractor-revoke',
  'worker-revoke',
] as const)
  test(`actual logout before public ${op} transaction claim denies all side effects`, async () => {
    const f = await fixture();
    if (op !== 'contractor-grant') await seedPair(f, op !== 'worker-grant');
    const before = await commands(),
      v = await policy(f);
    await withApi(f, async (request, guard, logout) => {
      let signal!: () => void, release!: () => void;
      const held = new Promise<void>((r) => {
          signal = r;
        }),
        resume = new Promise<void>((r) => {
          release = r;
        });
      const original = guard.authenticateRequest.bind(guard);
      guard.authenticateRequest = async (r, m) => {
        if (m) {
          signal();
          await resume;
        }
        await original(r, m);
      };
      const path =
        op === 'contractor-grant'
          ? `${base(f)}/contractor-zone-permissions`
          : op === 'worker-grant'
            ? `${base(f)}/worker-zone-permissions`
            : op === 'contractor-revoke'
              ? `${base(f)}/contractor-zone-permissions/${f.cp}/revoke`
              : `${base(f)}/worker-zone-permissions/${f.wp}/revoke`;
      const pending = request(
        path,
        op === 'contractor-grant'
          ? contractorInput(f)
          : op === 'worker-grant'
            ? workerInput(f)
            : undefined,
      );
      try {
        await Promise.race([
          held,
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Permission claim not reached')), 3000).unref();
          }),
        ]);
        assert.equal((await logout()).status, 204);
      } finally {
        release();
      }
      assert.equal((await pending).status, 401);
      assert.equal(await commands(), before);
      assert.equal(await policy(f), v);
    });
  });
test('public permission main Site Manager and Representative roles use current Site and Contractor scope', async () => {
  const f = await fixture('SITE_MANAGER'),
    other = await fixture();
  const s = service();
  await s.publicGrantContractor(f.site, contractorInput(f), ctx(f));
  await assert.rejects(s.publicGrantWorker(f.site, workerInput(f), ctx(f)), status(403));
  await role(f, 'CONTRACTOR_REPRESENTATIVE', other.site);
  await assert.rejects(s.publicGrantWorker(f.site, workerInput(f), ctx(f)), status(403));
  await role(f, 'CONTRACTOR_REPRESENTATIVE');
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actor]);
  await assert.rejects(s.publicGrantWorker(f.site, workerInput(f), ctx(f)), status(409));
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), f.actor, f.contractor],
  );
  await s.publicGrantWorker(f.site, workerInput(f), ctx(f));
  await s.publicRevoke(f.site, f.wp, 'worker', ctx(f));
  await assert.rejects(s.publicRevoke(f.site, f.cp, 'contractor', ctx(f)), status(403));
});
test('actual HTTP permission scope/role changes deny inappropriate writes without changing existing permissions', async () => {
  const f = await fixture('SITE_MANAGER');
  await withApi(f, async (request) => {
    assert.equal(
      (await request(`${base(f)}/contractor-zone-permissions`, contractorInput(f))).status,
      201,
    );
    assert.equal((await request(`${base(f)}/worker-zone-permissions`, workerInput(f))).status, 403);
    await role(f, 'CONTRACTOR_REPRESENTATIVE');
    assert.equal((await request(`${base(f)}/worker-zone-permissions`, workerInput(f))).status, 201);
    assert.equal(
      (await request(`${base(f)}/contractor-zone-permissions/${f.cp}/revoke`)).status,
      403,
    );
    assert.equal((await request(`${base(f)}/worker-zone-permissions/${f.wp}/revoke`)).status, 201);
  });
});
test('public permission active account and changed temporary password are rechecked even for repeated revoke', async () => {
  for (const update of ['is_active=false', 'must_change_password=true']) {
    const f = await fixture();
    await seedPair(f);
    const n = await commands();
    await db.query(`UPDATE app_user SET ${update} WHERE id=$1`, [f.actor]);
    await assert.rejects(service().publicRevoke(f.site, f.cp, 'contractor', ctx(f)), status(403));
    assert.equal(await commands(), n);
  }
});
test('public grants retain exact repeat requestId with no duplicate audit/fact/policy and reject changed requests', async () => {
  const f = await fixture(),
    s = service();
  const first = await s.publicGrantContractor(f.site, contractorInput(f), ctx(f)),
    v = await policy(f);
  const second = await s.publicGrantContractor(f.site, contractorInput(f), ctx(f));
  assert.deepEqual(second, first);
  assert.equal(await policy(f), v);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM mf06_authority_fact WHERE source_id=$1', [
        f.cp,
      ])
    )[0].n,
    1,
  );
  await assert.rejects(
    s.publicGrantContractor(
      f.site,
      { ...contractorInput(f), validUntil: '2027-11-02T00:00:00Z' },
      ctx(f),
    ),
    status(409),
  );
  const wp = await s.publicGrantWorker(f.site, workerInput(f), ctx(f)),
    v2 = await policy(f);
  assert.deepEqual(await s.publicGrantWorker(f.site, workerInput(f), ctx(f)), wp);
  assert.equal(await policy(f), v2);
});
test('public concurrent revoke records a single timestamp/audit/source change and current Representative is still required', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE');
  await seedPair(f);
  const s = service();
  await Promise.all([
    s.publicRevoke(f.site, f.wp, 'worker', ctx(f)),
    s.publicRevoke(f.site, f.wp, 'worker', ctx(f)),
  ]);
  const stamp = (
    await db.query('SELECT revoked_at::text AS stamp FROM worker_zone_permission WHERE id=$1', [
      f.wp,
    ])
  )[0].stamp;
  assert.equal(await policy(f), 2);
  await s.publicRevoke(f.site, f.wp, 'worker', ctx(f));
  assert.equal(
    (
      await db.query('SELECT revoked_at::text AS stamp FROM worker_zone_permission WHERE id=$1', [
        f.wp,
      ])
    )[0].stamp,
    stamp,
  );
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actor]);
  await assert.rejects(s.publicRevoke(f.site, f.wp, 'worker', ctx(f)), status(409));
});
test('public Worker grant refuses unapproved/open-ended assignment, revoked Contractor grant and inactive Worker', async () => {
  for (const update of [
    "UPDATE worker_site_zone_assignment SET status='PENDING' WHERE id=$1",
    'UPDATE worker_site_zone_assignment SET valid_until=NULL WHERE id=$1',
    'UPDATE contractor_zone_permission SET revoked_at=clock_timestamp() WHERE id=$1',
    'UPDATE worker SET is_active=false WHERE id=$1',
  ]) {
    const f = await fixture();
    await seedPair(f, false);
    const id = update.includes('worker_site_zone_assignment')
      ? f.assignment
      : update.includes('contractor_zone_permission')
        ? f.cp
        : f.worker;
    await db.query(update, [id]);
    const n = await commands();
    await assert.rejects(service().publicGrantWorker(f.site, workerInput(f), ctx(f)), status(409));
    assert.equal(await commands(), n);
  }
});
test('public permission intervals retain one microsecond and reject outside-parent or reversed intervals', async () => {
  const f = await fixture(),
    s = service();
  await s.publicGrantContractor(
    f.site,
    {
      ...contractorInput(f),
      validFrom: '2026-10-01T07:00:00.000001+07:00',
      validUntil: '2026-10-01T07:00:00.000002+07:00',
    },
    ctx(f),
  );
  assert.equal(
    (
      await db.query(
        "SELECT valid_until-valid_from=interval '1 microsecond' AS exact FROM contractor_zone_permission WHERE id=$1",
        [f.cp],
      )
    )[0].exact,
    true,
  );
  const other = await fixture();
  await assert.rejects(
    s.publicGrantContractor(
      other.site,
      { ...contractorInput(other), validFrom: '2025-12-31T00:00:00Z' },
      ctx(other),
    ),
    status(409),
  );
  await assert.rejects(
    s.publicGrantContractor(
      other.site,
      { ...contractorInput(other), validUntil: contractorInput(other).validFrom },
      ctx(other),
    ),
    status(409),
  );
  await seedPair(other, false);
  await assert.rejects(
    s.publicGrantWorker(
      other.site,
      { ...workerInput(other), validUntil: '2027-11-02T00:00:00Z' },
      ctx(other),
    ),
    status(409),
  );
});
test('public Contractor grant and both revokes refuse cross-Site anchors without orphan command', async () => {
  const f = await fixture(),
    other = await fixture();
  await seedPair(f);
  const n = await commands(),
    s = service();
  await assert.rejects(
    s.publicGrantContractor(other.site, { ...contractorInput(f), requestId: randomUUID() }, ctx(f)),
    status(404),
  );
  await assert.rejects(s.publicRevoke(other.site, f.cp, 'contractor', ctx(f)), status(404));
  await assert.rejects(s.publicRevoke(other.site, f.wp, 'worker', ctx(f)), status(404));
  assert.equal(await commands(), n);
});
test('public revokes remain possible after participation deactivation and assignment expiry', async () => {
  const f = await fixture();
  await seedPair(f);
  await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
    f.participation,
  ]);
  await db.query("UPDATE worker_site_zone_assignment SET valid_until='2026-10-02Z' WHERE id=$1", [
    f.assignment,
  ]);
  await service().publicRevoke(f.site, f.wp, 'worker', ctx(f));
  await service().publicRevoke(f.site, f.cp, 'contractor', ctx(f));
  assert.equal(await policy(f), 3);
});
test('actual permission grant DTO rejects client actor/command, extra fields and missing/invalid offset dates', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    for (const body of [
      { ...contractorInput(f), actorUserId: randomUUID() },
      { ...contractorInput(f), commandId: randomUUID() },
      { ...contractorInput(f), extra: true },
      { ...contractorInput(f), validUntil: undefined },
      { ...contractorInput(f), validFrom: '2026-10-01T00:00:00' },
      { ...contractorInput(f), requestId: 'bad' },
    ])
      assert.equal((await request(`${base(f)}/contractor-zone-permissions`, body)).status, 400);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM contractor_zone_permission WHERE id=$1', [
          f.cp,
        ])
      )[0].n,
      0,
    );
  });
});
test('public permission partial journal and disabled permission/Site captures fail before source changes', async () => {
  const f = await fixture();
  await db.query('ALTER TABLE mf06_authority_commit_witness RENAME TO test_permission_witness');
  try {
    await assert.rejects(
      service().publicGrantContractor(f.site, contractorInput(f), ctx(f)),
      status(503),
    );
  } finally {
    await db.query('ALTER TABLE test_permission_witness RENAME TO mf06_authority_commit_witness');
  }
  for (const table of ['contractor_zone_permission', 'site']) {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER trg_mf06_capture_${table}`);
    try {
      await assert.rejects(
        service().publicGrantContractor(f.site, contractorInput(f), ctx(f)),
        status(503),
      );
    } finally {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER trg_mf06_capture_${table}`);
    }
  }
  await seedPair(f, false);
  await db.query(
    'ALTER TABLE worker_zone_permission DISABLE TRIGGER trg_mf06_capture_worker_zone_permission',
  );
  try {
    await assert.rejects(service().publicGrantWorker(f.site, workerInput(f), ctx(f)), status(503));
  } finally {
    await db.query(
      'ALTER TABLE worker_zone_permission ENABLE TRIGGER trg_mf06_capture_worker_zone_permission',
    );
  }
});
test('permission source-fact failure rolls back grant, audit, policy and journal command together', async () => {
  const f = await fixture(),
    n = await commands(),
    v = await policy(f);
  await db.query(
    "CREATE FUNCTION test_permission_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure';END $$;CREATE TRIGGER test_permission_fact_failure BEFORE INSERT ON mf06_authority_fact FOR EACH ROW EXECUTE FUNCTION test_permission_fact_failure()",
  );
  try {
    await assert.rejects(service().publicGrantContractor(f.site, contractorInput(f), ctx(f)));
    assert.equal(await commands(), n);
    assert.equal(await policy(f), v);
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM contractor_zone_permission WHERE id=$1', [
          f.cp,
        ])
      )[0].n,
      0,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM audit_log WHERE site_id=$1', [f.site]))[0].n,
      0,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_permission_fact_failure ON mf06_authority_fact;DROP FUNCTION test_permission_fact_failure()',
    );
  }
});
test('postcommit permission witness failure retains committed response and explicitly unconfirmed history', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION test_permission_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic failure';END $$;CREATE TRIGGER test_permission_witness_failure BEFORE INSERT ON mf06_authority_commit_witness FOR EACH ROW EXECUTE FUNCTION test_permission_witness_failure()",
  );
  try {
    const p = await service().publicGrantContractor(f.site, contractorInput(f), ctx(f));
    assert.equal(p.id, f.cp);
    assert.equal(
      (
        await db.query(
          'SELECT w.command_id FROM mf06_authority_fact f LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=$1',
          [f.cp],
        )
      )[0].command_id,
      null,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_permission_witness_failure ON mf06_authority_commit_witness;DROP FUNCTION test_permission_witness_failure()',
    );
  }
});
