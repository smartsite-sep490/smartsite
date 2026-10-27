import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;

before(async () => {
  console.log(`ownedAssignmentParticipationSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});

after(() => owned.dispose());

interface ParticipationInput {
  id?: string;
  validFrom: string;
  validUntil: string | null;
}

async function fixture(participations: ParticipationInput[]) {
  const actor = randomUUID(),
    site = randomUUID(),
    contractor = randomUUID(),
    worker = randomUUID(),
    zone = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-password',false)",
    [actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
    [randomUUID(), actor, site],
  );
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [contractor],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), actor, contractor],
  );
  const participationIds: string[] = [];
  for (const p of participations) {
    const pid = p.id ?? randomUUID();
    participationIds.push(pid);
    await db.query(
      'INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,$4::timestamptz,$5::timestamptz,true)',
      [pid, contractor, site, p.validFrom, p.validUntil],
    );
  }
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [worker, site, contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zone, site],
  );
  return {
    actor,
    site,
    contractor,
    worker,
    zone,
    participationIds,
    context: { actorUserId: actor, reauthorize: async () => {} },
    service: new MainAssignmentCommandService(db),
    input: {
      siteId: site,
      zoneIds: [zone],
      validFrom: '2026-10-01T00:00:00.000002Z',
      validUntil: '2027-12-01T00:00:00.000002Z',
    },
  };
}

const status = (code: number) => (error: unknown) =>
  (error as { getStatus?: () => number }).getStatus?.() === code;

test('early expired participation row before covering row selects covering participation anchor', async () => {
  const f = await fixture([
    {
      validFrom: '2026-01-01T00:00:00.000001Z',
      validUntil: '2027-12-01T00:00:00.000001Z',
    },
    {
      validFrom: '2026-10-01T00:00:00.000002Z',
      validUntil: '2027-12-01T00:00:00.000002Z',
    },
  ]);
  const created = await f.service.publicRequest(f.worker, f.input, f.context);
  assert.equal(created.siteContractorId, f.participationIds[1]);
  const stored = (
    await db.query(
      "SELECT site_contractor_id,valid_from='2026-10-01T00:00:00.000002Z'::timestamptz AS exact_start,valid_until='2027-12-01T00:00:00.000002Z'::timestamptz AS exact_end FROM worker_site_zone_assignment WHERE id=$1",
      [created.id],
    )
  )[0];
  assert.equal(stored.site_contractor_id, f.participationIds[1]);
  assert.equal(stored.exact_start, true);
  assert.equal(stored.exact_end, true);
});

test('future-start participation row before covering row selects covering participation anchor', async () => {
  const f = await fixture([
    {
      validFrom: '2026-10-01T00:00:00.000003Z',
      validUntil: '2028-01-01T00:00:00.000001Z',
    },
    {
      validFrom: '2026-10-01T00:00:00.000002Z',
      validUntil: '2027-12-01T00:00:00.000002Z',
    },
  ]);
  const created = await f.service.publicRequest(f.worker, f.input, f.context);
  assert.equal(created.siteContractorId, f.participationIds[1]);
  const stored = (
    await db.query(
      "SELECT site_contractor_id,valid_from='2026-10-01T00:00:00.000002Z'::timestamptz AS exact_start FROM worker_site_zone_assignment WHERE id=$1",
      [created.id],
    )
  )[0];
  assert.equal(stored.site_contractor_id, f.participationIds[1]);
  assert.equal(stored.exact_start, true);
});

test('no single participation row covering full interval rejects with 409 and preserves 403 start eligibility without writes', async () => {
  const f = await fixture([
    {
      validFrom: '2026-10-01T00:00:00.000003Z',
      validUntil: '2027-12-01T00:00:00.000002Z',
    },
    {
      validFrom: '2026-10-01T00:00:00.000002Z',
      validUntil: '2027-12-01T00:00:00.000001Z',
    },
  ]);
  await assert.rejects(f.service.publicRequest(f.worker, f.input, f.context), status(409));
  await assert.rejects(
    f.service.publicRequest(
      f.worker,
      { ...f.input, validFrom: '2026-10-01T00:00:00.000001Z' },
      f.context,
    ),
    status(403),
  );
  const assignments = (
    await db.query(
      'SELECT count(*)::int AS n FROM worker_site_zone_assignment WHERE worker_id=$1',
      [f.worker],
    )
  )[0].n;
  const commands = (
    await db.query(
      'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
      [f.actor],
    )
  )[0].n;
  assert.equal(assignments, 0);
  assert.equal(commands, 0);
});

test('multiple covering participation rows select deterministic valid_from then id anchor', async () => {
  const byStart = await fixture([
    {
      validFrom: '2026-05-01T00:00:00.000002Z',
      validUntil: '2028-01-01T00:00:00.000001Z',
    },
    {
      validFrom: '2026-05-01T00:00:00.000001Z',
      validUntil: '2028-01-01T00:00:00.000001Z',
    },
  ]);
  const createdByStart = await byStart.service.publicRequest(
    byStart.worker,
    byStart.input,
    byStart.context,
  );
  assert.equal(createdByStart.siteContractorId, byStart.participationIds[1]);

  const [smallerId, largerId] = [randomUUID().toLowerCase(), randomUUID().toLowerCase()].sort();
  const byTieId = await fixture([
    {
      id: largerId,
      validFrom: '2026-05-01T00:00:00.000001Z',
      validUntil: null,
    },
    {
      id: smallerId,
      validFrom: '2026-05-01T00:00:00.000001Z',
      validUntil: null,
    },
  ]);
  const createdByTieId = await byTieId.service.publicRequest(
    byTieId.worker,
    byTieId.input,
    byTieId.context,
  );
  assert.equal(createdByTieId.siteContractorId, smallerId);
});
