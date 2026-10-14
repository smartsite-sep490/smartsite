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
import { ContractorOperationsController } from '../../src/modules/workforce/contractor-operations.controller.js';
import { ContractorsController } from '../../src/modules/workforce/contractors.controller.js';
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

type Kind = 'GRANT' | 'ASSIGN';

async function fixture() {
  const f = {
    actor: randomUUID(),
    site: randomUUID(),
    otherSite: randomUUID(),
    contractor: randomUUID(),
    participation: randomUUID(),
    target: randomUUID(),
  };

  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic admin actor','not-login',false,true)",
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
    "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Other Site')",
    [f.otherSite],
  );
  await db.query(
    "INSERT INTO contractor(id,code,name,is_active) VALUES($1,$1::uuid::text,'Synthetic Contractor',true)",
    [f.contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,clock_timestamp()-interval '1 day',NULL,true)",
    [f.participation, f.contractor, f.site],
  );
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic target user','not-login',false,true)",
    [f.target],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
    [randomUUID(), f.target, f.site],
  );

  return f;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Call = (
  kind: Kind,
  body?: unknown,
  contractorId?: string,
  siteId?: string,
) => Promise<Response>;

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
    // Patch the actual injected command reauthorization provider, not another Nest module's guard.
    const guard = (module.get(ContractorOperationsController) as unknown as { auth: UserAuthGuard })
      .auth;
    const siteGuard = (module.get(ContractorsController) as unknown as { auth: UserAuthGuard })
      .auth;
    assert.equal(siteGuard, guard);
    await work(
      (kind, body, contractor = f.contractor, site = f.site) =>
        fetch(
          url +
            '/api/v1' +
            (kind === 'GRANT'
              ? '/contractors/' + contractor + '/representative-grants'
              : '/sites/' + site + '/contractors/' + contractor + '/representatives'),
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body ?? { userId: f.target }),
          },
        ),
      guard,
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
    'SELECT f.source_kind, c.actor_user_id, c.operation, f.transaction_id=c.transaction_id AS bound, w.transaction_id=c.transaction_id AS witnessed, e.state AS epoch_state FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) LEFT JOIN mf06_authority_epoch e ON e.epoch_id=f.epoch_id WHERE f.source_id=$1 AND c.actor_user_id=$2',
    [id, actor],
  );
}

async function grantCount(contractorId: string, userId: string): Promise<number> {
  const rows = await db.query(
    'SELECT count(*)::int AS n FROM contractor_representative_grant WHERE contractor_id=$1 AND user_id=$2',
    [contractorId, userId],
  );
  return rows[0].n as number;
}

async function assignmentCount(
  siteId: string,
  contractorId: string,
  userId: string,
): Promise<number> {
  const rows = await db.query(
    'SELECT count(*)::int AS n FROM contractor_representative_assignment WHERE site_id=$1 AND contractor_id=$2 AND user_id=$3',
    [siteId, contractorId, userId],
  );
  return rows[0].n as number;
}

test('Representative global grant emits actor-bound MAIN source fact and witness, no READY', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const response = await call('GRANT');
    assert.equal(response.status, 201);
    const row = (await response.json()) as { id: string; userId: string; contractorId: string };
    assert.equal(row.userId, f.target);
    assert.equal(row.contractorId, f.contractor);
    assert.equal(await grantCount(f.contractor, f.target), 1);

    const facts = await factsFor(row.id, f.actor);
    assert.equal(facts.length, 1);
    assert.equal(facts[0].source_kind, 'REPRESENTATIVE_GRANT');
    assert.equal(facts[0].actor_user_id, f.actor);
    assert.equal(facts[0].operation, 'MAIN_REPRESENTATIVE_GRANT');
    assert.equal(facts[0].bound, true);
    assert.equal(facts[0].witnessed, true);
    assert.notEqual(facts[0].epoch_state, 'READY');
  });
});

test('Representative global grant repeat idempotent call is no-op with no fake facts', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const first = await call('GRANT');
    assert.equal(first.status, 201);
    const firstRow = (await first.json()) as { id: string };

    const second = await call('GRANT');
    assert.ok(second.status === 200 || second.status === 201);
    const secondRow = (await second.json()) as { id: string };
    assert.equal(secondRow.id, firstRow.id);

    assert.equal(await grantCount(f.contractor, f.target), 1);
    const facts = await factsFor(firstRow.id, f.actor);
    assert.equal(facts.length, 1);
  });
});

test('Representative global grant permits inactive target user and contractor if target has REP role', async () => {
  const f = await fixture();
  await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.target]);
  await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);

  await withApi(f, async (call) => {
    const response = await call('GRANT');
    assert.equal(response.status, 201);
    assert.equal(await grantCount(f.contractor, f.target), 1);

    await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.target]);
    const rejected = await call('GRANT');
    assert.equal(rejected.status, 400);
  });
});

test('Representative site assignment creates both grant and assignment when grant missing', async () => {
  const f = await fixture();
  assert.equal(await grantCount(f.contractor, f.target), 0);
  assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);

  await withApi(f, async (call) => {
    const response = await call('ASSIGN');
    assert.equal(response.status, 201);
    const row = (await response.json()) as {
      id: string;
      siteId: string;
      contractorId: string;
      userId: string;
    };
    assert.equal(row.siteId, f.site);
    assert.equal(row.contractorId, f.contractor);
    assert.equal(row.userId, f.target);

    assert.equal(await assignmentCount(f.site, f.contractor, f.target), 1);
    assert.equal(await grantCount(f.contractor, f.target), 1);

    const assignmentFacts = await factsFor(row.id, f.actor);
    assert.equal(assignmentFacts.length, 1);
    assert.equal(assignmentFacts[0].source_kind, 'REPRESENTATIVE_ASSIGNMENT');
    assert.equal(assignmentFacts[0].actor_user_id, f.actor);
    assert.equal(assignmentFacts[0].operation, 'MAIN_REPRESENTATIVE_ASSIGN');
    assert.equal(assignmentFacts[0].bound, true);
    assert.equal(assignmentFacts[0].witnessed, true);
    assert.notEqual(assignmentFacts[0].epoch_state, 'READY');

    const grantRows = await db.query(
      'SELECT id FROM contractor_representative_grant WHERE contractor_id=$1 AND user_id=$2',
      [f.contractor, f.target],
    );
    assert.equal(grantRows.length, 1);
    const grantFacts = await factsFor(grantRows[0].id, f.actor);
    assert.equal(grantFacts.length, 1);
    assert.equal(grantFacts[0].source_kind, 'REPRESENTATIVE_GRANT');
    assert.equal(grantFacts[0].bound, true);
  });
});

test('Representative site assignment creates only assignment when grant already exists', async () => {
  const f = await fixture();
  const grantId = randomUUID();
  await db.query(
    'INSERT INTO contractor_representative_grant(id,contractor_id,user_id) VALUES($1,$2,$3)',
    [grantId, f.contractor, f.target],
  );
  assert.equal(await grantCount(f.contractor, f.target), 1);

  await withApi(f, async (call) => {
    const response = await call('ASSIGN');
    assert.equal(response.status, 201);
    const row = (await response.json()) as { id: string };

    assert.equal(await assignmentCount(f.site, f.contractor, f.target), 1);
    assert.equal(await grantCount(f.contractor, f.target), 1);

    const assignmentFacts = await factsFor(row.id, f.actor);
    assert.equal(assignmentFacts.length, 1);
    assert.equal(assignmentFacts[0].source_kind, 'REPRESENTATIVE_ASSIGNMENT');
  });
});

test('Representative site assignment repeat idempotent call is no-op with no fake facts', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    const first = await call('ASSIGN');
    assert.equal(first.status, 201);
    const firstRow = (await first.json()) as { id: string };

    const second = await call('ASSIGN');
    assert.ok(second.status === 200 || second.status === 201);
    const secondRow = (await second.json()) as { id: string };
    assert.equal(secondRow.id, firstRow.id);

    assert.equal(await assignmentCount(f.site, f.contractor, f.target), 1);
    const facts = await factsFor(firstRow.id, f.actor);
    assert.equal(facts.length, 1);
  });
});

test('Representative site assignment requires active target, active contractor, exact role, current participation', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    assert.equal((await call('ASSIGN', { userId: randomUUID() })).status, 404);

    await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.target]);
    assert.equal((await call('ASSIGN')).status, 404);
    await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [f.target]);

    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    assert.equal((await call('ASSIGN')).status, 404);
    await db.query('UPDATE contractor SET is_active=true WHERE id=$1', [f.contractor]);

    await db.query(
      "UPDATE user_role_assignment SET site_id=$2 WHERE user_id=$1 AND role='CONTRACTOR_REPRESENTATIVE'",
      [f.target, f.otherSite],
    );
    assert.equal((await call('ASSIGN')).status, 404);

    await db.query("UPDATE user_role_assignment SET role='WORKER', site_id=$2 WHERE user_id=$1", [
      f.target,
      f.site,
    ]);
    assert.equal((await call('ASSIGN')).status, 404);

    await db.query(
      "UPDATE user_role_assignment SET role='CONTRACTOR_REPRESENTATIVE', site_id=$2 WHERE user_id=$1",
      [f.target, f.site],
    );

    await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
      f.participation,
    ]);
    assert.equal((await call('ASSIGN')).status, 404);
    await db.query('UPDATE contractor_site_participation SET is_active=true WHERE id=$1', [
      f.participation,
    ]);

    await db.query(
      "UPDATE contractor_site_participation SET valid_until=clock_timestamp()-interval '1 hour' WHERE id=$1",
      [f.participation],
    );
    assert.equal((await call('ASSIGN')).status, 404);

    await db.query(
      "UPDATE contractor_site_participation SET valid_from=clock_timestamp()+interval '1 day', valid_until=NULL WHERE id=$1",
      [f.participation],
    );
    assert.equal((await call('ASSIGN')).status, 404);

    await db.query(
      "UPDATE contractor_site_participation SET valid_from=clock_timestamp()-interval '1 day', valid_until=NULL WHERE id=$1",
      [f.participation],
    );
    assert.equal((await call('ASSIGN')).status, 201);
  });
});

test('Representative global synthetic unique-source collision maps409 and rolls back command', async () => {
  const f = await fixture();
  await withApi(f, async (call) => {
    // Inject the actual PostgreSQL error/constraint boundary; this is not a concurrent dedup claim.
    await db.query(`CREATE FUNCTION test_representative_unique_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic representative natural-key collision'
      USING ERRCODE='23505', CONSTRAINT='uq_contractor_representative_grant'; END $$`);
    await db.query(
      'CREATE TRIGGER test_representative_unique_failure BEFORE INSERT ON contractor_representative_grant FOR EACH ROW EXECUTE FUNCTION test_representative_unique_failure()',
    );
    try {
      assert.equal((await call('GRANT')).status, 409);
      assert.equal(await grantCount(f.contractor, f.target), 0);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM mf06_authority_command WHERE actor_user_id=$1',
            [f.actor],
          )
        )[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) WHERE c.actor_user_id=$1',
            [f.actor],
          )
        )[0].n,
        0,
      );
    } finally {
      await db.query(
        'DROP TRIGGER test_representative_unique_failure ON contractor_representative_grant',
      );
      await db.query('DROP FUNCTION test_representative_unique_failure()');
    }
  });
});

test('Representative site assignment source failure rolls back newly created grant and facts', async () => {
  const f = await fixture();
  assert.equal(await grantCount(f.contractor, f.target), 0);
  assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);

  await withApi(f, async (call) => {
    await db.query(
      `CREATE FUNCTION test_representative_insert_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic assignment source failure' USING ERRCODE='23514'; END $$`,
    );
    await db.query(
      'CREATE TRIGGER test_representative_insert_failure BEFORE INSERT ON contractor_representative_assignment FOR EACH ROW EXECUTE FUNCTION test_representative_insert_failure()',
    );
    try {
      const response = await call('ASSIGN');
      assert.equal(response.status, 500);
      assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
      assert.equal(await grantCount(f.contractor, f.target), 0);

      const facts = await db.query(
        'SELECT count(*)::int AS n FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) WHERE c.actor_user_id=$1',
        [f.actor],
      );
      assert.equal(facts[0].n, 0);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM mf06_authority_command WHERE actor_user_id=$1',
            [f.actor],
          )
        )[0].n,
        0,
      );
    } finally {
      await db.query(
        'DROP TRIGGER test_representative_insert_failure ON contractor_representative_assignment',
      );
      await db.query('DROP FUNCTION test_representative_insert_failure()');
    }
  });
});

for (const kind of ['GRANT', 'ASSIGN'] as const) {
  test('Representative ' + kind + ' retains the MAIN password-change-required reason', async () => {
    const f = await fixture();
    await withApi(f, async (call) => {
      await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actor]);
      const response = await call(kind);
      assert.equal(response.status, 403);
      const error = (await response.json()) as { code: string };
      assert.equal(error.code, 'PASSWORD_CHANGE_REQUIRED');
      assert.equal(await grantCount(f.contractor, f.target), 0);
      assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
    });
  });
  test(
    'Representative ' +
      kind +
      ' strict actor/command DTO and path validation fails without changes',
    async () => {
      const f = await fixture();
      await withApi(f, async (call) => {
        for (const extra of [{ actorUserId: f.actor }, { commandId: randomUUID() }]) {
          assert.equal((await call(kind, { userId: f.target, ...extra })).status, 400);
        }
        assert.equal((await call(kind, undefined, 'invalid')).status, 400);
        if (kind === 'ASSIGN') {
          assert.equal((await call(kind, undefined, f.contractor, 'invalid')).status, 400);
        }
        assert.equal(await grantCount(f.contractor, f.target), 0);
        assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
      });
    },
  );

  test('Representative ' + kind + ' non-admin actor receives 403 Forbidden', async () => {
    const f = await fixture();
    await db.query(
      "UPDATE user_role_assignment SET role='SITE_MANAGER',site_id=$2 WHERE user_id=$1",
      [f.actor, f.site],
    );
    await withApi(f, async (call) => {
      assert.equal((await call(kind)).status, 403);
      assert.equal(await grantCount(f.contractor, f.target), 0);
      assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
    });
  });

  for (const change of ['LOGOUT', 'ROLE', 'DEACTIVATE', 'TEMP_PASSWORD'] as const) {
    test(
      'Representative ' + kind + ' ' + change + ' before claim refuses the source mutation',
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
            const refused = await pending;
            assert.equal(
              refused.status,
              change === 'LOGOUT' || change === 'DEACTIVATE' ? 401 : 403,
            );
            if (change === 'TEMP_PASSWORD')
              assert.equal(
                ((await refused.json()) as { code: string }).code,
                'PASSWORD_CHANGE_REQUIRED',
              );
            assert.equal(await grantCount(f.contractor, f.target), 0);
            assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
          } finally {
            if (timer) clearTimeout(timer);
            release();
            await pending;
          }
        });
      },
    );
  }

  test(
    'Representative ' + kind + ' disabled or partial capture fails closed without writes',
    async () => {
      const f = await fixture();
      const tables =
        kind === 'GRANT'
          ? ['contractor_representative_grant']
          : ['contractor_representative_grant', 'contractor_representative_assignment'];
      await withApi(f, async (call) => {
        for (const table of tables) {
          const trigger = 'trg_mf06_capture_' + table;
          await db.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
          try {
            assert.equal((await call(kind)).status, 503);
            assert.equal(await grantCount(f.contractor, f.target), 0);
            assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
          } finally {
            await db.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
          }
        }
        await db.query('ALTER TABLE mf06_authority_control RENAME TO mf06_authority_control_held');
        try {
          assert.equal((await call(kind)).status, 503);
          assert.equal(await grantCount(f.contractor, f.target), 0);
          assert.equal(await assignmentCount(f.site, f.contractor, f.target), 0);
        } finally {
          await db.query(
            'ALTER TABLE mf06_authority_control_held RENAME TO mf06_authority_control',
          );
        }
      });
    },
  );

  test(
    'Representative ' + kind + ' postcommit witness failure keeps committed response unconfirmed',
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
          assert.equal(response.status, 201);
          const row = (await response.json()) as { id: string };
          const facts = await factsFor(row.id, f.actor);
          assert.equal(facts.length, 1);
          assert.equal(facts[0].witnessed, null);
          if (kind === 'GRANT') {
            assert.equal(await grantCount(f.contractor, f.target), 1);
          } else {
            assert.equal(await assignmentCount(f.site, f.contractor, f.target), 1);
          }
        } finally {
          apiDb.query = original;
        }
      });
    },
  );
}
