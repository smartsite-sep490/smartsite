import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { archivedPermissionsFixture } from './support/main-archived-permissions.fixture.js';
type Fixture = ReturnType<typeof archivedPermissionsFixture>;
interface Result {
  status: string;
  reason?: string;
  effects?: readonly string[];
  allowPermissionIds?: readonly string[];
  denyGrantIds?: readonly string[];
  restrictionPolicy?: string;
  authorityCoverageEstablished?: false;
  identityEstablished?: false;
}
async function projector() {
  const path = '../src/modules/zones/main-archived-permission-projection.js';
  const module = (await import(path).catch((error: { code?: string }) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  })) as { projectMainArchivedPermissions?: (archive: unknown, expected: object) => Result };
  assert.equal(
    typeof module.projectMainArchivedPermissions,
    'function',
    'MAIN archived permission projection must exist',
  );
  return module.projectMainArchivedPermissions!;
}
async function project(f: Fixture) {
  const archive = f.seal();
  return (await projector())(archive, { ...f.context, sha256: archive.sha256 });
}
function effects(result: Result) {
  assert.equal(result.status, 'PROJECTED');
  assert.equal(result.authorityCoverageEstablished, false);
  assert.equal(result.identityEstablished, false);
  return result.effects;
}
test('linked MAIN permission chain projects private ALLOW without establishing authority or identity', async () => {
  const f = archivedPermissionsFixture(),
    result = await project(f);
  assert.deepEqual(effects(result), ['ALLOW']);
  assert.deepEqual(result.allowPermissionIds, [f.wp]);
  assert.deepEqual(result.denyGrantIds, []);
});
test('independent DENY is retained alongside ALLOW, legacy flat ALLOW cannot create a chain', async () => {
  const f = archivedPermissionsFixture(),
    deny = f.deny();
  assert.deepEqual(effects(await project(f)), ['ALLOW', 'DENY']);
  f.rows('WORKER_PERMISSION').length = 0;
  f.rows('ZONE_GRANT').length = 0;
  f.deny('ALLOW');
  assert.deepEqual(effects(await project(f)), []);
  f.rows('ZONE_GRANT').length = 0;
  f.deny();
  assert.notEqual(deny, f.rows('ZONE_GRANT')[0]!.id);
  assert.deepEqual(effects(await project(f)), ['DENY']);
});
for (const kind of ['CONTRACTOR', 'PARTICIPATION'])
  test(
    'inactive ' + kind + ' removes the ALLOW chain but does not remove independent DENY',
    async () => {
      const f = archivedPermissionsFixture();
      f.rows(kind)[0]!.is_active = false;
      f.deny();
      assert.deepEqual(effects(await project(f)), ['DENY']);
    },
  );
test('inactive or absent Worker reference stays unavailable', async () => {
  const f = archivedPermissionsFixture();
  f.rows('WORKER')[0]!.is_active = false;
  assert.equal((await project(f)).reason, 'WORKER_UNAVAILABLE');
  f.context.workerId = null;
  assert.equal((await project(f)).reason, 'WORKER_REFERENCE_UNAVAILABLE');
});
test('null Contractor anchor cannot inherit ALLOW, independent DENY still matches', async () => {
  const f = archivedPermissionsFixture();
  f.rows('WORKER')[0]!.contractor_id = null;
  f.deny();
  assert.deepEqual(effects(await project(f)), ['DENY']);
});
for (const status of ['PENDING', 'SAFETY_REVIEWED', 'REJECTED', 'CANCELLED', 'REVOKED', 'EXPIRED'])
  test(status + ' assignment cannot create ALLOW', async () => {
    const f = archivedPermissionsFixture();
    f.rows('ASSIGNMENT')[0]!.status = status;
    assert.deepEqual(effects(await project(f)), []);
  });
test('open-ended assignment is not a finite MAIN approval', async () => {
  const f = archivedPermissionsFixture();
  f.rows('ASSIGNMENT')[0]!.valid_until = null;
  assert.deepEqual(effects(await project(f)), []);
});
for (const kind of ['ASSIGNMENT', 'CONTRACTOR_PERMISSION', 'PARTICIPATION', 'CONTRACTOR'])
  test('missing ' + kind + ' is not an implicit ALLOW', async () => {
    const f = archivedPermissionsFixture();
    f.rows(kind).length = 0;
    assert.deepEqual(effects(await project(f)), []);
  });
test('assignment and permission must share exact participation, Site, Worker and Contractor anchors', async () => {
  for (const [kind, key] of [
    ['ASSIGNMENT', 'site_id'],
    ['ASSIGNMENT', 'worker_id'],
    ['CONTRACTOR_PERMISSION', 'zone_id'],
    ['CONTRACTOR_PERMISSION', 'site_contractor_id'],
    ['PARTICIPATION', 'site_id'],
    ['PARTICIPATION', 'contractor_id'],
  ] as const) {
    const f = archivedPermissionsFixture();
    f.rows(kind)[0]![key] = randomUUID();
    assert.deepEqual(effects(await project(f)), [], kind + '/' + key);
  }
});
test('Worker permission interval must fit assignment, Contractor permission and participation', async () => {
  for (const kind of ['ASSIGNMENT', 'CONTRACTOR_PERMISSION', 'PARTICIPATION']) {
    const f = archivedPermissionsFixture();
    f.rows(kind)[0]!.valid_from = '2026-10-11T01:00:00.000001Z';
    assert.deepEqual(effects(await project(f)), [], kind + ' start');
    f.rows(kind)[0]!.valid_from = '2026-10-11T00:00:00.000001Z';
    f.rows(kind)[0]!.valid_until = '2026-10-11T23:00:00.000001Z';
    assert.deepEqual(effects(await project(f)), [], kind + ' end');
  }
});
test('half-open ALLOW endpoints retain submillisecond precision', async () => {
  const f = archivedPermissionsFixture();
  f.rows('WORKER_PERMISSION')[0]!.valid_until = '2026-10-11T12:00:00.000002Z';
  assert.deepEqual(effects(await project(f)), ['ALLOW']);
  f.context.capturedAt = '2026-10-11T12:00:00.000002Z';
  assert.deepEqual(effects(await project(f)), []);
  f.context.capturedAt = '2026-10-11T12:00:00.000000Z';
  f.rows('WORKER_PERMISSION')[0]!.valid_from = '2026-10-11T12:00:00.000001Z';
  assert.deepEqual(effects(await project(f)), []);
});
test('DENY starts, expires and revokes at exact microseconds, including equivalent offsets', async () => {
  const f = archivedPermissionsFixture();
  f.deny();
  const deny = f.rows('ZONE_GRANT')[0]!;
  deny.valid_from = '2026-10-11T12:00:00.000002Z';
  deny.valid_until = '2026-10-11T12:00:00.000004Z';
  assert.deepEqual(effects(await project(f)), ['ALLOW']);
  f.context.capturedAt = '2026-10-11T19:00:00.000002+07:00';
  assert.deepEqual(effects(await project(f)), ['ALLOW', 'DENY']);
  deny.revoked_at = '2026-10-11T12:00:00.000003Z';
  f.context.capturedAt = '2026-10-11T12:00:00.000003Z';
  assert.deepEqual(effects(await project(f)), ['ALLOW']);
  deny.revoked_at = null;
  f.context.capturedAt = '2026-10-11T12:00:00.000004Z';
  assert.deepEqual(effects(await project(f)), ['ALLOW']);
});
test('Contractor/Worker revocation removes ALLOW exactly at the revocation instant', async () => {
  for (const kind of ['CONTRACTOR_PERMISSION', 'WORKER_PERMISSION']) {
    const f = archivedPermissionsFixture();
    f.rows(kind)[0]!.revoked_at = '2026-10-11T12:00:00.000002Z';
    assert.deepEqual(effects(await project(f)), ['ALLOW']);
    f.context.capturedAt = '2026-10-11T12:00:00.000002Z';
    assert.deepEqual(effects(await project(f)), []);
  }
});
test('policy-only NONE/PROHIBITED metadata requires no inferred Worker and returns no decision', async () => {
  for (const policy of ['NONE', 'PROHIBITED_FOR_ALL']) {
    const f = archivedPermissionsFixture();
    f.context.workerId = null;
    f.rows('ZONE_POLICY')[0]!.restriction_policy = policy;
    const result = await project(f);
    assert.deepEqual(effects(result), []);
    assert.equal(result.restrictionPolicy, policy);
    assert.equal('outcome' in result, false);
    assert.equal('workerId' in result, false);
  }
});
test('digest tampering and wrong binding are rejected before using effects', async () => {
  const f = archivedPermissionsFixture(),
    archive = f.seal(),
    fn = await projector();
  assert.equal(
    fn({ ...archive, sha256: 'd'.repeat(64) }, { ...f.context, sha256: archive.sha256 }).status,
    'UNAVAILABLE',
  );
  assert.equal(
    fn(archive, { ...f.context, siteId: randomUUID(), sha256: archive.sha256 }).status,
    'UNAVAILABLE',
  );
});
