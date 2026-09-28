import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import dataSource from '../support/test-data-source.js';
import { ScopedJwtAuthentication1790553600000 } from '../../src/database/migrations/1790553600000-ScopedJwtAuthentication.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('scoped auth migration backfills Admin, deactivates Worker, and invalidates old sessions', async () => {
  await dataSource.initialize();
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  const migration = new ScopedJwtAuthentication1790553600000();
  try {
    await migration.down(runner);
    const adminId = randomUUID();
    const workerId = randomUUID();
    await runner.query(
      `INSERT INTO app_user
        (id, username, display_name, password_hash, role, is_active, must_change_password)
       VALUES ($1, 'legacy-admin', 'Legacy Admin', 'hash', 'ADMIN', TRUE, FALSE),
              ($2, 'legacy-worker', 'Legacy Worker', 'hash', 'WORKER', TRUE, FALSE)`,
      [adminId, workerId],
    );
    await runner.query(
      `INSERT INTO auth_session (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + interval '1 day')`,
      ['a'.repeat(64), adminId],
    );
    await migration.up(runner);

    const accounts = (await runner.query(
      'SELECT id, is_active FROM app_user ORDER BY username',
    )) as Array<{ id: string; is_active: boolean }>;
    assert.equal(accounts.find(({ id }) => id === workerId)?.is_active, false);
    assert.deepEqual(
      await runner.query(
        'SELECT user_id, role, site_id FROM user_role_assignment ORDER BY user_id',
      ),
      [{ user_id: adminId, role: 'ADMIN', site_id: null }],
    );
    assert.equal(
      Number((await runner.query('SELECT COUNT(*) AS count FROM auth_session'))[0].count),
      0,
    );
    assert.equal(
      Number(
        (
          await runner.query(`
            SELECT COUNT(*) AS count FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'app_user' AND column_name = 'role'
          `)
        )[0].count,
      ),
      0,
    );
    const sites = new SiteConfigurationService(dataSource);
    const site = await sites.create({
      code: `MIG-${randomUUID().slice(0, 8)}`,
      name: 'Migration Role Site',
    });
    await runner.query(
      `INSERT INTO user_role_assignment (id, user_id, role, site_id)
       VALUES ($1, $2, 'CONTRACTOR_REPRESENTATIVE', $3)`,
      [randomUUID(), workerId, site.id],
    );
    await assert.rejects(
      runner.query(
        `INSERT INTO user_role_assignment (id, user_id, role, site_id)
         VALUES ($1, $2, 'CONTRACTOR_REP', $3)`,
        [randomUUID(), workerId, site.id],
      ),
    );
    await runner.query('UPDATE app_user SET is_active = FALSE WHERE id = $1', [adminId]);
    const users = new UsersService(dataSource, sites);
    assert.deepEqual((await users.get(workerId)).roleAssignments, [
      { role: 'CONTRACTOR_REPRESENTATIVE', siteId: site.id },
    ]);
    const recovered = await users.bootstrap(
      'recovered-admin',
      'Recovered Admin',
      'RecoveredAdmin123!',
    );
    assert.deepEqual(recovered.roleAssignments, [{ role: 'ADMIN', siteId: null }]);
  } finally {
    await runner.release();
  }
});
