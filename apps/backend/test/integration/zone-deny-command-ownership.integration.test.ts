import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ZoneAccessManagementService } from '../../src/modules/zones/zone-access-management.service.js';
import { ZoneAccessEffect } from '../../src/database/entities/zone-access-grant.entity.js';

test('Zone deny writes reauthorize the actor and Site scope in the mutation transaction', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      other = randomUUID(),
      actor = randomUUID(),
      zone = randomUUID(),
      worker = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic own'),($2,$2::uuid::text,'Synthetic other')",
      [site, other],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Manager','synthetic-no-login')",
      [actor],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SITE_MANAGER')",
      [randomUUID(), actor, site],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
      [zone, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic worker')",
      [worker, site],
    );
    const service = new ZoneAccessManagementService(db);
    const input = {
      workerId: worker,
      effect: ZoneAccessEffect.DENY,
      validFrom: '2026-11-20T00:00:00Z',
      validUntil: null,
    };
    const revoked = {
      actorUserId: actor,
      reauthorize: async () => {
        throw Error('Synthetic revoked bearer');
      },
    };
    await assert.rejects(
      Reflect.apply(service.createGrant, service, [site, zone, input, revoked]),
      /Synthetic revoked bearer/,
    );
    assert.equal((await service.listGrants(site, zone)).total, 0);
    let checks = 0;
    const context = {
      actorUserId: actor,
      reauthorize: async (manager: EntityManager) => {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        checks++;
      },
    };
    const grant = await Reflect.apply(service.createGrant, service, [site, zone, input, context]);
    assert.equal(checks, 1);
    await assert.rejects(
      Reflect.apply(service.createGrant, service, [other, zone, input, context]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await assert.rejects(
      Reflect.apply(service.createGrant, service, [
        site,
        zone,
        { ...input, effect: ZoneAccessEffect.ALLOW },
        context,
      ]),
      /Contractor and Worker Zone permissions/,
    );
    await assert.rejects(
      Reflect.apply(service.revokeGrant, service, [site, zone, grant.id, new Date(), revoked]),
      /Synthetic revoked bearer/,
    );
    assert.equal((await service.listGrants(site, zone)).items[0]?.revokedAt, null);
    const at = new Date('2026-11-20T12:00:00Z');
    const result = await Reflect.apply(service.revokeGrant, service, [
      site,
      zone,
      grant.id,
      at,
      context,
    ]);
    assert.equal(result.revokedAt?.toISOString(), at.toISOString());
    const repeat = await Reflect.apply(service.revokeGrant, service, [
      site,
      zone,
      grant.id,
      new Date('2026-11-21T00:00:00Z'),
      context,
    ]);
    assert.equal(repeat.revokedAt?.toISOString(), at.toISOString());
    await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [actor]);
    await assert.rejects(
      Reflect.apply(service.revokeGrant, service, [site, zone, grant.id, at, context]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
  } finally {
    await owned.dispose();
  }
});
