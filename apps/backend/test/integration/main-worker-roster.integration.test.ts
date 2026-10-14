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
import { WorkforceController } from '../../src/modules/workforce/workforce.controller.js';
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
type Kind = 'CREATE' | 'PREPARE' | 'LINK';
async function fixture() {
  const f = {
    actor: randomUUID(),
    site: randomUUID(),
    contractor: randomUUID(),
    participation: randomUUID(),
    target: randomUUID(),
    worker: randomUUID(),
  };
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [f.actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), f.actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    f.site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [f.contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,clock_timestamp()-interval '1 day',NULL)",
    [f.participation, f.contractor, f.site],
  );
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic target','not-login',false)",
    [f.target],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'WORKER',$3)",
    [randomUUID(), f.target, f.site],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic unlinked')",
    [f.worker, f.site],
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
type Call = (kind: Kind, body?: unknown, siteId?: string, workerId?: string) => Promise<Response>;
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
    const controller = module.get(WorkforceController) as unknown as {
      auth: UserAuthGuard;
    };
    await work(
      (kind, body, id = f.site, worker = f.worker) =>
        fetch(
          url +
            '/api/v1/sites/' +
            id +
            '/workers' +
            (kind === 'PREPARE'
              ? '/for-account'
              : kind === 'LINK'
                ? '/' + worker + '/account'
                : ''),
          {
            method: kind === 'LINK' ? 'PUT' : 'POST',
            headers,
            body: JSON.stringify(
              body ??
                (kind === 'CREATE'
                  ? { externalId: f.workerInput.externalId, displayName: f.workerInput.displayName }
                  : { userId: f.target }),
            ),
          },
        ),
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

async function factsFor(id: string, actor: string) {
  return db.query(
    'SELECT f.source_kind,c.actor_user_id,c.operation,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=$1 AND c.actor_user_id=$2',
    [id, actor],
  );
}

for (const kind of ['CREATE', 'PREPARE', 'LINK'] as const)
  test('Worker roster ' + kind + ' emits actor-bound MAIN source fact', async () => {
    const f = await fixture();
    await withApi(f, async (call) => {
      const response = await call(kind);
      assert.equal(response.status, kind === 'LINK' ? 200 : 201);
      const row = (await response.json()) as { id: string };
      const facts = await factsFor(row.id, f.actor);
      assert.equal(facts.length, 1);
      assert.equal(facts[0].source_kind, 'WORKER');
      assert.equal(facts[0].actor_user_id, f.actor);
      assert.equal(facts[0].bound, true);
      assert.equal(facts[0].witnessed, true);
    });
  });
for (const kind of ['PREPARE', 'LINK'] as const)
  test('Worker roster ' + kind + ' restores MAIN global Admin authorization', async () => {
    const f = await fixture();
    await db.query("UPDATE user_role_assignment SET role='WORKER',site_id=$2 WHERE user_id=$1", [
      f.actor,
      f.site,
    ]);
    await withApi(f, async (call) => {
      assert.equal((await call(kind)).status, 403);
    });
  });

async function boundCount(f: Fixture, kind: Kind) {
  return (
    await db.query(
      kind === 'CREATE'
        ? 'SELECT count(*)::int AS n FROM worker WHERE site_id=$1 AND external_id=$2'
        : 'SELECT count(*)::int AS n FROM worker WHERE site_id=$1 AND user_id=$2',
      [f.site, kind === 'CREATE' ? f.workerInput.externalId : f.target],
    )
  )[0].n as number;
}
for (const kind of ['CREATE', 'PREPARE', 'LINK'] as const) {
  test(
    'Worker roster ' + kind + ' strict actor/command DTO and path inputs fail without changes',
    async () => {
      const f = await fixture();
      await withApi(f, async (call) => {
        const body =
          kind === 'CREATE'
            ? { externalId: f.workerInput.externalId, displayName: 'Synthetic' }
            : { userId: f.target };
        for (const extra of [{ actorUserId: f.actor }, { commandId: randomUUID() }])
          assert.equal((await call(kind, { ...body, ...extra })).status, 400);
        assert.equal((await call(kind, undefined, 'invalid')).status, 400);
        if (kind === 'LINK')
          assert.equal((await call(kind, undefined, f.site, 'invalid')).status, 400);
        assert.equal(await boundCount(f, kind), 0);
      });
    },
  );
  for (const change of ['LOGOUT', 'ROLE', 'DEACTIVATE', 'TEMP_PASSWORD'] as const)
    test(
      'Worker roster ' + kind + ' ' + change + ' before claim refuses the source mutation',
      async () => {
        const f = await fixture();
        await withApi(f, async (call, guard, logout) => {
          let enter!: () => void, release!: () => void;
          const claimed = new Promise<void>((r) => (enter = r)),
            hold = new Promise<void>((r) => (release = r));
          const original = guard.authenticateRequest.bind(guard);
          guard.authenticateRequest = async (r, m) => {
            if (m) {
              enter();
              await hold;
            }
            await original(r, m);
          };
          const pending = call(kind);
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              claimed,
              new Promise<never>(
                (_, rej) => (timer = setTimeout(() => rej(new Error('Claim not reached')), 3000)),
              ),
            ]);
            if (change === 'LOGOUT') assert.equal((await logout()).status, 204);
            if (change === 'ROLE')
              await db.query(
                "UPDATE user_role_assignment SET role='SITE_MANAGER',site_id=$2 WHERE user_id=$1",
                [f.actor, f.site],
              );
            if (change === 'DEACTIVATE')
              await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actor]);
            if (change === 'TEMP_PASSWORD')
              await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [
                f.actor,
              ]);
            release();
            assert.equal(
              (await pending).status,
              change === 'LOGOUT' || change === 'DEACTIVATE' ? 401 : 403,
            );
            assert.equal(await boundCount(f, kind), 0);
          } finally {
            if (timer) clearTimeout(timer);
            release();
            await pending;
          }
        });
      },
    );
  test(
    'Worker roster ' + kind + ' disabled or partial capture fails closed without writes',
    async () => {
      const f = await fixture();
      await withApi(f, async (call) => {
        await db.query('ALTER TABLE worker DISABLE TRIGGER trg_mf06_capture_worker');
        try {
          assert.equal((await call(kind)).status, 503);
          assert.equal(await boundCount(f, kind), 0);
        } finally {
          await db.query('ALTER TABLE worker ENABLE TRIGGER trg_mf06_capture_worker');
        }
        await db.query('ALTER TABLE mf06_authority_control RENAME TO mf06_authority_control_held');
        try {
          assert.equal((await call(kind)).status, 503);
          assert.equal(await boundCount(f, kind), 0);
        } finally {
          await db.query(
            'ALTER TABLE mf06_authority_control_held RENAME TO mf06_authority_control',
          );
        }
      });
    },
  );
  test(
    'Worker roster ' + kind + ' postcommit witness failure keeps committed response unconfirmed',
    async () => {
      const f = await fixture();
      await withApi(f, async (call, _g, _l, apiDb) => {
        const original = apiDb.query.bind(apiDb);
        apiDb.query = (async (sql: string, params?: unknown[], runner?: QueryRunner) => {
          if (sql.startsWith('INSERT INTO mf06_authority_commit_witness'))
            throw new Error('Synthetic witness refusal');
          return original(sql, params, runner);
        }) as typeof apiDb.query;
        try {
          const response = await call(kind);
          assert.equal(response.status, kind === 'LINK' ? 200 : 201);
          const row = (await response.json()) as { id: string };
          const facts = await factsFor(row.id, f.actor);
          assert.equal(facts.length, 1);
          assert.equal(facts[0].witnessed, null);
          assert.equal(await boundCount(f, kind), 1);
        } finally {
          apiDb.query = original;
        }
      });
    },
  );
}
test('Worker account linkage captures immutable old/new user IDs without changing Worker scope', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    assert.equal((await call('LINK')).status, 200);
    const fact = (
      await db.query(
        'SELECT before_payload,after_payload FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) WHERE f.source_id=$1 AND c.actor_user_id=$2',
        [f.worker, f.actor],
      )
    )[0];
    assert.equal(fact.before_payload.user_id, null);
    assert.equal(fact.after_payload.user_id, f.target);
    assert.equal(fact.before_payload.site_id, f.site);
    assert.equal(fact.after_payload.site_id, f.site);
    assert.equal(fact.after_payload.contractor_id, null);
  });
});
test('Concurrent account-first preparation returns one Worker and one INSERT fact', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const responses = await Promise.all([call('PREPARE'), call('PREPARE')]);
    assert(responses.every((r) => r.status === 201));
    const rows = (await Promise.all(responses.map((r) => r.json()))) as { id: string }[];
    const first = rows[0],
      second = rows[1];
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.id, second.id);
    assert.equal(await boundCount(f, 'PREPARE'), 1);
    assert.equal((await factsFor(first.id, f.actor)).length, 1);
  });
});
test('Account-first preparation uses existing active worker and refuses inactive linked worker', async () => {
  const f = await fixture();
  await db.query('UPDATE worker SET user_id=$2 WHERE id=$1', [f.worker, f.target]);
  await withApi(f, async (call) => {
    const r = await call('PREPARE');
    assert.equal(r.status, 201);
    assert.equal(((await r.json()) as { id: string }).id, f.worker);
    assert.equal((await factsFor(f.worker, f.actor)).length, 0);
    await db.query('UPDATE worker SET is_active=false WHERE id=$1', [f.worker]);
    assert.equal((await call('PREPARE')).status, 409);
    assert.equal(await boundCount(f, 'PREPARE'), 1);
  });
});
test('Account binding is repeatable to same user, refuses a different user and cross-Site Worker', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    assert.equal((await call('LINK')).status, 200);
    assert.equal((await call('LINK')).status, 200);
    assert.equal((await factsFor(f.worker, f.actor)).length, 1);
    assert.equal((await call('LINK', { userId: f.actor })).status, 409);
    const other = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic other')", [
      other,
    ]);
    assert.equal((await call('LINK', undefined, other)).status, 404);
  });
});
for (const kind of ['PREPARE', 'LINK'] as const)
  test(
    'Worker roster ' + kind + ' requires active target with exact Site role or global Admin',
    async () => {
      const f = await fixture();
      await withApi(f, async (call) => {
        assert.equal((await call(kind, { userId: randomUUID() })).status, 409);
        await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.target]);
        assert.equal((await call(kind)).status, 409);
        await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [f.target]);
        await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.target]);
        assert.equal((await call(kind)).status, 409);
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
          [randomUUID(), f.target],
        );
        assert.equal((await call(kind)).status, kind === 'LINK' ? 200 : 201);
      });
    },
  );
test('Worker roster creation keeps contractor/account pair, WORKER role and participation eligibility', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const input = {
      externalId: f.workerInput.externalId,
      displayName: 'Synthetic',
      contractorId: f.contractor,
      userId: f.target,
    };
    assert.equal(
      (
        await call('CREATE', {
          externalId: input.externalId,
          displayName: 'Synthetic',
          contractorId: f.contractor,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call('CREATE', {
          externalId: input.externalId,
          displayName: 'Synthetic',
          userId: f.target,
        })
      ).status,
      400,
    );
    await db.query("UPDATE user_role_assignment SET role='SITE_MANAGER' WHERE user_id=$1", [
      f.target,
    ]);
    assert.equal((await call('CREATE', input)).status, 404);
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [f.target]);
    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    assert.equal((await call('CREATE', input)).status, 404);
    await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [f.contractor]);
    await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
      f.participation,
    ]);
    assert.equal((await call('CREATE', input)).status, 404);
    await db.query('UPDATE contractor_site_participation SET is_active=true WHERE id=$1', [
      f.participation,
    ]);
    const r = await call('CREATE', input);
    assert.equal(r.status, 201);
    const row = (await r.json()) as { contractorId: string; userId: string };
    assert.equal(row.contractorId, f.contractor);
    assert.equal(row.userId, f.target);
    assert.equal((await call('CREATE', { ...input, externalId: randomUUID() })).status, 409);
    assert.equal((await call('CREATE', input)).status, 409);
  });
});
test('Account-first natural-key collision returns409 and leaves no linked Worker/fact', async () => {
  const f = await fixture();
  await db.query('UPDATE worker SET external_id=$2 WHERE id=$1', [f.worker, 'ACC-' + f.target]);
  await withApi(f, async (call) => {
    assert.equal((await call('PREPARE')).status, 409);
    assert.equal(await boundCount(f, 'PREPARE'), 0);
    assert.equal((await factsFor(f.worker, f.actor)).length, 0);
  });
});
