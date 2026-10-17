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
import { hashPassword } from '../../src/modules/auth/password.js';
import { WorkerAssignmentController } from '../../src/modules/workforce/directory/worker-assignment.controller.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';
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
  const f = Object.fromEntries(
    ['actor', 'site', 'contractor', 'participation', 'worker', 'zone'].map((k) => [
      k,
      randomUUID(),
    ]),
  ) as Record<'actor' | 'site' | 'contractor' | 'participation' | 'worker' | 'zone', string>;
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [f.actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    f.site,
  ]);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
    [randomUUID(), f.actor, f.site],
  );
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [f.contractor],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), f.actor, f.contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-01-01Z','2028-01-01Z')",
    [f.participation, f.contractor, f.site],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [f.worker, f.site, f.contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [f.zone, f.site],
  );
  return {
    ...f,
    actors: new Map<string, string>([['CONTRACTOR_REPRESENTATIVE', f.actor]]),
    input: {
      siteId: f.site,
      zoneIds: [f.zone],
      validFrom: '2026-10-01T00:00:00.000001Z',
      validUntil: '2027-12-01T00:00:00.000002Z',
    },
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
type ActorRole = 'CONTRACTOR_REPRESENTATIVE' | 'SAFETY_OFFICER' | 'SITE_MANAGER';
async function asRole(f: Fixture, value: ActorRole) {
  let actor = f.actors.get(value);
  if (!actor) {
    actor = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic reviewer','not-login',false)",
      [actor],
    );
    await db.query(
      'INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), actor, value, f.site],
    );
    f.actors.set(value, actor);
  }
  f.actor = actor;
  return actor;
}
type Assignment = {
  id: string;
  siteContractorId: string | null;
  status: string;
  version: number;
  reviewNote: string | null;
  [key: string]: unknown;
};
async function seeded(f: Fixture, approve = false) {
  const service = new MainAssignmentCommandService(db);
  const originalActor = f.actor;
  try {
    await asRole(f, 'CONTRACTOR_REPRESENTATIVE');
    const r = await service.request({
      ...f.input,
      workerId: f.worker,
      actorUserId: f.actor,
      commandId: randomUUID(),
    });
    if (!approve) return r.assignment;
    await asRole(f, 'SITE_MANAGER');
    return (
      await service.decision({
        actorUserId: f.actor,
        siteId: f.site,
        commandId: randomUUID(),
        assignmentId: r.assignment.id,
        approve: true,
      })
    ).assignment;
  } finally {
    f.actor = originalActor;
  }
}
type ApiRequest = (path: string, body?: unknown, method?: string) => Promise<Response>;
interface ApiActorSession {
  request: ApiRequest;
  logout: () => Promise<Response>;
  actorId: string;
}
async function withApi(
  f: Fixture,
  work: (
    request: (path: string, body?: unknown, method?: string) => Promise<Response>,
    guard: UserAuthGuard,
    logout: () => Promise<Response>,
    loginAs: (value: ActorRole) => Promise<ApiActorSession>,
  ) => Promise<void>,
) {
  const password = 'SyntheticAssignment123!';
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
    const loginActor = async (actorId: string): Promise<ApiActorSession> => {
      await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
        actorId,
        await hashPassword(password),
      ]);
      const login = await fetch(`${url}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: actorId, password, clientType: 'MOBILE' }),
      });
      assert.equal(login.status, 200);
      const session = (await login.json()) as { accessToken: string; refreshToken: string };
      const request: ApiRequest = (path, body, method = 'POST') =>
        fetch(`${url}/api/v1${path}`, {
          method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.accessToken}`,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      return {
        actorId,
        request,
        logout: () =>
          request('/auth/logout', { clientType: 'MOBILE', refreshToken: session.refreshToken }),
      };
    };
    const session = await loginActor(f.actor);
    const controller = module.get(WorkerAssignmentController) as unknown as { auth: UserAuthGuard };
    await work(session.request, controller.auth, session.logout, async (value) =>
      loginActor(await asRole(f, value)),
    );
  } finally {
    await app.close();
    if (apiDatabase.isInitialized) await apiDatabase.destroy();
  }
}
test('actual public assignment request stores retained-main participation anchor and actor-bound source fact', async () => {
  const f = await fixture();
  await withApi(f, async (request) => {
    const response = await request(`/workers/${f.worker}/site-zone-assignment-requests`, f.input);
    assert.equal(response.status, 201);
    const a = (await response.json()) as Assignment;
    const stored = (
      await db.query('SELECT site_contractor_id FROM worker_site_zone_assignment WHERE id=$1', [
        a.id,
      ])
    )[0];
    assert.equal(stored.site_contractor_id, f.participation);
    const fact = (
      await db.query(
        'SELECT c.actor_user_id,c.operation FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) WHERE f.source_id=$1 ORDER BY revision DESC LIMIT 1',
        [a.id],
      )
    )[0];
    assert.equal(fact?.actor_user_id, f.actor);
    assert.equal(fact.operation, 'ASSIGNMENT_REQUEST');
  });
});
test('actual public assignment decision retains main direct PENDING approval', async () => {
  const f = await fixture(),
    a = await seeded(f);
  await asRole(f, 'SITE_MANAGER');
  await withApi(f, async (request) => {
    const response = await request(`/site-zone-assignment-requests/${a.id}/site-manager-decision`, {
      approve: true,
    });
    assert.equal(response.status, 201);
    assert.equal(((await response.json()) as Assignment).status, 'APPROVED');
  });
});
test('actual public decision accepts retained-main expectedVersion and reviewNote', async () => {
  const f = await fixture(),
    a = await seeded(f);
  await asRole(f, 'SITE_MANAGER');
  await withApi(f, async (request) => {
    const response = await request(`/site-zone-assignment-requests/${a.id}/site-manager-decision`, {
      approve: false,
      expectedVersion: 1,
      reviewNote: ' Review ',
    });
    assert.equal(response.status, 201);
    const value = (await response.json()) as Assignment;
    assert.equal(value.status, 'REJECTED');
    assert.equal(value.version, 2);
    assert.equal(value.reviewNote, 'Review');
  });
});
test('actual public assignment revoke route retains main version and reason', async () => {
  const f = await fixture(),
    a = await seeded(f, true);
  await asRole(f, 'SITE_MANAGER');
  await withApi(f, async (request) => {
    const response = await request(`/site-zone-assignment-requests/${a.id}/revoke`, {
      expectedVersion: 2,
      reviewNote: ' Revoked ',
    });
    assert.equal(response.status, 201);
    const value = (await response.json()) as Assignment;
    assert.equal(value.status, 'REVOKED');
    assert.equal(value.version, 3);
    assert.equal(value.reviewNote, 'Revoked');
  });
});

const ctx = (f: Fixture) => ({ actorUserId: f.actor });
const status = (n: number) => (e: unknown) =>
  (e as { getStatus?: () => number }).getStatus?.() === n;
const service = () => new MainAssignmentCommandService(db);
async function countCommands() {
  return (await db.query('SELECT count(*)::int AS n FROM authorization_history_command'))[0]
    .n as number;
}
async function role(
  f: Fixture,
  value: string,
  site: string | null = value === 'ADMIN' ? null : f.site,
) {
  await db.query('UPDATE user_role_assignment SET role=$2,site_id=$3 WHERE user_id=$1', [
    f.actor,
    value,
    site,
  ]);
}
async function policyVersion(f: Fixture) {
  return (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.site]))[0]
    .access_policy_version;
}

test('all four real HTTP assignment writes reauthenticate original bearer in the claimed transaction', async () => {
  const f = await fixture();
  const requester = f.actor;
  await withApi(f, async (request, guard, _logout, loginAs) => {
    let claims = 0;
    const original = guard.authenticateRequest.bind(guard);
    guard.authenticateRequest = async (r, manager) => {
      if (manager) {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        claims++;
      }
      await original(r, manager);
    };
    const created = await request(`/workers/${f.worker}/site-zone-assignment-requests`, f.input);
    assert.equal(created.status, 201);
    const a = (await created.json()) as Assignment;
    const root = `/site-zone-assignment-requests/${a.id}`;
    const safety = await loginAs('SAFETY_OFFICER');
    const reviewed = await safety.request(`${root}/safety-review`, {});
    assert.equal(reviewed.status, 201);
    assert.equal(((await reviewed.json()) as Assignment).version, 2);
    const manager = await loginAs('SITE_MANAGER');
    const decided = await manager.request(`${root}/site-manager-decision`, {
      approve: true,
      expectedVersion: 2,
    });
    assert.equal(decided.status, 201);
    const revoked = await manager.request(`${root}/revoke`, {
      expectedVersion: 3,
      reviewNote: 'Site change',
    });
    assert.equal(revoked.status, 201);
    assert.equal(claims, 4);
    assert.equal(await policyVersion(f), 3);
    const facts = await db.query(
      'SELECT c.operation,c.actor_user_id,f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) LEFT JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1 ORDER BY revision',
      [a.id],
    );
    assert.deepEqual(
      facts.map((r: { operation: string }) => r.operation),
      [
        'ASSIGNMENT_REQUEST',
        'ASSIGNMENT_SAFETY_REVIEW',
        'ASSIGNMENT_DECISION',
        'ASSIGNMENT_REVOKE',
      ],
    );
    assert.deepEqual(
      facts.map((r: { actor_user_id: string }) => r.actor_user_id),
      [requester, safety.actorId, manager.actorId, manager.actorId],
    );
    assert.equal(new Set([requester, safety.actorId, manager.actorId]).size, 3);
    assert.ok(facts.every((r: { bound: boolean; witnessed: boolean }) => r.bound && r.witnessed));
    assert.equal(
      (await db.query("SELECT to_regclass('zone_authority_command') IS NULL AS absent"))[0].absent,
      true,
    );
    const audits = await db.query(
      'SELECT action,reason FROM audit_log WHERE site_id=$1 ORDER BY occurred_at,id',
      [f.site],
    );
    assert.deepEqual(
      audits.map((r: { action: string }) => r.action),
      [
        'WORKER_ASSIGNMENT_REQUESTED',
        'WORKER_ASSIGNMENT_SAFETY_REVIEWED',
        'WORKER_ASSIGNMENT_REVIEWED',
        'WORKER_ASSIGNMENT_REVOKED',
      ],
    );
    assert.equal(audits[3].reason, 'Site change');
  });
});
for (const op of ['request', 'review', 'decision', 'revoke'] as const) {
  test(`real logout before public assignment ${op} transaction claim denies write and leaves no orphan command`, async () => {
    const f = await fixture(),
      a = op === 'request' ? null : await seeded(f, op === 'revoke');
    if (op !== 'request') await asRole(f, op === 'review' ? 'SAFETY_OFFICER' : 'SITE_MANAGER');
    const before = await countCommands(),
      version = await policyVersion(f);
    await withApi(f, async (request, guard, logout) => {
      let signal!: () => void, release!: () => void;
      const held = new Promise<void>((resolve) => {
          signal = resolve;
        }),
        resume = new Promise<void>((resolve) => {
          release = resolve;
        });
      const original = guard.authenticateRequest.bind(guard);
      guard.authenticateRequest = async (r, manager) => {
        if (manager) {
          signal();
          await resume;
        }
        await original(r, manager);
      };
      const root = `/site-zone-assignment-requests/${a?.id}`;
      const pending =
        op === 'request'
          ? request(`/workers/${f.worker}/site-zone-assignment-requests`, f.input)
          : op === 'review'
            ? request(`${root}/safety-review`, {})
            : op === 'decision'
              ? request(`${root}/site-manager-decision`, { approve: true })
              : request(`${root}/revoke`, { expectedVersion: 2, reviewNote: 'Site change' });
      try {
        await Promise.race([
          held,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Assignment transaction claim not reached')),
              3000,
            ).unref();
          }),
        ]);
        assert.equal((await logout()).status, 204);
      } finally {
        release();
      }
      assert.equal((await pending).status, 401);
      assert.equal(await countCommands(), before);
      assert.equal(await policyVersion(f), version);
      const rows = await db.query(
        'SELECT status,version FROM worker_site_zone_assignment WHERE worker_id=$1',
        [f.worker],
      );
      assert.equal(rows.length, a ? 1 : 0);
      if (a) {
        assert.equal(rows[0].status, a.status);
        assert.equal(rows[0].version, a.version);
      }
    });
  });
}
test('public assignment role/representative matrix retains actual Site scoping and current roles', async () => {
  const f = await fixture();
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actor]);
  await assert.rejects(service().publicRequest(f.worker, f.input, ctx(f)), status(403));
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), f.actor, f.contractor],
  );
  const a = await service().publicRequest(f.worker, f.input, ctx(f));
  await assert.rejects(service().publicSafetyReview(a.id, ctx(f)), status(403));
  const other = await fixture();
  await role(f, 'SAFETY_OFFICER', other.site);
  await assert.rejects(service().publicSafetyReview(a.id, ctx(f)), status(403));
});
test('public Safety review retains main review-only eligibility and Site Manager decision rules', async () => {
  const f = await fixture(),
    a = await seeded(f);
  await asRole(f, 'SAFETY_OFFICER');
  await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
    f.participation,
  ]);
  const r = await service().publicSafetyReview(a.id, ctx(f));
  assert.equal(r.status, 'SAFETY_REVIEWED');
  assert.equal(await policyVersion(f), 1);
  await assert.rejects(service().publicDecision(a.id, { approve: false }, ctx(f)), status(403));
  await asRole(f, 'SITE_MANAGER');
  await assert.rejects(service().publicDecision(a.id, { approve: true }, ctx(f)), status(409));
  const rejected = await service().publicDecision(
    a.id,
    { approve: false, expectedVersion: 2, reviewNote: 'Eligibility no longer holds' },
    ctx(f),
  );
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.version, 3);
  assert.equal(await policyVersion(f), 2);
});
test('public assignment current account, password and changed representative scope fail before writes', async () => {
  for (const column of ['is_active=false', 'must_change_password=true']) {
    const f = await fixture(),
      n = await countCommands();
    await db.query(`UPDATE app_user SET ${column} WHERE id=$1`, [f.actor]);
    await assert.rejects(service().publicRequest(f.worker, f.input, ctx(f)), status(403));
    assert.equal(await countCommands(), n);
  }
  const f = await fixture();
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actor]);
  const other = await fixture();
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), f.actor, other.contractor],
  );
  await assert.rejects(service().publicRequest(f.worker, f.input, ctx(f)), status(403));
});
test('public assignment validation, cross-Site zones and version conflicts do not create orphan commands', async () => {
  const f = await fixture(),
    other = await fixture(),
    n = await countCommands();
  await assert.rejects(
    service().publicRequest(f.worker, { ...f.input, zoneIds: [f.zone, f.zone] }, ctx(f)),
    status(409),
  );
  await assert.rejects(
    service().publicRequest(f.worker, { ...f.input, zoneIds: [other.zone] }, ctx(f)),
    status(403),
  );
  await assert.rejects(
    service().publicRequest(f.worker, { ...f.input, validUntil: null }, ctx(f)),
    status(409),
  );
  await assert.rejects(
    service().publicRequest(f.worker, { ...f.input, validUntil: f.input.validFrom }, ctx(f)),
    status(400),
  );
  assert.equal(await countCommands(), n);
  const a = await seeded(f),
    n2 = await countCommands();
  await asRole(f, 'SITE_MANAGER');
  await assert.rejects(
    service().publicDecision(a.id, { approve: true, expectedVersion: 2 }, ctx(f)),
    status(409),
  );
  assert.equal(await countCommands(), n2);
});
test('public time DTO retains date-only compatibility and exact offset microseconds in DB facts', async () => {
  const f = await fixture(),
    a = await service().publicRequest(
      f.worker,
      { ...f.input, validFrom: '2026-10-01', validUntil: '2026-10-02' },
      ctx(f),
    );
  assert.ok(a.validFrom instanceof Date);
  const b = await service().publicRequest(
    f.worker,
    {
      ...f.input,
      validFrom: '2026-10-01T07:00:00.000001+07:00',
      validUntil: '2026-10-01T07:00:00.000002+07:00',
    },
    ctx(f),
  );
  assert.equal(
    (
      await db.query(
        "SELECT valid_until-valid_from=interval '1 microsecond' AS exact FROM worker_site_zone_assignment WHERE id=$1",
        [b.id],
      )
    )[0].exact,
    true,
  );
  assert.equal(
    (
      await db.query(
        "SELECT (after_payload->>'valid_until')::timestamptz-(after_payload->>'valid_from')::timestamptz=interval '1 microsecond' AS exact FROM authorization_history_revision WHERE source_id=$1",
        [b.id],
      )
    )[0].exact,
    true,
  );
});
test('public assignment concurrent decisions have one winner and exact repeat revoke has no duplicate fact or policy bump', async () => {
  const f = await fixture(),
    a = await seeded(f),
    s = service();
  await asRole(f, 'SITE_MANAGER');
  const outcomes = await Promise.allSettled([
    s.publicDecision(a.id, { approve: true, expectedVersion: 1 }, ctx(f)),
    s.publicDecision(a.id, { approve: false, expectedVersion: 1 }, ctx(f)),
  ]);
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 1);
  const loser = outcomes.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(status(409)(loser.reason));
  assert.equal(await policyVersion(f), 2);
  const b = await seeded(f, true);
  const first = await s.publicRevoke(b.id, { expectedVersion: 2, reviewNote: ' End ' }, ctx(f)),
    v = await policyVersion(f);
  const second = await s.publicRevoke(b.id, { expectedVersion: 2, reviewNote: 'End' }, ctx(f));
  assert.equal(second.reviewedAt?.getTime(), first.reviewedAt?.getTime());
  assert.equal(second.version, 3);
  assert.equal(await policyVersion(f), v);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_revision WHERE source_id=$1',
        [b.id],
      )
    )[0].n,
    3,
  );
});
test('public journal partial install and disabled assignment/Site captures fail closed', async () => {
  const f = await fixture(),
    a = await seeded(f);
  await db.query(
    'ALTER TABLE authorization_history_commit_receipt RENAME TO test_assignment_witness',
  );
  try {
    await assert.rejects(service().publicRequest(f.worker, f.input, ctx(f)), status(503));
  } finally {
    await db.query(
      'ALTER TABLE test_assignment_witness RENAME TO authorization_history_commit_receipt',
    );
  }
  await asRole(f, 'SITE_MANAGER');
  for (const table of ['worker_site_zone_assignment', 'site']) {
    await db.query(`ALTER TABLE ${table} DISABLE TRIGGER trg_mf06_capture_${table}`);
    try {
      await assert.rejects(service().publicDecision(a.id, { approve: true }, ctx(f)), status(503));
    } finally {
      await db.query(`ALTER TABLE ${table} ENABLE TRIGGER trg_mf06_capture_${table}`);
    }
  }
});
test('public assignment source-fact failure rolls back mutation, audit, policy increment and command atomically', async () => {
  const f = await fixture(),
    a = await seeded(f),
    n = await countCommands(),
    v = await policyVersion(f),
    audits = (
      await db.query('SELECT count(*)::int AS n FROM audit_log WHERE site_id=$1', [f.site])
    )[0].n;
  await asRole(f, 'SITE_MANAGER');
  await db.query(
    "CREATE FUNCTION test_assignment_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='ASSIGNMENT' THEN RAISE EXCEPTION 'Synthetic failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_assignment_fact_failure BEFORE INSERT ON authorization_history_revision FOR EACH ROW EXECUTE FUNCTION test_assignment_fact_failure()",
  );
  try {
    await assert.rejects(
      service().publicDecision(a.id, { approve: true }, ctx(f)),
      (error: unknown) => error instanceof Error && error.message === 'Synthetic failure',
    );
    assert.equal(await countCommands(), n);
    assert.equal(await policyVersion(f), v);
    assert.equal(
      (await db.query('SELECT status FROM worker_site_zone_assignment WHERE id=$1', [a.id]))[0]
        .status,
      'PENDING',
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM audit_log WHERE site_id=$1', [f.site]))[0].n,
      audits,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_assignment_fact_failure ON authorization_history_revision;DROP FUNCTION test_assignment_fact_failure()',
    );
  }
});
test('postcommit public assignment witness failure retains committed success without unsafe duplicate-create advice', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION test_assignment_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic witness failure';END $$;CREATE TRIGGER test_assignment_witness_failure BEFORE INSERT ON authorization_history_commit_receipt FOR EACH ROW EXECUTE FUNCTION test_assignment_witness_failure()",
  );
  try {
    const a = await service().publicRequest(f.worker, f.input, ctx(f));
    assert.equal(a.status, 'PENDING');
    const record = (
      await db.query(
        'SELECT w.command_id FROM authorization_history_revision f LEFT JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1',
        [a.id],
      )
    )[0];
    assert.equal(record.command_id, null);
  } finally {
    await db.query(
      'DROP TRIGGER test_assignment_witness_failure ON authorization_history_commit_receipt;DROP FUNCTION test_assignment_witness_failure()',
    );
  }
});
test('actual assignment HTTP DTOs reject client actors/commands and invalid decision/revoke fields', async () => {
  const f = await fixture(),
    a = await seeded(f, true);
  await withApi(f, async (request) => {
    for (const field of ['actorUserId', 'commandId'])
      assert.equal(
        (
          await request(`/workers/${f.worker}/site-zone-assignment-requests`, {
            ...f.input,
            [field]: randomUUID(),
          })
        ).status,
        400,
      );
    const root = `/site-zone-assignment-requests/${a.id}`;
    for (const input of [
      { approve: true, expectedVersion: '1' },
      { approve: 'true' },
      { approve: true, extra: 1 },
    ])
      assert.equal((await request(`${root}/site-manager-decision`, input)).status, 400);
    for (const input of [
      { reviewNote: 'Reason' },
      { expectedVersion: 2 },
      { expectedVersion: 2, reviewNote: ' ' },
      { expectedVersion: 2, reviewNote: 'Reason', extra: 1 },
    ])
      assert.equal((await request(`${root}/revoke`, input)).status, 400);
  });
});
test('actual HTTP role changes use retained scoped Representative, Safety Officer and Site Manager permissions', async () => {
  const f = await fixture(),
    other = await fixture();
  await withApi(f, async (request, _guard, _logout, loginAs) => {
    const create = await request(`/workers/${f.worker}/site-zone-assignment-requests`, f.input);
    assert.equal(create.status, 201);
    const a = (await create.json()) as Assignment;
    const root = `/site-zone-assignment-requests/${a.id}`;
    assert.equal((await request(`${root}/safety-review`, {})).status, 403);
    await role(f, 'SAFETY_OFFICER', other.site);
    assert.equal((await request(`${root}/safety-review`, {})).status, 403);
    await role(f, 'SAFETY_OFFICER');
    assert.equal(
      (await request(`${root}/safety-review`, {})).status,
      403,
      'Requester cannot self-review',
    );
    const safety = await loginAs('SAFETY_OFFICER');
    assert.equal((await safety.request(`${root}/safety-review`, {})).status, 201);
    assert.equal(
      (await safety.request(`${root}/site-manager-decision`, { approve: true })).status,
      403,
    );
    const manager = await loginAs('SITE_MANAGER');
    await role(f, 'SITE_MANAGER', other.site);
    assert.equal(
      (await manager.request(`${root}/site-manager-decision`, { approve: true })).status,
      403,
    );
    await role(f, 'SITE_MANAGER');
    assert.equal(
      (
        await manager.request(`${root}/site-manager-decision`, {
          approve: true,
          expectedVersion: 2,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await manager.request(`${root}/revoke`, {
          expectedVersion: 3,
          reviewNote: 'End assignment',
        })
      ).status,
      201,
    );
  });
});
test('a requester given Safety or Manager roles still cannot review their own assignment', async () => {
  const f = await fixture(),
    a = await seeded(f),
    before = await countCommands();
  await role(f, 'SAFETY_OFFICER');
  await assert.rejects(service().publicSafetyReview(a.id, ctx(f)), status(403));
  await role(f, 'SITE_MANAGER');
  await assert.rejects(service().publicDecision(a.id, { approve: true }, ctx(f)), status(403));
  assert.equal(await countCommands(), before);
  assert.equal(await policyVersion(f), 1);
  assert.equal(
    (
      await db.query('SELECT status,version FROM worker_site_zone_assignment WHERE id=$1', [a.id])
    )[0].status,
    'PENDING',
  );
});
test('unsupported legacy assignment state returns safe public unavailable without an undisclosed command-ID retry instruction', async () => {
  const f = await fixture(),
    a = await seeded(f);
  await asRole(f, 'SAFETY_OFFICER');
  await db.query(
    "UPDATE worker_site_zone_assignment SET valid_until=NULL,valid_from='infinity' WHERE id=$1",
    [a.id],
  );
  await withApi(f, async (request) => {
    const n = await countCommands();
    const response = await request(`/site-zone-assignment-requests/${a.id}/safety-review`, {});
    assert.equal(response.status, 503);
    const error = (await response.json()) as { message: string };
    assert.equal(/retry|command id/i.test(error.message), false);
    assert.equal(await countCommands(), n);
  });
});
