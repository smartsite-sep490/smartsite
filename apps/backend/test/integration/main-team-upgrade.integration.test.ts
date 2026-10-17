import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCapturedStateReader } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';

for (const preJournal of [false, true]) {
  test(`populated ${preJournal ? 'pre-journal' : 'V1'} upgrade bridges only fresh V2 baseline state; old facts and gaps remain intact`, async (t) => {
    const isolated = createIsolatedTestDatabase({ canonical: true }),
      db = isolated.dataSource;
    const production = db.options.migrations;
    assert(Array.isArray(production));
    db.setOptions({
      migrations: preJournal
        ? production.slice(0, 35)
        : production.filter(
            (m) =>
              typeof m !== 'function' ||
              ![
                'Mf06TeamAuthorityHistory1792281600000',
                'ZoneEntryPhysicalStorage1792454400000',
              ].includes(m.name),
          ),
    });
    t.after(() => isolated.dispose());
    await isolated.initialize();
    const site = randomUUID(),
      actor = randomUUID(),
      contractor = randomUUID(),
      worker = randomUUID(),
      zone = randomUUID(),
      team = randomUUID(),
      assignment = randomUUID(),
      participation = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic upgrader','not-a-login-hash')",
      [actor],
    );
    await db.query("INSERT INTO user_role_assignment(id,user_id,role) VALUES($1,$2,'ADMIN')", [
      randomUUID(),
      actor,
    ]);
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic upgrade Site')",
      [site],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic upgrade Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic upgrade Zone','STANDARD','NONE')",
      [zone, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic worker')",
      [worker, site, contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from,valid_until) VALUES($1,$2,$3,clock_timestamp()-interval '1 day',clock_timestamp()+interval '2 days')",
      [participation, site, contractor],
    );
    await db.query(
      "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) SELECT $1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED',valid_from,valid_until,$6 FROM contractor_site_participation WHERE id=$4",
      [assignment, worker, site, participation, zone, actor],
    );
    if (preJournal) {
      await db.destroy();
      db.setOptions({
        migrations: production.filter(
          (m) =>
            typeof m !== 'function' ||
            ![
              'Mf06TeamAuthorityHistory1792281600000',
              'ZoneEntryPhysicalStorage1792454400000',
            ].includes(m.name),
        ),
      });
      await db.initialize();
      await db.runMigrations();
      assert.deepEqual(
        await db.query(
          "SELECT source_id FROM mf06_authority_head WHERE source_kind='ASSIGNMENT' AND source_id=$1",
          [assignment],
        ),
        [],
      );
    }
    await db.query(
      "INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,created_by) VALUES($1,$2,$3,'Synthetic team','synthetic team',$4)",
      [team, site, contractor, actor],
    );
    const facts = await db.query('SELECT * FROM mf06_authority_fact ORDER BY fact_id'),
      gaps = await db.query('SELECT * FROM mf06_authority_gap ORDER BY gap_id');
    await db.destroy();
    db.setOptions({ migrations: production });
    await db.initialize();
    assert.equal((await db.runMigrations()).length, 2);
    assert.deepEqual(
      await db.query('SELECT * FROM authorization_history_revision ORDER BY fact_id'),
      facts,
    );
    assert.deepEqual(
      await db.query('SELECT * FROM authorization_history_gap ORDER BY gap_id'),
      gaps,
    );
    const context = { actorUserId: actor, reauthorize: async () => {} };
    const baseline = await new MainAuthorityBaselineService(db).capture(context, 'a'.repeat(64));
    await executeMainConfigurationCommand(db, context, 'TEAM_ARCHIVE', { team }, async (m) => {
      await m.query('UPDATE contractor_team SET is_active=false WHERE id=$1', [team]);
    });
    await executeMainConfigurationCommand(
      db,
      context,
      'ASSIGNMENT_REVOKE',
      { assignment },
      async (m) => {
        await m.query("UPDATE worker_site_zone_assignment SET status='REVOKED' WHERE id=$1", [
          assignment,
        ]);
      },
    );
    if (preJournal)
      await executeMainConfigurationCommand(
        db,
        context,
        'ZONE_POLICY_UPDATE',
        { zone },
        async (m) => {
          await m.query('UPDATE zone SET configuration_locked=true WHERE id=$1', [zone]);
        },
      );
    const read = async () => {
      const [clock] = await db.query(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
      );
      return db.transaction('SERIALIZABLE', async (m) => {
        await m.query('SET TRANSACTION READ ONLY');
        return new MainAuthorityCapturedStateReader().read(m, {
          epochId: baseline.epochId,
          siteId: site,
          zoneId: zone,
          workerId: worker,
          capturedAt: clock.at,
          purpose: 'RETROSPECTIVE_REVIEW',
        });
      });
    };
    const result = await read();
    assert.equal(result.status, 'RECONSTRUCTED', JSON.stringify(result));
    if (result.status === 'RECONSTRUCTED') assert.equal(result.authorityCoverageEstablished, false);
    assert.deepEqual(
      await db.query(
        'SELECT * FROM authorization_history_revision WHERE fact_id=ANY($1::uuid[]) ORDER BY fact_id',
        [facts.map((f: { fact_id: string }) => f.fact_id)],
      ),
      facts,
    );
    // A later bypass still creates a gap, even if the row is brought back to baseline values.
    await db.query('UPDATE contractor_team SET is_active=true WHERE id=$1', [team]);
    assert.deepEqual(await read(), { status: 'UNAVAILABLE', reason: 'HISTORY_GAP' });
  });
}
