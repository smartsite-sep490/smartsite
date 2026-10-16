import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource, type QueryRunner } from 'typeorm';
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
import { ContractorsController } from '../../src/modules/workforce/directory/contractors.controller.js';
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
type Kind = 'CONTRACTOR';
test('site Contractor without a code receives a generated unique code through the registered HTTP route', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const first = await call('CONTRACTOR', { name: 'Synthetic generated Contractor' });
    assert.equal(first.status, 201, await first.clone().text());
    const second = await call('CONTRACTOR', { name: 'Synthetic second Contractor' });
    assert.equal(second.status, 201, await second.clone().text());
    const a = (await first.json()) as { id: string; code: string };
    const b = (await second.json()) as { id: string; code: string };
    assert.match(a.code, /^CTR-[0-9A-F-]{36}$/);
    assert.notEqual(a.code, b.code);
    assert.notEqual(a.id, b.id);
  });
});
async function fixture() {
  const f = {
    actor: randomUUID(),
    site: randomUUID(),
    contractor: randomUUID(),
    participation: randomUUID(),
  };
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
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,clock_timestamp()-interval '1 day',NULL)",
    [f.participation, f.contractor, f.site],
  );
  return {
    ...f,
    contractorInput: {
      code: 'C_' + randomUUID().replaceAll('-', '').toUpperCase(),
      name: 'Synthetic new Contractor',
    },
    workerInput: { siteId: f.site, externalId: randomUUID(), displayName: 'Synthetic new Worker' },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Call = (kind: Kind, body?: unknown, contractorId?: string) => Promise<Response>;
async function withApi(
  f: Fixture,
  work: (
    call: Call,
    guard: UserAuthGuard,
    logout: () => Promise<Response>,
    apiDb: DataSource,
  ) => Promise<void>,
) {
  const password = 'SyntheticMainWorkforce123!';
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
    const controller = module.get(ContractorsController) as unknown as {
      auth: UserAuthGuard;
    };
    await work(
      (kind, body, id = f.site) =>
        fetch(url + '/api/v1/sites/' + id + '/contractors', {
          method: 'POST',
          headers,
          body: JSON.stringify(body ?? f.contractorInput),
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

async function factsFor(id: string) {
  return db.query(
    'SELECT f.source_kind,c.actor_user_id,c.operation,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=$1',
    [id],
  );
}
test('site Contractor create and automatic participation emit two actor-bound same-command facts', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const response = await call('CONTRACTOR');
    assert.equal(response.status, 201);
    const row = (await response.json()) as { id: string; siteId: string };
    assert.equal(row.siteId, f.site);
    const c = await factsFor(row.id);
    assert.equal(c.length, 1);
    assert.equal(c[0].source_kind, 'CONTRACTOR');
    assert.equal(c[0].actor_user_id, f.actor);
    assert.equal(c[0].bound, true);
    assert.equal(c[0].witnessed, true);
    const p = (
      await db.query(
        'SELECT id FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2',
        [row.id, f.site],
      )
    )[0];
    const pf = await factsFor(p.id);
    assert.equal(pf.length, 1);
    assert.equal(pf[0].source_kind, 'PARTICIPATION');
    assert.equal(pf[0].actor_user_id, f.actor);
    assert.equal(pf[0].bound, true);
    assert.equal(pf[0].witnessed, true);
    const same = (
      await db.query(
        'SELECT count(DISTINCT command_id)::int AS n FROM mf06_authority_fact WHERE source_id=ANY($1::uuid[])',
        [[row.id, p.id]],
      )
    )[0];
    assert.equal(same.n, 1);
  });
});
test('site Contractor reuse across Site creates only one participation source fact', async () => {
  const f = await fixture();
  const other = randomUUID();
  await db.query(
    "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic other Site')",
    [other],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
    [randomUUID(), f.actor, other],
  );
  await withApi(f, async (call) => {
    const response = await call(
      'CONTRACTOR',
      { code: f.contractor, name: 'Synthetic Contractor' },
      other,
    );
    assert.equal(response.status, 201);
    const row = (await response.json()) as { id: string };
    assert.equal(row.id, f.contractor);
    const p = (
      await db.query(
        'SELECT id FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2',
        [row.id, other],
      )
    )[0];
    const facts = await factsFor(p.id);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].actor_user_id, f.actor);
    assert.equal(facts[0].witnessed, true);
  });
});

async function countCreated(f: Fixture) {
  return (
    await db.query('SELECT count(*)::int AS n FROM contractor WHERE code=$1', [
      f.contractorInput.code,
    ])
  )[0].n as number;
}
for (const mode of ['OPEN', 'FINITE', 'EXPIRED', 'FUTURE', 'INACTIVE'] as const)
  test('site Contractor reuse preserves ' + mode + ' participation semantics', async () => {
    const f = await fixture();
    if (mode === 'FINITE')
      await db.query(
        "UPDATE contractor_site_participation SET valid_until=clock_timestamp()+interval '1 day' WHERE id=$1",
        [f.participation],
      );
    if (mode === 'EXPIRED')
      await db.query(
        "UPDATE contractor_site_participation SET valid_until=clock_timestamp()-interval '1 hour' WHERE id=$1",
        [f.participation],
      );
    if (mode === 'FUTURE')
      await db.query(
        "UPDATE contractor_site_participation SET valid_from=clock_timestamp()+interval '1 day',valid_until=NULL WHERE id=$1",
        [f.participation],
      );
    if (mode === 'INACTIVE')
      await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
        f.participation,
      ]);
    const before = (
      await db.query(
        'SELECT row_to_json(p)::text AS value FROM contractor_site_participation p WHERE id=$1',
        [f.participation],
      )
    )[0].value;
    const policy = (
      await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.site])
    )[0].access_policy_version;
    const audits = (await db.query('SELECT count(*)::int AS n FROM audit_log'))[0].n;
    await withApi(f, async (call) => {
      const input = { code: f.contractor, name: 'Synthetic Contractor' };
      const first = await call('CONTRACTOR', input);
      assert.equal(first.status, 201);
      assert.equal(((await first.json()) as { id: string }).id, f.contractor);
      assert.equal((await call('CONTRACTOR', input)).status, 201);
      const rows = await db.query(
        'SELECT id FROM contractor_site_participation WHERE contractor_id=$1 AND site_id=$2',
        [f.contractor, f.site],
      );
      assert.equal(rows.length, mode === 'OPEN' || mode === 'FINITE' ? 1 : 2);
      assert.equal(
        (
          await db.query(
            'SELECT row_to_json(p)::text AS value FROM contractor_site_participation p WHERE id=$1',
            [f.participation],
          )
        )[0].value,
        before,
      );
      if (rows.length === 2) {
        const pf = await factsFor(rows.find((r: { id: string }) => r.id !== f.participation).id);
        assert.equal(pf.length, 1);
        assert.equal(pf[0].actor_user_id, f.actor);
        assert.equal(pf[0].witnessed, true);
      }
      assert.equal(
        (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.site]))[0]
          .access_policy_version,
        policy,
      );
      assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_log'))[0].n, audits);
    });
  });
test('site Contractor strictDTO400/unassignedSite403/name or inactive409 do not create participation', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    for (const extra of [{ actorUserId: f.actor }, { commandId: randomUUID() }])
      assert.equal((await call('CONTRACTOR', { ...f.contractorInput, ...extra })).status, 400);
    assert.equal((await call('CONTRACTOR', undefined, 'bad-id')).status, 403);
    assert.equal((await call('CONTRACTOR', undefined, randomUUID())).status, 403);
    assert.equal(
      (await call('CONTRACTOR', { code: f.contractor, name: 'Different name' })).status,
      409,
    );
    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    assert.equal(
      (await call('CONTRACTOR', { code: f.contractor, name: 'Synthetic Contractor' })).status,
      409,
    );
    assert.equal(await countCreated(f), 0);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM contractor_site_participation WHERE contractor_id=$1',
          [f.contractor],
        )
      )[0].n,
      1,
    );
  });
});
for (const role of ['ADMIN', 'CONTRACTOR_REPRESENTATIVE', 'WORKER'] as const)
  test('site Contractor refuses ' + role + ' without scoped Site Manager', async () => {
    const f = await fixture();
    await db.query('UPDATE user_role_assignment SET role=$2,site_id=$3 WHERE user_id=$1', [
      f.actor,
      role,
      role === 'ADMIN' ? null : f.site,
    ]);
    await withApi(f, async (call) => {
      assert.equal((await call('CONTRACTOR')).status, 403);
      assert.equal(await countCreated(f), 0);
    });
  });
for (const change of ['LOGOUT', 'ROLE', 'DEACTIVATE', 'TEMP_PASSWORD'] as const)
  test(
    'site Contractor ' + change + ' before transaction claim leaves both sources absent',
    async () => {
      const f = await fixture();
      await withApi(f, async (call, guard, logout) => {
        let entered!: () => void, release!: () => void;
        const claimed = new Promise<void>((r) => (entered = r)),
          hold = new Promise<void>((r) => (release = r));
        const original = guard.authenticateRequest.bind(guard);
        guard.authenticateRequest = async (r, m) => {
          if (m) {
            entered();
            await hold;
          }
          await original(r, m);
        };
        const pending = call('CONTRACTOR');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            claimed,
            new Promise<never>(
              (_, reject) =>
                (timer = setTimeout(
                  () => reject(new Error('Transaction claim not reached')),
                  3000,
                )),
            ),
          ]);
          if (change === 'LOGOUT') assert.equal((await logout()).status, 204);
          if (change === 'ROLE')
            await db.query(
              "UPDATE user_role_assignment SET role='ADMIN',site_id=NULL WHERE user_id=$1",
              [f.actor],
            );
          if (change === 'DEACTIVATE')
            await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actor]);
          if (change === 'TEMP_PASSWORD')
            await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actor]);
          release();
          assert.equal(
            (await pending).status,
            change === 'LOGOUT' || change === 'DEACTIVATE' ? 401 : 403,
          );
          assert.equal(await countCreated(f), 0);
        } finally {
          if (timer) clearTimeout(timer);
          release();
          await pending;
        }
      });
    },
  );
for (const table of ['contractor', 'contractor_site_participation'] as const)
  test(
    'site Contractor requires ' + table + ' capture even when reusing an existing Contractor',
    async () => {
      const f = await fixture();
      await withApi(f, async (call) => {
        await db.query('ALTER TABLE ' + table + ' DISABLE TRIGGER trg_mf06_capture_' + table);
        try {
          assert.equal((await call('CONTRACTOR')).status, 503);
          assert.equal(
            (await call('CONTRACTOR', { code: f.contractor, name: 'Synthetic Contractor' })).status,
            503,
          );
          assert.equal(await countCreated(f), 0);
        } finally {
          await db.query('ALTER TABLE ' + table + ' ENABLE TRIGGER trg_mf06_capture_' + table);
        }
      });
    },
  );
test('site Contractor refuses a partial journal without creation', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    await db.query('ALTER TABLE mf06_authority_control RENAME TO mf06_authority_control_held');
    try {
      assert.equal((await call('CONTRACTOR')).status, 503);
      assert.equal(await countCreated(f), 0);
    } finally {
      await db.query('ALTER TABLE mf06_authority_control_held RENAME TO mf06_authority_control');
    }
  });
});
test('site Contractor participation failure rolls back Contractor and both facts atomically', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    await db.query(
      "CREATE FUNCTION test_refuse_auto_participation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic participation refusal'; END $$",
    );
    await db.query(
      'CREATE TRIGGER test_refuse_auto_participation BEFORE INSERT ON contractor_site_participation FOR EACH ROW EXECUTE FUNCTION test_refuse_auto_participation()',
    );
    const before = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
    try {
      const response = await call('CONTRACTOR');
      assert.equal(response.status, 500);
      assert(!(await response.text()).includes('Synthetic participation refusal'));
      assert.equal(await countCreated(f), 0);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
        before,
      );
    } finally {
      await db.query(
        'DROP TRIGGER test_refuse_auto_participation ON contractor_site_participation',
      );
      await db.query('DROP FUNCTION test_refuse_auto_participation()');
    }
  });
});
test('site Contractor witness failure preserves committed sources with unconfirmed history', async () => {
  const f = await fixture();
  await withApi(f, async (call, _guard, _logout, apiDb) => {
    const original = apiDb.query.bind(apiDb);
    apiDb.query = (async (sql: string, parameters?: unknown[], runner?: QueryRunner) => {
      if (sql.startsWith('INSERT INTO mf06_authority_commit_witness'))
        throw new Error('Synthetic witness failure');
      return original(sql, parameters, runner);
    }) as typeof apiDb.query;
    try {
      const response = await call('CONTRACTOR');
      assert.equal(response.status, 201);
      const row = (await response.json()) as { id: string };
      const facts = await factsFor(row.id);
      assert.equal(facts.length, 1);
      assert.equal(facts[0].witnessed, null);
      assert.equal(await countCreated(f), 1);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM contractor_site_participation WHERE contractor_id=$1',
            [row.id],
          )
        )[0].n,
        1,
      );
    } finally {
      apiDb.query = original;
    }
  });
});
