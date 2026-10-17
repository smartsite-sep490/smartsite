import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource, type EntityManager } from 'typeorm';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
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
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { Mf06AssessmentQueryService } from '../../src/modules/safety/assessments/mf06-assessment-query.service.js';

const hasStatus = (status: number) => (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'getStatus' in error &&
  (error as { getStatus(): number }).getStatus() === status;

test('History list and detail never fall through a second schema when selected storage is missing', async (t) => {
  const primary = createIsolatedTestDatabase(),
    secondary = createIsolatedTestDatabase();
  const owned: { routed?: DataSource } = {};
  t.after(async () => {
    if (owned.routed?.isInitialized) await owned.routed.destroy();
    await secondary.dispose();
    await primary.dispose();
  });
  await primary.initialize();
  await secondary.initialize();
  const first = primary.dataSource,
    other = secondary.dataSource,
    site = randomUUID();
  const schema = first.driver.schema,
    fallback = other.driver.schema;
  assert.ok(schema && fallback);
  assert.match(schema, /^isolated_test_[a-f0-9]{32}$/);
  assert.match(fallback, /^isolated_test_[a-f0-9]{32}$/);
  for (const db of [first, other])
    await db.query('INSERT INTO site(id,code,name) VALUES($1,$2,$3)', [
      site,
      site,
      'Synthetic namespace Site',
    ]);
  if (first.options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  const routed = (owned.routed = new DataSource({
    ...first.options,
    extra: { ...first.options.extra, options: `-c search_path=${schema},${fallback}` },
  }));
  await routed.initialize();
  const query = new Mf06AssessmentQueryService(
    routed,
    createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' }),
  );
  for (const table of [
    'site',
    'zone_entry_assessment',
    'zone_entry_assessment_request',
    'zone_entry_authority_artifact',
  ]) {
    await first.query(`ALTER TABLE "${schema}"."${table}" RENAME TO fixture_saved_relation`);
    try {
      await t.test(`${table} absent in selected schema makes list unavailable`, async () => {
        await assert.rejects(() => query.list(site), hasStatus(503));
      });
      await t.test(
        `${table} absent in selected schema makes detail unavailable rather than false missing`,
        async () => {
          await assert.rejects(() => query.get(site, randomUUID()), hasStatus(503));
        },
      );
    } finally {
      await first.query(`ALTER TABLE "${schema}".fixture_saved_relation RENAME TO "${table}"`);
    }
  }
  // Primary metadata remains authoritative even when the secondary has the Site.
  const onlySecondary = randomUUID();
  await other.query('INSERT INTO site(id,code,name) VALUES($1,$2,$3)', [
    onlySecondary,
    onlySecondary,
    'Synthetic fallback-only Site',
  ]);
  await assert.rejects(() => query.list(onlySecondary), hasStatus(404));
  assert.deepEqual(await query.list(site), { items: [], total: 0, offset: 0, limit: 20 });
});

test('History snapshot is read-only, bounded, and restricts lookup to its selected namespace', async (t) => {
  const isolated = createIsolatedTestDatabase();
  t.after(() => isolated.dispose());
  await isolated.initialize();
  const db = isolated.dataSource,
    site = randomUUID();
  await db.query('INSERT INTO site(id,code,name) VALUES($1,$2,$3)', [
    site,
    site,
    'Synthetic read boundary Site',
  ]);
  const observations: {
    readonly: string;
    timeout: string;
    searchPath: string;
    isolation: string;
  }[] = [];
  const original = db.transaction.bind(db);
  db.transaction = (async (
    isolation: unknown,
    operation: (manager: EntityManager) => Promise<unknown>,
  ) =>
    original(isolation as 'REPEATABLE READ', async (manager) => {
      const value = await operation(manager);
      const [settings] =
        await manager.query(`SELECT current_setting('transaction_read_only') AS readonly,
      current_setting('statement_timeout') AS timeout,current_setting('search_path') AS "searchPath",
      current_setting('transaction_isolation') AS isolation`);
      observations.push(settings);
      return value;
    })) as typeof db.transaction;
  const query = new Mf06AssessmentQueryService(
    db,
    createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' }),
  );
  assert.deepEqual(await query.list(site), { items: [], total: 0, offset: 0, limit: 20 });
  assert.equal(observations.length, 1);
  assert.deepEqual(observations[0], {
    readonly: 'on',
    timeout: '5s',
    searchPath: db.driver.schema + ', pg_temp',
    isolation: 'repeatable read',
  });
  assert.equal(
    (await db.query("SELECT current_setting('transaction_read_only') AS value"))[0].value,
    'off',
    'Read-only settings must not leak into the pooled writer session',
  );
});

test('actual AppModule History exposes sanitized503 for broken selected storage and recovers when restored', async (t) => {
  const primary = createIsolatedTestDatabase(),
    secondary = createIsolatedTestDatabase();
  const owned: { routed?: DataSource; app?: NestExpressApplication } = {};
  t.after(async () => {
    if (owned.app) await owned.app.close();
    if (owned.routed?.isInitialized) await owned.routed.destroy();
    await secondary.dispose();
    await primary.dispose();
  });
  await primary.initialize();
  await secondary.initialize();
  const db = primary.dataSource,
    schema = db.driver.schema,
    fallback = secondary.dataSource.driver.schema;
  assert.ok(schema && fallback);
  const site = randomUUID(),
    user = randomUUID();
  await db
    .getRepository(SiteEntity)
    .insert({ id: site, code: site, name: 'Synthetic namespace HTTP Site' });
  await db.getRepository(UserEntity).insert({
    id: user,
    username: `namespace-${user}`,
    displayName: 'Synthetic scoped Safety Officer',
    passwordHash: await hashPassword('SyntheticNamespace123!'),
    isActive: true,
    mustChangePassword: false,
  });
  await db
    .getRepository(UserRoleAssignmentEntity)
    .insert({ id: randomUUID(), userId: user, siteId: site, role: UserRole.SAFETY_OFFICER });
  if (db.options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  const routed = (owned.routed = new DataSource({
    ...db.options,
    extra: { ...db.options.extra, options: `-c search_path=${schema},${fallback}` },
  }));
  await routed.initialize();
  const config = createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(routed)
    .overrideProvider(DataSource)
    .useValue(routed)
    .compile();
  const app = (owned.app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  }));
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api/v1`,
    login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `namespace-${user}`,
        password: 'SyntheticNamespace123!',
        clientType: 'MOBILE',
      }),
      signal: AbortSignal.timeout(5000),
    });
  assert.equal(login.status, 200);
  const { accessToken } = (await login.json()) as { accessToken: string };
  const list = `${base}/sites/${site}/mf06-assessments`,
    detail = `${list}/${randomUUID()}`;
  const read = (url: string, authenticated = true) =>
    fetch(url, {
      headers: { ...(authenticated ? { Authorization: `Bearer ${accessToken}` } : {}) },
      signal: AbortSignal.timeout(5000),
    });
  assert.equal((await read(list)).status, 200);
  await db.query('ALTER TABLE zone_entry_assessment RENAME TO fixture_hidden_http_assessment');
  try {
    assert.equal(
      (await read(list, false)).status,
      401,
      'Storage failure does not bypass authentication',
    );
    for (const url of [list, detail]) {
      const response = await read(url),
        body = await response.text();
      assert.equal(response.status, 503);
      assert(response.headers.get('x-request-id'));
      assert.equal(JSON.parse(body).code, 'SERVICE_UNAVAILABLE');
      for (const value of [schema, fallback, 'to_regclass', 'search_path', 'SELECT ', accessToken])
        assert(!body.includes(value), 'Public error must omit private SQL/schema/token');
    }
  } finally {
    await db.query('ALTER TABLE fixture_hidden_http_assessment RENAME TO zone_entry_assessment');
  }
  const recovered = await read(list);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { items: [], total: 0, offset: 0, limit: 20 });
  assert.equal(
    (await read(detail)).status,
    404,
    'Genuine missing record remains404 when storage is ready',
  );
});

test('temporary relation shadows in a pooled session cannot replace selected History storage', async (t) => {
  const isolated = createIsolatedTestDatabase(),
    db = isolated.dataSource;
  t.after(() => isolated.dispose());
  if (db.options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  db.setOptions({ extra: { ...db.options.extra, max: 1 } });
  await isolated.initialize();
  const site = randomUUID();
  await db.query('INSERT INTO site(id,code,name) VALUES($1,$2,$3)', [
    site,
    site,
    'Synthetic temp-shadow Site',
  ]);
  const query = new Mf06AssessmentQueryService(
    db,
    createTestConfig({ MF06_ASSESSMENT_READ_ENABLED: 'true' }),
  );
  await db.query('CREATE TEMP TABLE site(id UUID)');
  try {
    assert.deepEqual(await query.list(site), { items: [], total: 0, offset: 0, limit: 20 });
  } finally {
    await db.query('DROP TABLE pg_temp.site');
  }
});
