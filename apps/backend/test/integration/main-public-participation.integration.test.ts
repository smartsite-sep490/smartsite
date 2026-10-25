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
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { ContractorOperationsController } from '../../src/modules/workforce/directory/contractor-operations.controller.js';
import { hashPassword } from '../../src/modules/auth/password.js';
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
async function fixture() {
  const f = { actor: randomUUID(), site: randomUUID(), contractor: randomUUID() };
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [f.actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    f.site,
  ]);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
    [randomUUID(), f.actor, f.site],
  );
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [f.contractor],
  );
  return {
    ...f,
    input: {
      siteId: f.site,
      validFrom: '2026-10-01T00:00:00.000001Z',
      validUntil: '2027-12-01T00:00:00.000009Z',
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Participation = {
  id: string;
  siteId: string;
  contractorId: string;
  validFrom: string;
  validUntil: string | null;
  isActive: boolean;
  createdAt: string;
};
async function withApi(
  f: Fixture,
  work: (
    request: (body: unknown, contractorId?: string) => Promise<Response>,
    guard: UserAuthGuard,
    logout: () => Promise<Response>,
    apiDb: DataSource,
  ) => Promise<void>,
) {
  const password = 'SyntheticPublicParticipation123!';
  await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
    f.actor,
    await hashPassword(password),
  ]);
  const configuration = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_FORMAT: 'json',
      THROTTLE_LIMIT: '1000',
    }),
  );
  const apiDb = new DataSource(db.options);
  await apiDb.initialize();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(configuration)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(configuration, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(apiDb)
    .overrideProvider(DataSource)
    .useValue(apiDb)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const login = await fetch(url + '/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: f.actor, password, clientType: 'MOBILE' }),
    });
    assert.equal(login.status, 200);
    const session = (await login.json()) as { accessToken: string; refreshToken: string };
    const headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.accessToken,
    };
    const controller = module.get(ContractorOperationsController) as unknown as {
      auth: UserAuthGuard;
    };
    await work(
      (body, id = f.contractor) =>
        fetch(url + '/api/v1/contractors/' + id + '/participations', {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        }),
      controller.auth,
      () =>
        fetch(url + '/api/v1/auth/logout', {
          method: 'POST',
          headers,
          body: JSON.stringify({ clientType: 'MOBILE', refreshToken: session.refreshToken }),
        }),
      apiDb,
    );
  } finally {
    await app.close();
    if (apiDb.isInitialized) await apiDb.destroy();
  }
}
async function count(f: Fixture) {
  return (
    await db.query(
      'SELECT count(*)::int AS n FROM contractor_site_participation WHERE site_id=$1 AND contractor_id=$2',
      [f.site, f.contractor],
    )
  )[0].n as number;
}
async function version(f: Fixture) {
  return (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.site]))[0]
    .access_policy_version as number;
}

test('real public participation create records actor-bound same-transaction MF06 fact and witness', async () => {
  const f = await fixture(),
    before = await version(f);
  await withApi(f, async (request) => {
    const response = await request(f.input);
    assert.equal(response.status, 201);
    const p = (await response.json()) as Participation;
    assert.equal(p.siteId, f.site);
    assert.equal(p.contractorId, f.contractor);
    assert.equal(p.isActive, true);
    const fact = (
      await db.query(
        'SELECT c.actor_user_id,c.operation,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) LEFT JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1 ORDER BY f.revision DESC LIMIT 1',
        [p.id],
      )
    )[0];
    assert.equal(fact?.actor_user_id, f.actor);
    assert.equal(fact.operation, 'MAIN_PARTICIPATION_CREATE');
    assert.equal(fact.bound, true);
    assert.equal(fact.witnessed, true);
    assert.equal(await version(f), before);
  });
});
test('real public participation reauthenticates original bearer in the claimed transaction', async () => {
  const f = await fixture();
  await withApi(f, async (request, guard) => {
    const original = guard.authenticateRequest.bind(guard);
    let claims = 0;
    guard.authenticateRequest = async (r, manager) => {
      if (manager) {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        claims++;
      }
      await original(r, manager);
    };
    assert.equal((await request(f.input)).status, 201);
    assert.equal(claims, 1);
    assert.equal(await count(f), 1);
  });
});

test('public participation retains inactive Contractor, open expiry and overlapping create semantics without business audit or policy bump', async () => {
  const f = await fixture(),
    policy = await version(f);
  await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
  const audits = (await db.query('SELECT count(*)::int AS n FROM audit_log'))[0].n;
  await withApi(f, async (request) => {
    for (let i = 0; i < 2; i++) {
      const response = await request({ ...f.input, validUntil: null });
      assert.equal(response.status, 201);
      const p = (await response.json()) as Participation;
      assert.equal(p.validUntil, null);
      assert.equal(p.isActive, true);
    }
    assert.equal(await count(f), 2);
    assert.equal(await version(f), policy);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_log'))[0].n, audits);
  });
});
test('public participation preserves offset microseconds in storage and existing Date JSON precision', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    const response = await request({
      ...f.input,
      validFrom: '2026-10-01T07:00:00.000001+07:00',
      validUntil: '2027-12-01T07:00:00.000009+07:00',
    });
    assert.equal(response.status, 201);
    const p = (await response.json()) as Participation;
    assert.equal(p.validFrom, '2026-10-01T00:00:00.000Z');
    assert.equal(p.validUntil, '2027-12-01T00:00:00.000Z');
    const row = (
      await db.query(
        'SELECT to_char(valid_from AT TIME ZONE \'UTC\',\'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS value FROM contractor_site_participation WHERE id=$1',
        [p.id],
      )
    )[0];
    assert.equal(row.value, f.input.validFrom);
  });
});
test('public participation retains date-only input compatibility', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    const response = await request({
      ...f.input,
      validFrom: '2026-10-01',
      validUntil: '2027-12-01',
    });
    assert.equal(response.status, 201);
    const p = (await response.json()) as Participation;
    assert.equal(p.validFrom, new Date('2026-10-01').toISOString());
  });
});
test('public participation rejects caller attribution, absent expiry and invalid ranges without source writes', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    for (const input of [
      { ...f.input, actorUserId: f.actor },
      { ...f.input, commandId: randomUUID() },
      { siteId: f.site, validFrom: f.input.validFrom },
      { ...f.input, validUntil: f.input.validFrom },
      { ...f.input, validUntil: '2026-09-01T00:00:00Z' },
      { ...f.input, validFrom: 'infinity' },
    ])
      assert.equal((await request(input)).status, 400);
    assert.equal(await count(f), 0);
  });
});
test('public participation missing or malformed Contractor/Site fails without source writes', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    assert.equal((await request(f.input, randomUUID())).status, 404);
    assert.equal((await request({ ...f.input, siteId: randomUUID() })).status, 403);
    assert.equal((await request(f.input, 'bad-id')).status, 400);
    assert.equal(await count(f), 0);
  });
});
test('public participation requires the current Site Manager and rejects global Admin and other roles', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    for (const role of ['ADMIN', 'CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER']) {
      await db.query('UPDATE user_role_assignment SET role=$2,site_id=$3 WHERE user_id=$1', [
        f.actor,
        role,
        role === 'ADMIN' ? null : f.site,
      ]);
      assert.equal((await request(f.input)).status, 403);
    }
    assert.equal(await count(f), 0);
  });
});
for (const change of ['LOGOUT', 'ROLE', 'DEACTIVATE', 'TEMP_PASSWORD'] as const) {
  test(
    'held public participation denies ' + change + ' before transaction claim without source write',
    async () => {
      const f = await fixture();
      await withApi(f, async (request, guard, logout) => {
        let entered!: () => void, release!: () => void;
        const claimed = new Promise<void>((r) => {
            entered = r;
          }),
          hold = new Promise<void>((r) => {
            release = r;
          });
        const original = guard.authenticateRequest.bind(guard);
        guard.authenticateRequest = async (r, manager) => {
          if (manager) {
            entered();
            await hold;
          }
          await original(r, manager);
        };
        const pending = request(f.input);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            claimed,
            new Promise<never>((_, reject) => {
              timeout = setTimeout(() => reject(new Error('Transaction claim not reached')), 3000);
            }),
          ]);
          if (change === 'LOGOUT') assert.equal((await logout()).status, 204);
          if (change === 'ROLE')
            await db.query(
              "UPDATE user_role_assignment SET role='SAFETY_OFFICER',site_id=$2 WHERE user_id=$1",
              [f.actor, f.site],
            );
          if (change === 'DEACTIVATE')
            await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actor]);
          if (change === 'TEMP_PASSWORD')
            await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actor]);
          release();
          const response = await pending;
          assert.equal(response.status, change === 'LOGOUT' || change === 'DEACTIVATE' ? 401 : 403);
          assert.equal(await count(f), 0);
        } finally {
          if (timeout) clearTimeout(timeout);
          release();
          await pending;
        }
      });
    },
  );
}
test('disabled participation capture and partial authority journal fail closed', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    await db.query(
      'ALTER TABLE contractor_site_participation DISABLE TRIGGER trg_mf06_capture_contractor_site_participation',
    );
    try {
      assert.equal((await request(f.input)).status, 503);
      assert.equal(await count(f), 0);
    } finally {
      await db.query(
        'ALTER TABLE contractor_site_participation ENABLE TRIGGER trg_mf06_capture_contractor_site_participation',
      );
    }
    await db.query(
      'ALTER TABLE authorization_history_control RENAME TO mf06_authority_control_held',
    );
    try {
      assert.equal((await request(f.input)).status, 503);
      assert.equal(await count(f), 0);
    } finally {
      await db.query(
        'ALTER TABLE mf06_authority_control_held RENAME TO authorization_history_control',
      );
    }
  });
});
test('public participation postcommit witness failure retains committed success and leaves history unconfirmed', async () => {
  const f = await fixture();
  await withApi(f, async (request, _guard, _logout, apiDb) => {
    const original = apiDb.query.bind(apiDb);
    apiDb.query = async (...args: Parameters<DataSource['query']>) => {
      if (
        typeof args[0] === 'string' &&
        args[0].startsWith('INSERT INTO authorization_history_commit_receipt')
      )
        throw new Error('Synthetic witness failure');
      return original(...args);
    };
    const response = await request(f.input);
    assert.equal(response.status, 201);
    const p = (await response.json()) as Participation;
    assert.equal(await count(f), 1);
    const rows = await db.query(
      'SELECT w.command_id FROM authorization_history_revision f LEFT JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1',
      [p.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].command_id, null);
  });
});
