import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';

test('Zone commands reauthorize the real actor and assigned Site Manager inside their write transaction', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      actor = randomUUID(),
      foreign = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Owned'),($2,$2::uuid::text,'Foreign')",
      [site, foreign],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Manager','synthetic-no-login')",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER')",
      [randomUUID(), actor, site],
    );
    const service = new ZoneConfigurationService(db, new SiteConfigurationService(db));
    const input = {
      name: 'Synthetic Zone',
      type: ZoneType.STANDARD,
      restrictionPolicy: ZoneRestrictionPolicy.NONE,
      requiredPpe: ['HARD_HAT'],
    };
    let checks = 0;
    const context = {
      actorUserId: actor,
      reauthorize: async (manager: EntityManager) => {
        checks++;
        assert.equal(manager.queryRunner?.isTransactionActive, true);
      },
    };
    const zone = await service.create(site, input, context);
    assert.equal(checks, 1);
    await assert.rejects(
      service.create(foreign, input, context),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    const revoked = {
      actorUserId: actor,
      reauthorize: async () => {
        throw Error('Synthetic session revoked');
      },
    };
    await assert.rejects(
      service.updatePolicy(
        site,
        zone.id,
        { type: input.type, restrictionPolicy: input.restrictionPolicy, requiredPpe: ['BOOTS'] },
        revoked,
      ),
      /Synthetic session revoked/,
    );
    assert.deepEqual((await service.get(site, zone.id)).requiredPpe, ['HARD_HAT']);
    await service.updatePolicy(
      site,
      zone.id,
      { type: input.type, restrictionPolicy: input.restrictionPolicy, requiredPpe: ['BOOTS'] },
      context,
    );
    await service.rename(site, zone.id, { name: 'Renamed' }, context);
    assert.equal((await service.get(site, zone.id)).name, 'Renamed');
    await db.query('DELETE FROM user_role_assignment WHERE user_id=$1 AND site_id=$2', [
      actor,
      site,
    ]);
    await assert.rejects(
      service.remove(site, zone.id, context),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    assert.equal((await service.get(site, zone.id)).name, 'Renamed');
  } finally {
    await owned.dispose();
  }
});
