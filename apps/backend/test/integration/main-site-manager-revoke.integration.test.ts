import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import {
  SiteEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
} from '../../src/database/entities/index.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('Main Site Manager revocation preserves unrelated roles and records actor-bound history while revoking sessions', async (t) => {
  const isolated = createIsolatedTestDatabase(),
    db = isolated.dataSource;
  const cleanup: { app?: NestExpressApplication } = {};
  t.after(async () => {
    try {
      await cleanup.app?.close();
    } finally {
      await isolated.dispose();
    }
  });
  await isolated.initialize();
  const [{ schemaName }] = await db.query('SELECT current_schema() AS "schemaName"');
  assert.match(schemaName, /^isolated_test_[0-9a-f]{32}$/);
  console.info(`FRAME_TEST_SCHEMA:${schemaName}`);
  const siteId = randomUUID(),
    otherSite = randomUUID(),
    admin = randomUUID(),
    manager = randomUUID();
  const managerRole = randomUUID(),
    retainedRole = randomUUID();
  await db.getRepository(SiteEntity).save([
    { id: siteId, code: 'REVOKE-OWN', name: 'Synthetic own Site' },
    { id: otherSite, code: 'REVOKE-OTHER', name: 'Synthetic other Site' },
  ]);
  const password = 'SyntheticRevoke123!';
  const passwordHash = await hashPassword(password);
  await db.getRepository(UserEntity).save(
    [admin, manager].map((id) => ({
      id,
      username: id,
      displayName: 'Synthetic actor',
      passwordHash,
      isActive: true,
      mustChangePassword: false,
    })),
  );
  await db.getRepository(UserRoleAssignmentEntity).save([
    { id: randomUUID(), userId: admin, role: UserRole.ADMIN, siteId: null },
    { id: managerRole, userId: manager, role: UserRole.SITE_MANAGER, siteId },
    { id: retainedRole, userId: manager, role: UserRole.SAFETY_OFFICER, siteId: otherSite },
  ]);
  const config = createTestConfig();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(db)
    .overrideProvider(DataSource)
    .useValue(db)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  cleanup.app = app;
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`;
  const login = async (id: string, clientType: 'WEB' | 'MOBILE' = 'MOBILE') => {
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
      body: JSON.stringify({ username: id, password, clientType }),
    });
    assert.equal(response.status, 200);
    return ((await response.json()) as { accessToken: string }).accessToken;
  };
  const adminToken = await login(admin),
    managerToken = await login(manager),
    webToken = await login(manager, 'WEB');
  const remove = (site: string, token = adminToken, userId = manager) =>
    fetch(`${base}/users/${userId}/site-manager/${site}`, {
      method: 'DELETE',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  const me = (token: string) =>
    fetch(`${base}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await remove(siteId, '')).status, 401);
  assert.equal((await remove(siteId, managerToken)).status, 403);
  assert.equal((await remove(siteId, adminToken, randomUUID())).status, 404);
  assert.equal((await remove(otherSite)).status, 204);
  assert.equal((await me(managerToken)).status, 200);
  assert.equal((await me(webToken)).status, 200);
  assert.equal(await db.getRepository(UserRoleAssignmentEntity).countBy({ id: managerRole }), 1);
  await db.query('ALTER TABLE authorization_history_revision RENAME TO owned_hidden_revision');
  try {
    assert.equal((await remove(siteId)).status, 503);
    assert.equal(await db.getRepository(UserRoleAssignmentEntity).countBy({ id: managerRole }), 1);
    assert.equal((await me(managerToken)).status, 200);
  } finally {
    await db.query('ALTER TABLE owned_hidden_revision RENAME TO authorization_history_revision');
  }
  assert.equal((await remove(siteId)).status, 204);
  assert.equal(await db.getRepository(UserRoleAssignmentEntity).countBy({ id: managerRole }), 0);
  assert.equal(await db.getRepository(UserRoleAssignmentEntity).countBy({ id: retainedRole }), 1);
  assert.equal((await me(managerToken)).status, 401);
  assert.equal((await me(webToken)).status, 401);
  assert.equal((await me(adminToken)).status, 200);
  assert.equal(
    Number(
      (
        await db.query(
          'SELECT count(*) AS n FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL',
          [manager],
        )
      )[0].n,
    ),
    0,
  );
  const facts = await db.query(
    `SELECT c.actor_user_id,c.request_hash,f.before_payload,f.after_payload,
    f.transaction_id=c.transaction_id AS bound,w.transaction_id=c.transaction_id AS witnessed
    FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id)
    LEFT JOIN authorization_history_commit_receipt w USING(command_id)
    WHERE c.operation='USER_SITE_MANAGER_REVOKE' AND f.source_id=$1 AND f.operation='DELETE'`,
    [managerRole],
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0].actor_user_id, admin);
  assert.equal(
    facts[0].request_hash,
    computeCanonicalPayloadHash({
      operation: 'USER_SITE_MANAGER_REVOKE',
      actorUserId: admin,
      request: { userId: manager, siteId },
    }),
  );
  assert.equal(facts[0].bound, true);
  assert.equal(facts[0].witnessed, true);
  assert.notEqual(facts[0].before_payload, null);
  assert.equal(facts[0].after_payload, null);
  assert.equal((await remove(siteId)).status, 204);
  assert.equal(await db.getRepository(UserRoleAssignmentEntity).countBy({ userId: manager }), 1);
});
