import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { CameraStatus } from '../../src/database/entities/enums.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const isolated = createIsolatedTestDatabase({ canonical: true });
const db = isolated.dataSource;
before(() => isolated.initialize());
after(() => isolated.dispose());
const sites = new SiteConfigurationService(db);
const cameras = new CameraConfigurationService(db, new ZoneConfigurationService(db, sites), sites);
const polygon = {
  coordinates: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
};
const status = (code: number) => (error: unknown) =>
  (error as { getStatus?: () => number }).getStatus?.() === code;

async function actor(role: string, siteId: string | null) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-login',false)",
    [id],
  );
  await db.query('INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    id,
    role,
    siteId,
  ]);
  return { actorUserId: id };
}
async function fixture() {
  const siteId = randomUUID(),
    zoneId = randomUUID();
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  const context = await actor('SITE_MANAGER', siteId);
  const input = { code: randomUUID(), externalId: randomUUID(), name: 'Synthetic camera' };
  return { siteId, zoneId, context, input };
}
const commands = async () =>
  (await db.query('SELECT count(*)::int n FROM mf06_authority_command'))[0].n;

test('current scoped Manager camera writes retain revision, permanent policy lock and journal witness', async () => {
  const f = await fixture();
  const camera = await cameras.create(f.siteId, f.input, f.context);
  const region = await cameras.createRegion(
    f.siteId,
    camera.id,
    { zoneId: f.zoneId, polygon, expectedConfigurationVersion: 1 },
    f.context,
  );
  await cameras.rename(f.siteId, camera.id, { name: 'Renamed camera' }, f.context);
  const changed = await cameras.updatePolygon(
    f.siteId,
    camera.id,
    region.id,
    {
      polygon: {
        coordinates: [
          [0, 0],
          [0.8, 0],
          [0, 0.8],
        ],
      },
      expectedConfigurationVersion: 2,
    },
    f.context,
  );
  assert.equal(changed.configurationVersion, 3);
  assert.equal(changed.version, 2);
  const inactive = await cameras.setRegionActive(
    f.siteId,
    camera.id,
    region.id,
    { isActive: false, expectedConfigurationVersion: 3 },
    f.context,
  );
  assert.equal(inactive.configurationVersion, 4);
  const stopped = await cameras.setStatus(
    f.siteId,
    camera.id,
    { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 4 },
    f.context,
  );
  assert.equal(stopped.configurationVersion, 5);
  assert.equal(
    (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [f.zoneId]))[0]
      .configuration_locked,
    true,
  );
  const facts = await db.query(
    `SELECT c.actor_user_id,c.operation,f.transaction_id=c.transaction_id AS same_tx,
      w.transaction_id=c.transaction_id AS witnessed FROM mf06_authority_fact f
      JOIN mf06_authority_command c USING(command_id)
      JOIN mf06_authority_commit_witness w USING(command_id)
      WHERE f.source_id=ANY($1::uuid[])`,
    [[camera.id, region.id, f.zoneId]],
  );
  assert(facts.length > 0);
  for (const fact of facts) {
    assert.equal(fact.actor_user_id, f.context.actorUserId);
    assert.equal(fact.same_tx, true);
    assert.equal(fact.witnessed, true);
  }
  assert(facts.some((fact: { operation: string }) => fact.operation === 'REGION_CREATE'));
  assert(facts.some((fact: { operation: string }) => fact.operation === 'CAMERA_STATUS_UPDATE'));
});

test('Admin, Safety and foreign Manager cannot write camera configuration or leave orphan commands', async () => {
  const f = await fixture(),
    other = await fixture();
  const camera = await cameras.create(f.siteId, f.input, f.context);
  const region = await cameras.createRegion(
    f.siteId,
    camera.id,
    { zoneId: f.zoneId, polygon, expectedConfigurationVersion: 1 },
    f.context,
  );
  const denied = [
    await actor('ADMIN', null),
    await actor('SAFETY_OFFICER', f.siteId),
    other.context,
  ];
  const before = await commands();
  for (const context of denied) {
    await assert.rejects(
      cameras.create(
        f.siteId,
        { ...f.input, code: randomUUID(), externalId: randomUUID() },
        context,
      ),
      status(403),
    );
    await assert.rejects(
      cameras.rename(f.siteId, camera.id, { name: 'Forbidden rename' }, context),
      status(403),
    );
    await assert.rejects(
      cameras.createRegion(
        f.siteId,
        camera.id,
        { zoneId: f.zoneId, polygon, expectedConfigurationVersion: 2 },
        context,
      ),
      status(403),
    );
    await assert.rejects(
      cameras.updatePolygon(
        f.siteId,
        camera.id,
        region.id,
        { polygon, expectedConfigurationVersion: 2 },
        context,
      ),
      status(403),
    );
    await assert.rejects(
      cameras.setRegionActive(
        f.siteId,
        camera.id,
        region.id,
        { isActive: false, expectedConfigurationVersion: 2 },
        context,
      ),
      status(403),
    );
    await assert.rejects(
      cameras.setStatus(
        f.siteId,
        camera.id,
        { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 2 },
        context,
      ),
      status(403),
    );
  }
  assert.equal(await commands(), before);
  assert.equal((await cameras.get(f.siteId, camera.id)).configurationVersion, 2);
  assert.equal((await cameras.get(f.siteId, camera.id)).name, f.input.name);
});

test('late session or role loss and stale revisions preserve camera state and command history', async () => {
  const f = await fixture();
  const camera = await cameras.create(f.siteId, f.input, f.context);
  const before = await commands();
  await assert.rejects(
    cameras.setStatus(
      f.siteId,
      camera.id,
      { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 2 },
      f.context,
    ),
    status(409),
  );
  let rechecked = false;
  await assert.rejects(
    cameras.rename(
      f.siteId,
      camera.id,
      { name: 'Revoked session' },
      {
        ...f.context,
        reauthorize: async (manager) => {
          assert.equal(manager.queryRunner?.isTransactionActive, true);
          rechecked = true;
          throw Object.assign(new Error('synthetic revoked session'), { getStatus: () => 401 });
        },
      },
    ),
    status(401),
  );
  assert.equal(rechecked, true);
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.context.actorUserId]);
  await assert.rejects(
    cameras.setStatus(
      f.siteId,
      camera.id,
      { status: CameraStatus.INACTIVE, expectedConfigurationVersion: 1 },
      f.context,
    ),
    status(403),
  );
  assert.equal(await commands(), before);
  const unchanged = await cameras.get(f.siteId, camera.id);
  assert.equal(unchanged.configurationVersion, 1);
  assert.equal(unchanged.name, f.input.name);
  assert.equal(unchanged.status, CameraStatus.ACTIVE);
});
