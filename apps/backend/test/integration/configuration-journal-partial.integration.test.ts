import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('baseline-only partial canonical history rejects configuration before any mutation', async () => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const actor = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-runtime-password')",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
      [randomUUID(), actor],
    );
    await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
    let mutations = 0;
    await assert.rejects(
      executeMainConfigurationCommand(
        db,
        { actorUserId: actor },
        'SITE_CREATE',
        {},
        async (manager) => {
          mutations++;
          await manager.query(
            "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Must not be saved')",
            [randomUUID()],
          );
        },
      ),
      (error) =>
        typeof error === 'object' &&
        error !== null &&
        'getStatus' in error &&
        (error as { getStatus: () => number }).getStatus() === 503,
    );
    assert.equal(mutations, 0);
    const [{ n }] = await db.query('SELECT count(*)::int AS n FROM site');
    assert.equal(n, 0);
  } finally {
    await owned.dispose();
  }
});
