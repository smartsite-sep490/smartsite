import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCapturedStateReader } from '../../src/modules/zones/main-authority-captured-state.reader.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
before(async () => {
  await owned.initialize();
});
after(async () => {
  await owned.dispose();
});

async function fixture() {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin','SYNTHETIC_NOT_A_PASSWORD',true,false)",
    [actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  const context = { actorUserId: actor, reauthorize: async () => {} };
  const baseline = await new MainAuthorityBaselineService(db).capture(context, 'a'.repeat(64));
  const [time] = await db.query(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
  );
  return {
    actor,
    site,
    zone,
    context,
    input: {
      epochId: baseline.epochId,
      siteId: site,
      zoneId: zone,
      workerId: null,
      capturedAt: time.at as string,
      purpose: 'RETROSPECTIVE_REVIEW' as const,
    },
  };
}

async function counts() {
  return (
    await db.query(`SELECT (SELECT count(*)::int FROM authorization_history_command) AS commands,
    (SELECT count(*)::int FROM authorization_history_revision) AS facts,
    (SELECT count(*)::int FROM authorization_history_gap) AS gaps,
    (SELECT count(*)::int FROM authorization_history_commit_receipt) AS witnesses`)
  )[0];
}

const damagedFunctions = [
  [
    'capture drops facts',
    'mf06_capture_main_authority',
    "CREATE OR REPLACE FUNCTION mf06_capture_main_authority() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT SET timezone='UTC' AS $$ BEGIN RETURN NULL; END $$",
  ],
  [
    'command omits actor check',
    'mf06_authority_command_guard',
    'CREATE OR REPLACE FUNCTION mf06_authority_command_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN NEW.transaction_id:=pg_current_xact_id(); NEW.started_at:=clock_timestamp(); RETURN NEW; END $$',
  ],
  [
    'witness omits committed transaction check',
    'mf06_authority_witness_guard',
    'CREATE OR REPLACE FUNCTION mf06_authority_witness_guard() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN SELECT transaction_id INTO NEW.transaction_id FROM authorization_history_command WHERE command_id=NEW.command_id; NEW.confirmed_at:=clock_timestamp(); RETURN NEW; END $$',
  ],
  [
    'internal guard omits hash ownership',
    'mf06_authority_internal_guard',
    'CREATE OR REPLACE FUNCTION mf06_authority_internal_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$',
  ],
  [
    'immutability guard permits mutation',
    'mf06_authority_immutable',
    'CREATE OR REPLACE FUNCTION mf06_authority_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN OLD; END $$',
  ],
  [
    'changed security context',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() SECURITY DEFINER',
  ],
  [
    'changed volatility',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() IMMUTABLE',
  ],
  [
    'strict trigger function',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() STRICT',
  ],
  [
    'wrong function search path',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() SET search_path=public',
  ],
  [
    'missing UTC setting',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() RESET timezone',
  ],
  [
    'unsafe parallel context',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() PARALLEL SAFE',
  ],
  [
    'changed leakproof context',
    'mf06_capture_main_authority',
    'ALTER FUNCTION mf06_capture_main_authority() LEAKPROOF',
  ],
  [
    'unapproved function GUC',
    'mf06_authority_command_guard',
    "ALTER FUNCTION mf06_authority_command_guard() SET work_mem='64MB'",
  ],
] as const;

const otherDependencies = [
  'mf06_assignment_response',
  'mf06_assignment_result_guard',
  'mf06_participation_response',
  'mf06_participation_result_guard',
  'mf06_zone_permission_response',
  'mf06_zone_permission_result_guard',
  'mf06_zone_deny_response',
  'mf06_zone_deny_result_guard',
  'mf06_authority_epoch_guard',
  'mf06_authority_baseline_capture',
  'mf06_authority_baseline_link',
] as const;
for (const name of otherDependencies) {
  test(`refuses a changed ${name} dependency even when source triggers are unchanged`, async () => {
    const [original] = await db.query(
      'SELECT pg_get_functiondef(p.oid) AS definition,l.lanname AS language FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname=current_schema() AND p.proname=$1',
      [name],
    );
    const replacement =
      original.language === 'sql' ? "SELECT '{}'::jsonb" : 'BEGIN RETURN NEW; END;';
    const corrupted = original.definition.replace(
      /\$function\$[\s\S]*?\$function\$/u,
      () => `$function$${replacement}$function$`,
    );
    assert.notEqual(corrupted, original.definition);
    await db.query(corrupted);
    try {
      assert.equal(await hasMainAuthorityCapture(db.manager), false);
    } finally {
      await db.query(original.definition);
    }
    assert.equal(await hasMainAuthorityCapture(db.manager), true);
  });
}

test('refuses an additional same-name overload that could change helper dispatch', async () => {
  await db.query(
    "CREATE FUNCTION mf06_assignment_response(source uuid, fallback boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$",
  );
  try {
    assert.equal(await hasMainAuthorityCapture(db.manager), false);
  } finally {
    await db.query('DROP FUNCTION mf06_assignment_response(uuid,boolean)');
  }
  assert.equal(await hasMainAuthorityCapture(db.manager), true);
});

test('permits only the exact canonical CRLF body variant, without normalizing arbitrary body text', async () => {
  const [original] = await db.query(
    "SELECT pg_get_functiondef(p.oid) AS definition,p.prosrc AS body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname='mf06_capture_main_authority'",
  );
  const crlf = original.body.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
  const replaced = original.definition.replace(
    /\$function\$[\s\S]*?\$function\$/u,
    () => `$function$${crlf}$function$`,
  );
  await db.query(replaced);
  try {
    assert.equal(await hasMainAuthorityCapture(db.manager), true);
    // An added body token is not an approved cross-platform newline variant.
    await db.query(
      original.definition.replace(
        /\$function\$[\s\S]*?\$function\$/u,
        () => `$function$${crlf}\r-- unapproved body change\n$function$`,
      ),
    );
    assert.equal(await hasMainAuthorityCapture(db.manager), false);
  } finally {
    await db.query(original.definition);
  }
});

for (const [label, name, change] of damagedFunctions) {
  test(`refuses ${label} before writes and captured-state reconstruction`, async () => {
    const f = await fixture();
    const [original] = await db.query(
      'SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() AND p.proname=$1',
      [name],
    );
    // Catalog damage is confined to this file-owned canonical39 schema.
    await db.query(change);
    try {
      assert.equal(await hasMainAuthorityCapture(db.manager, ['zone']), false);
      const initialCounts = await counts();
      let callbacks = 0;
      for (const context of [f.context, undefined]) {
        await assert.rejects(
          executeMainConfigurationCommand(
            db,
            context,
            'ZONE_POLICY_UPDATE',
            { zoneId: f.zone },
            async (manager) => {
              callbacks++;
              await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [
                f.zone,
              ]);
            },
          ),
          (error: { getStatus?: () => number }) => error.getStatus?.() === 503,
        );
      }
      assert.equal(callbacks, 0);
      assert.deepEqual(await counts(), initialCounts);
      assert.equal(
        (await db.query('SELECT restriction_policy FROM zone WHERE id=$1', [f.zone]))[0]
          .restriction_policy,
        'AUTHORIZATION_REQUIRED',
      );
      const result = await db.transaction('SERIALIZABLE', async (manager) => {
        await manager.query('SET TRANSACTION READ ONLY');
        return new MainAuthorityCapturedStateReader().read(manager, f.input);
      });
      assert.equal(result.status, 'UNAVAILABLE');
    } finally {
      await db.query(original.definition);
    }
    assert.equal(await hasMainAuthorityCapture(db.manager), true);
  });
}

test('canonical function bodies and attributes permit facts, witness and private reconstruction', async () => {
  const f = await fixture();
  assert.equal(await hasMainAuthorityCapture(db.manager), true);
  await executeMainConfigurationCommand(
    db,
    f.context,
    'ZONE_POLICY_UPDATE',
    { zoneId: f.zone },
    async (manager) => {
      await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [f.zone]);
    },
  );
  const [fact] = await db.query(
    'SELECT c.actor_user_id,w.command_id AS witness FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1 ORDER BY revision DESC LIMIT 1',
    [f.zone],
  );
  assert.equal(fact.actor_user_id, f.actor);
  assert.ok(fact.witness);
  const result = await db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    return new MainAuthorityCapturedStateReader().read(manager, f.input);
  });
  assert.equal(result.status, 'RECONSTRUCTED');
  if (result.status === 'RECONSTRUCTED') {
    assert.equal(result.authorityCoverageEstablished, false);
    assert.equal(result.identityEstablished, false);
  }
});
