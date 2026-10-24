import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedAssignmentScopeSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

async function fixture() {
  const site = randomUUID(),
    otherSite = randomUUID(),
    actor = randomUUID(),
    requester = randomUUID(),
    worker = randomUUID(),
    assignment = randomUUID();
  for (const id of [site, otherSite])
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      id,
    ]);
  for (const id of [actor, requester])
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-password',false)",
      [id],
    );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic Worker')",
    [worker, site],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,ARRAY[$4::uuid],'PENDING','2026-01-01','2027-01-01',$5)",
    [assignment, worker, site, randomUUID(), requester],
  );
  for (const role of ['SAFETY_OFFICER', 'SITE_MANAGER'])
    await db.query(
      'INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), actor, role, otherSite],
    );
  return {
    site,
    otherSite,
    actor,
    assignment,
    context: { actorUserId: actor, reauthorize: async () => {} },
    service: new MainAssignmentCommandService(db),
  };
}

for (const operation of ['review', 'decision', 'revoke'] as const) {
  test(`Assignment ${operation} does not disclose another Site's ID existence`, async () => {
    const f = await fixture();
    const invoke = (id: string) =>
      operation === 'review'
        ? f.service.publicSafetyReview(id, f.context)
        : operation === 'decision'
          ? f.service.publicDecision(
              id,
              { approve: false, reviewNote: 'Synthetic rejection' },
              f.context,
            )
          : f.service.publicRevoke(
              id,
              { expectedVersion: 1, reviewNote: 'Synthetic revoke' },
              f.context,
            );
    for (const id of [f.assignment, randomUUID()])
      await assert.rejects(
        invoke(id),
        (error: { getStatus?: () => number }) => error.getStatus?.() === 404,
      );
    assert.equal(
      (
        await db.query('SELECT status FROM worker_site_zone_assignment WHERE id=$1', [f.assignment])
      )[0].status,
      'PENDING',
    );
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
          [f.actor],
        )
      )[0].n,
      0,
    );
  });
}

test('Assignment scope remains available to the existing same-Site Safety role', async () => {
  const f = await fixture();
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
    [randomUUID(), f.actor, f.site],
  );
  const reviewed = await f.service.publicSafetyReview(f.assignment, f.context);
  assert.equal(reviewed.status, 'SAFETY_REVIEWED');
  assert.equal(reviewed.siteId, f.site);
});
