import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';

test('unused raw directory entry points fail closed after either history naming generation appears', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const sites = new SiteConfigurationService(db),
      workforce = new WorkforceConfigurationService(db),
      contractors = new ContractorOperationsService(db),
      site = await sites.create({ code: randomUUID(), name: 'Synthetic Site' }),
      actor = {
        id: randomUUID(),
        mustChangePassword: false,
        roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
      };
    await assert.rejects(
      contractors.createContractor(actor, { code: 'SYNTHETIC-BEFORE', name: 'Synthetic before' }),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await workforce.create(site.id, {
      externalId: 'SYNTHETIC-BEFORE',
      displayName: 'Synthetic before',
    });
    for (const relation of [
      'authorization_history_baseline',
      'authorization_history_command',
      'mf06_authority_baseline',
      'mf06_authority_command',
      'worker_assignment_command_receipt',
      'contractor_participation_command_receipt',
      'zone_permission_command_receipt',
      'zone_access_denial_command_receipt',
    ]) {
      assert.equal((await db.query('SELECT to_regclass($1) AS value', [relation]))[0].value, null);
      await db.query(`CREATE TABLE ${relation}(synthetic_id uuid PRIMARY KEY)`);
      try {
        await t.test(relation + ' Contractor', async () => {
          const count = (await db.query('SELECT count(*)::int AS n FROM contractor'))[0].n;
          await assert.rejects(
            contractors.createContractor(actor, {
              code: 'REJECTED-' + relation.slice(0, 40).toUpperCase(),
              name: 'Rejected',
            }),
            (e) => (e as { getStatus(): number }).getStatus() === 403,
          );
          assert.equal((await db.query('SELECT count(*)::int AS n FROM contractor'))[0].n, count);
        });
        await t.test(relation + ' Worker', async () => {
          const count = (await db.query('SELECT count(*)::int AS n FROM worker'))[0].n;
          await assert.rejects(
            workforce.create(site.id, { externalId: relation, displayName: 'Rejected' }),
            (e) => (e as { getStatus(): number }).getStatus() === 503,
          );
          assert.equal((await db.query('SELECT count(*)::int AS n FROM worker'))[0].n, count);
        });
      } finally {
        await db.query(`DROP TABLE ${relation}`);
      }
    }
  } finally {
    await owned.dispose();
  }
});
