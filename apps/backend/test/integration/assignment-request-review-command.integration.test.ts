import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import type { WorkerSiteZoneAssignmentEntity } from '../../src/database/entities/worker-site-zone-assignment.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Assignment requests and Safety reviews keep current scoped authentication and atomic audit', async (t) => {
  const owned = createIsolatedTestDatabase({ beforeAuthorityInstall: true }),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      zone = randomUUID(),
      foreignZone = randomUUID(),
      worker = randomUUID(),
      contractor = randomUUID(),
      cr = randomUUID(),
      so = randomUUID(),
      outsider = randomUUID(),
      crRole = randomUUID(),
      soRole = randomUUID(),
      fullParticipation = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    for (const [id, scope] of [
      [zone, site],
      [foreignZone, otherSite],
    ])
      await db.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
        [id, scope],
      );
    for (const id of [cr, so, outsider])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Account','not-a-runtime-password')",
        [id],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3),($4,$5,'SAFETY_OFFICER',$3),($6,$2,'SAFETY_OFFICER',$3),($7,$5,'WORKER',$8),($9,$10,'SAFETY_OFFICER',$8)",
      [crRole, cr, site, soRole, so, randomUUID(), randomUUID(), otherSite, randomUUID(), outsider],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [randomUUID(), cr, contractor],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,'2019-01-01T00:00:00Z','2040-01-01T00:00:00Z',true)",
      [randomUUID(), contractor, site],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,'2020-01-01T00:00:00Z','2045-01-01T00:00:00Z',true)",
      [fullParticipation, contractor, site],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig()),
      auth = new AuthService(db, tokens);
    const authenticated = async (userId: string) => {
      const sessionId = randomUUID();
      await db.query(
        "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
        [sessionId, userId, sessionId.replaceAll('-', '').repeat(2)],
      );
      const token = await tokens.issueAccessToken(userId, sessionId),
        actor = (await auth.authenticate(token.accessToken)).user;
      return {
        sessionId,
        actor,
        context: {
          actorUserId: userId,
          reauthorize: async (manager: EntityManager) => {
            assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, userId);
          },
        },
      };
    };
    const representative = await authenticated(cr),
      safety = await authenticated(so),
      wrongSite = await authenticated(outsider),
      service = new ContractorOperationsService(db);
    const input = {
      siteId: site,
      zoneIds: [zone],
      validFrom: '2041-01-01T00:00:00Z',
      validUntil: '2042-01-01T00:00:00Z',
    };
    const request = (caller = representative, value = input, context = caller.context) =>
      Reflect.apply(service.requestAssignment, service, [
        caller.actor,
        worker,
        value,
        context,
      ]) as Promise<WorkerSiteZoneAssignmentEntity>;
    const review = (id: string, caller = safety, context = caller.context) =>
      Reflect.apply(service.safetyReview, service, [
        caller.actor,
        id,
        context,
      ]) as Promise<WorkerSiteZoneAssignmentEntity>;
    const snapshot = async () => [
      await db.query('SELECT * FROM worker_site_zone_assignment ORDER BY id'),
      await db.query('SELECT * FROM audit_log ORDER BY id'),
      await db.query('SELECT id,access_policy_version FROM site ORDER BY id'),
    ];
    const rejectUnchanged = async (work: () => Promise<unknown>, expected?: number) => {
      const before = await snapshot();
      if (expected === undefined) await assert.rejects(work);
      else
        await assert.rejects(
          work,
          (error) => (error as { getStatus?: () => number }).getStatus?.() === expected,
        );
      assert.deepEqual(await snapshot(), before);
    };
    let requestId: string;
    await t.test(
      'overlapping participations select one covering the whole requested interval',
      async () => {
        const result = await request();
        requestId = result.id;
        assert.equal(result.siteContractorId, fullParticipation);
        assert.equal(result.status, 'PENDING');
        assert.equal(result.version, 1);
        assert.deepEqual(result.zoneIds, [zone]);
        assert.equal(result.requestedByUserId, cr);
        await rejectUnchanged(
          () => request(representative, { ...input, validUntil: '2046-01-01T00:00:00Z' }),
          409,
        );
      },
    );
    await t.test(
      'Safety review increments version once and persists both audit actions in the proper scope',
      async () => {
        const beforeSite = await db.query('SELECT access_policy_version FROM site WHERE id=$1', [
          site,
        ]);
        const result = await review(requestId);
        assert.equal(result.status, 'SAFETY_REVIEWED');
        assert.equal(result.version, 2);
        assert.equal(result.safetyReviewedByUserId, so);
        assert.deepEqual(
          await db.query(
            'SELECT action,actor_account_id,site_id FROM audit_log WHERE entity_id=$1 ORDER BY action',
            [requestId],
          ),
          [
            { action: 'WORKER_ASSIGNMENT_REQUESTED', actor_account_id: cr, site_id: site },
            { action: 'WORKER_ASSIGNMENT_SAFETY_REVIEWED', actor_account_id: so, site_id: site },
          ],
        );
        assert.deepEqual(
          await db.query('SELECT access_policy_version FROM site WHERE id=$1', [site]),
          beforeSite,
        );
        await rejectUnchanged(() => review(requestId), 409);
      },
    );
    await t.test(
      'foreign Zone and wrong-Site Safety authority cannot request or review',
      async () => {
        await rejectUnchanged(
          () => request(representative, { ...input, zoneIds: [foreignZone] }),
          403,
        );
        await rejectUnchanged(() => review(requestId, wrongSite), 403);
        await rejectUnchanged(() => review(randomUUID()), 404);
      },
    );
    await t.test(
      'removed current CR and Safety roles defeat their stale actor snapshots',
      async () => {
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [crRole]);
        await rejectUnchanged(() => request(), 403);
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
          [crRole, cr, site],
        );
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [soRole]);
        await rejectUnchanged(() => review(requestId), 403);
        await db.query(
          "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
          [soRole, so, site],
        );
      },
    );
    await t.test(
      'requester cannot perform their own Safety review even with a Safety role',
      async () => {
        const pending = await request();
        await rejectUnchanged(() => review(pending.id, representative), 403);
      },
    );
    await t.test(
      'revoked sessions prevent requests and reviews using earlier actor snapshots',
      async () => {
        for (const session of [representative.sessionId, safety.sessionId])
          await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
            session,
          ]);
        await rejectUnchanged(() => request(), 401);
        await rejectUnchanged(() => review(requestId), 401);
        for (const session of [representative.sessionId, safety.sessionId])
          await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [session]);
      },
    );
    await t.test('authenticated command actor must match the supplied business actor', async () => {
      await rejectUnchanged(() => request(representative, input, safety.context), 403);
      await rejectUnchanged(() => review(requestId, safety, representative.context), 403);
    });
    await t.test(
      'audit insertion failure rolls back assignment creation and Safety transition',
      async () => {
        const pending = await request();
        await db.query(
          "CREATE FUNCTION synthetic_assignment_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic audit refusal'; END $$",
        );
        await db.query(
          'CREATE TRIGGER synthetic_assignment_audit_refusal BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION synthetic_assignment_audit_fail()',
        );
        try {
          await rejectUnchanged(() => request());
          await rejectUnchanged(() => review(pending.id));
        } finally {
          await db.query('DROP TRIGGER synthetic_assignment_audit_refusal ON audit_log');
          await db.query('DROP FUNCTION synthetic_assignment_audit_fail()');
        }
      },
    );
    await t.test(
      'partial journal prevents request and Safety review without audit or version writes',
      async () => {
        const pending = await request();
        await db.query('CREATE TABLE authorization_history_baseline (synthetic boolean)');
        await rejectUnchanged(() => request(), 503);
        await rejectUnchanged(() => review(pending.id), 503);
      },
    );
  } finally {
    await owned.dispose();
  }
});
