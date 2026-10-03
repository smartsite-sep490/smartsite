import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { IdentityAccessScope1790726400000 } from '../../src/database/migrations/1790726400000-IdentityAccessScope.js';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

test('main Identity migration preserves MF07-only Contractor, Site, Worker and Representative data', async () => {
  const schema = `mf07_upgrade_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres') throw new Error('PostgreSQL test source required');
  const dataSource = new DataSource({ ...options, schema });
  await dataSource.initialize();
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    await queryRunner.query(`CREATE SCHEMA "${schema}"`);
    await queryRunner.query(`SET LOCAL search_path TO "${schema}", public`);
    await queryRunner.query(`
      CREATE TABLE site (id uuid PRIMARY KEY);
      CREATE TABLE app_user (id uuid PRIMARY KEY);
      CREATE TABLE worker (id uuid PRIMARY KEY, site_id uuid NOT NULL, contractor_id uuid);
      CREATE TABLE contractor (
        id uuid PRIMARY KEY, site_id uuid NOT NULL, code varchar(64) NOT NULL,
        name varchar(255) NOT NULL, is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_contractor_site_code UNIQUE (site_id, code)
      );
      CREATE INDEX idx_contractor_site_active ON contractor (site_id, is_active);
      CREATE INDEX idx_worker_contractor ON worker (contractor_id);
      CREATE TABLE contractor_representative_assignment (
        id uuid PRIMARY KEY, site_id uuid NOT NULL, contractor_id uuid NOT NULL,
        user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_contractor_representative_assignment UNIQUE (contractor_id, user_id)
      );
    `);
    const [siteId, userId, contractorId, workerId] = Array.from({ length: 4 }, () => randomUUID());
    await queryRunner.query('INSERT INTO site VALUES ($1)', [siteId]);
    await queryRunner.query('INSERT INTO app_user VALUES ($1)', [userId]);
    await queryRunner.query(
      "INSERT INTO contractor (id, site_id, code, name) VALUES ($1, $2, 'OLD', 'Legacy contractor')",
      [contractorId, siteId],
    );
    await queryRunner.query('INSERT INTO worker (id, site_id, contractor_id) VALUES ($1, $2, $3)',
      [workerId, siteId, contractorId]);
    await queryRunner.query(`
      INSERT INTO contractor_representative_assignment (id, site_id, contractor_id, user_id)
      VALUES (gen_random_uuid(), $1, $2, $3)
    `, [siteId, contractorId, userId]);
    await new IdentityAccessScope1790726400000().up(queryRunner);
    assert.equal(await queryRunner.hasColumn('contractor', 'site_id'), false);
    const participations = await queryRunner.query(
      'SELECT contractor_id, site_id FROM contractor_site_participation WHERE contractor_id = $1',
      [contractorId],
    ) as Array<{ contractor_id: string; site_id: string }>;
    assert.deepEqual(participations, [{ contractor_id: contractorId, site_id: siteId }]);
    const grants = await queryRunner.query(
      'SELECT user_id, contractor_id FROM contractor_representative_grant WHERE user_id = $1',
      [userId],
    ) as Array<{ user_id: string; contractor_id: string }>;
    assert.deepEqual(grants, [{ user_id: userId, contractor_id: contractorId }]);
    const workers = await queryRunner.query('SELECT contractor_id FROM worker WHERE id = $1', [workerId]) as Array<{ contractor_id: string }>;
    assert.equal(workers[0]?.contractor_id, contractorId);
  } finally {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
    await dataSource.destroy();
  }
});
