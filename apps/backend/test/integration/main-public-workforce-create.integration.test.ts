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
type Kind = 'CONTRACTOR' | 'WORKER' | 'SITE_CONTRACTOR';

for (const role of ['SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER']) {
  test(`Site Contractor catalog creation refuses ${role} without global Admin`, async () => {
    const f = await fixture();
    await db.query('UPDATE user_role_assignment SET role=$1,site_id=$2 WHERE user_id=$3', [
      role,
      f.site,
      f.actor,
    ]);
    await withApi(f, async (call) => {
      assert.equal((await call('SITE_CONTRACTOR')).status, 403);
      assert.equal(await createdCount(f, 'SITE_CONTRACTOR'), 0);
    });
  });
}

test('Site Contractor catalog keeps optional codes, same-code reuse and name conflicts without participation', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const input = { name: 'Synthetic generated catalog entry' };
    const response = await call('SITE_CONTRACTOR', input);
    assert.equal(response.status, 201);
    const row = (await response.json()) as { id: string; code: string; siteId: string };
    assert.match(row.code, /^CTR-[0-9A-F-]{36}$/);
    assert.equal(row.siteId, f.site);
    const repeated = await call('SITE_CONTRACTOR', { ...input, code: row.code });
    assert.equal(repeated.status, 201);
    assert.equal(((await repeated.json()) as { id: string }).id, row.id);
    assert.equal(
      (await call('SITE_CONTRACTOR', { name: 'Different name', code: row.code })).status,
      409,
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM contractor_site_participation WHERE contractor_id=$1',
          [row.id],
        )
      )[0].n,
      0,
    );
  });
});

async function fixture(kind: Kind = 'CONTRACTOR') {
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
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [f.contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,clock_timestamp()-interval '1 day',NULL)",
    [f.participation, f.contractor, f.site],
  );
  await db.query('INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    f.actor,
    kind === 'WORKER' ? 'CONTRACTOR_REPRESENTATIVE' : 'ADMIN',
    kind === 'WORKER' ? f.site : null,
  ]);
  if (kind === 'WORKER')
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), f.actor, f.contractor],
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
    const controller = module.get(ContractorOperationsController) as unknown as {
      auth: UserAuthGuard;
    };
    await work(
      (kind, body, id = f.contractor) =>
        fetch(
          url +
            '/api/v1' +
            (kind === 'SITE_CONTRACTOR'
              ? '/sites/' + f.site + '/contractors'
              : '/contractors' + (kind === 'WORKER' ? '/' + id + '/workers' : '')),
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body ?? (kind === 'WORKER' ? f.workerInput : f.contractorInput)),
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
async function createdCount(f: Fixture, kind: Kind) {
  const sql =
    kind === 'WORKER'
      ? 'SELECT count(*)::int AS n FROM worker WHERE site_id=$1 AND external_id=$2'
      : 'SELECT count(*)::int AS n FROM contractor WHERE code=$1';
  return (
    await db.query(
      sql,
      kind === 'WORKER' ? [f.site, f.workerInput.externalId] : [f.contractorInput.code],
    )
  )[0].n as number;
}
for (const kind of ['CONTRACTOR', 'WORKER', 'SITE_CONTRACTOR'] as const) {
  test(
    'public ' + kind + ' create emits actor-bound same-transaction MF06 source fact and witness',
    async () => {
      const f = await fixture(kind);
      const policy = (
        await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.site])
      )[0].access_policy_version;
      const audits = (await db.query('SELECT count(*)::int AS n FROM audit_log'))[0].n;
      await withApi(f, async (call) => {
        const response = await call(kind);
        assert.equal(response.status, 201);
        const row = (await response.json()) as { id: string; isActive: boolean };
        assert.equal(row.isActive, true);
        const fact = (
          await db.query(
            'SELECT f.source_kind,c.actor_user_id,c.operation,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) LEFT JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1',
            [row.id],
          )
        )[0];
        assert.equal(fact?.source_kind, kind === 'SITE_CONTRACTOR' ? 'CONTRACTOR' : kind);
        assert.equal(fact.actor_user_id, f.actor);
        assert.equal(fact.bound, true);
        assert.equal(fact.witnessed, true);
        assert.equal(await createdCount(f, kind), 1);
        assert.equal(
          (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.site]))[0]
            .access_policy_version,
          policy,
        );
        assert.equal((await db.query('SELECT count(*)::int AS n FROM audit_log'))[0].n, audits);
        if (kind === 'SITE_CONTRACTOR') {
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM contractor_site_participation WHERE contractor_id=$1',
                [row.id],
              )
            )[0].n,
            0,
            'Catalog creation must not enroll a Contractor into a Site',
          );
        }
        if (kind === 'WORKER') {
          assert.equal(
            (await db.query('SELECT user_id FROM worker WHERE id=$1', [row.id]))[0].user_id,
            null,
          );
          assert.equal(
            (
              await db.query(
                'SELECT count(*)::int AS n FROM worker_site_zone_assignment WHERE worker_id=$1',
                [row.id],
              )
            )[0].n,
            0,
          );
        }
      });
    },
  );
}
for (const kind of ['CONTRACTOR', 'WORKER', 'SITE_CONTRACTOR'] as const) {
  test(
    'public ' +
      kind +
      ' strict attribution rejection and repeat handling produce no extra source or journal fact',
    async () => {
      const f = await fixture(kind);
      await withApi(f, async (call) => {
        const input = kind === 'WORKER' ? f.workerInput : f.contractorInput;
        for (const extra of [{ actorUserId: f.actor }, { commandId: randomUUID() }])
          assert.equal((await call(kind, { ...input, ...extra })).status, 400);
        assert.equal(await createdCount(f, kind), 0);
        const response = await call(kind);
        assert.equal(response.status, 201);
        const row = (await response.json()) as { id: string };
        assert.equal((await call(kind)).status, kind === 'SITE_CONTRACTOR' ? 201 : 409);
        assert.equal(await createdCount(f, kind), 1);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM authorization_history_revision WHERE source_id=$1',
              [row.id],
            )
          )[0].n,
          1,
        );
      });
    },
  );
  for (const change of ['LOGOUT', 'ROLE', 'DEACTIVATE', 'TEMP_PASSWORD'] as const) {
    test('held public ' + kind + ' refuses ' + change + ' before transaction claim', async () => {
      const f = await fixture(kind);
      await withApi(f, async (call, guard, logout) => {
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
        const pending = call(kind);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            claimed,
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('Transaction claim not reached')), 3000);
            }),
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
            await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actor]);
          release();
          assert.equal(
            (await pending).status,
            change === 'LOGOUT' || change === 'DEACTIVATE' ? 401 : 403,
          );
          assert.equal(await createdCount(f, kind), 0);
        } finally {
          if (timer) clearTimeout(timer);
          release();
          await pending;
        }
      });
    });
  }
  test(
    'public ' + kind + ' refuses disabled capture and partial journal without source writes',
    async () => {
      const f = await fixture(kind),
        table = kind === 'WORKER' ? 'worker' : 'contractor';
      await withApi(f, async (call) => {
        await db.query('ALTER TABLE ' + table + ' DISABLE TRIGGER trg_mf06_capture_' + table);
        try {
          assert.equal((await call(kind)).status, 503);
          assert.equal(await createdCount(f, kind), 0);
        } finally {
          await db.query('ALTER TABLE ' + table + ' ENABLE TRIGGER trg_mf06_capture_' + table);
        }
        await db.query(
          'ALTER TABLE authorization_history_control RENAME TO mf06_authority_control_held',
        );
        try {
          assert.equal((await call(kind)).status, 503);
          assert.equal(await createdCount(f, kind), 0);
        } finally {
          await db.query(
            'ALTER TABLE mf06_authority_control_held RENAME TO authorization_history_control',
          );
        }
      });
    },
  );
  test(
    'public ' + kind + ' witness failure preserves committed201 with unconfirmed history',
    async () => {
      const f = await fixture(kind);
      await withApi(f, async (call, _guard, _logout, apiDb) => {
        const original = apiDb.query.bind(apiDb);
        apiDb.query = async (...args: Parameters<DataSource['query']>) => {
          if (
            typeof args[0] === 'string' &&
            args[0].startsWith('INSERT INTO authorization_history_commit_receipt')
          )
            throw new Error('Synthetic witness failure');
          return original(...args);
        };
        const response = await call(kind);
        assert.equal(response.status, 201);
        const row = (await response.json()) as { id: string };
        assert.equal(await createdCount(f, kind), 1);
        const facts = await db.query(
          'SELECT w.command_id FROM authorization_history_revision f LEFT JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1',
          [row.id],
        );
        assert.equal(facts.length, 1);
        assert.equal(facts[0].command_id, null);
      });
    },
  );
}
test('Contractor creation requires global Admin while Worker creation accepts only exact scoped Representative with grant', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    assert.equal((await call('WORKER')).status, 403);
    await db.query(
      "UPDATE user_role_assignment SET role='CONTRACTOR_REPRESENTATIVE',site_id=$2 WHERE user_id=$1",
      [f.actor, f.site],
    );
    assert.equal((await call('CONTRACTOR')).status, 403);
    assert.equal((await call('WORKER')).status, 403);
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), f.actor, f.contractor],
    );
    const otherSite = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Other synthetic Site')",
      [otherSite],
    );
    assert.equal((await call('WORKER', { ...f.workerInput, siteId: otherSite })).status, 403);
    assert.equal((await call('WORKER')).status, 201);
    assert.equal(await createdCount(f, 'CONTRACTOR'), 0);
    assert.equal(await createdCount(f, 'WORKER'), 1);
  });
});
test('scoped Representative cannot create Worker for inactive Contractor or inactive expired future or missing participation', async () => {
  const f = await fixture('WORKER');
  await withApi(f, async (call) => {
    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    assert.equal((await call('WORKER')).status, 403);
    await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [f.contractor]);
    await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
      f.participation,
    ]);
    assert.equal((await call('WORKER')).status, 403);
    await db.query(
      "UPDATE contractor_site_participation SET is_active=true,valid_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [f.participation],
    );
    assert.equal((await call('WORKER')).status, 403);
    await db.query(
      "UPDATE contractor_site_participation SET valid_from=clock_timestamp()+interval '1 day',valid_until=NULL WHERE id=$1",
      [f.participation],
    );
    assert.equal((await call('WORKER')).status, 403);
    await db.query('DELETE FROM contractor_site_participation WHERE id=$1', [f.participation]);
    assert.equal((await call('WORKER')).status, 403);
    assert.equal(await createdCount(f, 'WORKER'), 0);
  });
});
test('Worker create refuses ungranted Contractor403 malformed400 and invalid body400 with no source write', async () => {
  const f = await fixture('WORKER');
  await withApi(f, async (call) => {
    assert.equal((await call('WORKER', undefined, randomUUID())).status, 403);
    assert.equal((await call('WORKER', undefined, 'bad-id')).status, 400);
    assert.equal((await call('WORKER', { ...f.workerInput, siteId: 'bad-site' })).status, 400);
    assert.equal((await call('WORKER', { ...f.workerInput, displayName: '\u0001' })).status, 400);
    assert.equal(await createdCount(f, 'WORKER'), 0);
  });
});
test('held Representative Worker create rechecks exact Contractor grant before source mutation', async () => {
  const f = await fixture();
  await db.query(
    "UPDATE user_role_assignment SET role='CONTRACTOR_REPRESENTATIVE',site_id=$2 WHERE user_id=$1",
    [f.actor, f.site],
  );
  const grant = randomUUID();
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [grant, f.actor, f.contractor],
  );
  await withApi(f, async (call, guard) => {
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
    const pending = call('WORKER');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        claimed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Transaction claim not reached')), 3000);
        }),
      ]);
      await db.query('DELETE FROM contractor_representative_grant WHERE id=$1', [grant]);
      release();
      assert.equal((await pending).status, 403);
      assert.equal(await createdCount(f, 'WORKER'), 0);
    } finally {
      if (timer) clearTimeout(timer);
      release();
      await pending;
    }
  });
});
