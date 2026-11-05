import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import type { EntityManager } from 'typeorm';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';
import { DocumentOcrService } from '../../src/modules/workforce/documents/document-ocr.service.js';
import { LocalDocumentOcr } from '../../src/modules/workforce/documents/local-document-ocr.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Worker document review binds current session, scoped role and atomic policy writes', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      otherSite = randomUUID(),
      user = randomUUID(),
      role = randomUUID(),
      worker = randomUUID(),
      session = randomUUID();
    for (const id of [site, otherSite])
      await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
        id,
      ]);
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic reviewer','not-a-runtime-password')",
      [user],
    );
    const restoreRole = () =>
      db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
        [role, user, site],
      );
    await restoreRole();
    // Keep the account authenticatable when the separate Safety role is removed.
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'WORKER',$3)",
      [randomUUID(), user, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic legacy Worker')",
      [worker, site],
    );
    await db.query(
      "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '10 minutes')",
      [session, user, session.replaceAll('-', '').repeat(2)],
    );
    const config = createTestConfig();
    const tokens = new AuthTokenService(new JwtService(), config);
    const auth = new AuthService(db, tokens);
    const token = await tokens.issueAccessToken(user, session);
    const actor = (await auth.authenticate(token.accessToken)).user;
    const context = {
      actorUserId: user,
      reauthorize: async (manager: EntityManager) => {
        assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, user);
      },
    };
    const service = new WorkerDocumentsService(
      db,
      new ContractorOperationsService(db),
      new StorageService(config),
      new DocumentOcrService(new LocalDocumentOcr(config)),
      new DocumentNotificationsService(db, config),
    );
    const newDocument = async () => {
      const id = randomUUID();
      await db.query(
        "INSERT INTO worker_document(id,worker_id,kind,status,original_name,file,ocr,uploaded_by) VALUES($1,$2,'SAFETY_CARD','PENDING','synthetic.pdf','{}'::jsonb,'{}'::jsonb,$3)",
        [id, worker, user],
      );
      return id;
    };
    const review = (id: string, siteId = site, approve = false) =>
      service.review(
        actor,
        siteId,
        worker,
        id,
        {
          expectedVersion: 1,
          approve,
          reviewNote: 'Synthetic review',
          ...(approve ? { issuedOn: '2020-01-01', expiresOn: '2099-01-01' } : {}),
        },
        context,
      );
    const snapshot = async () => [
      await db.query('SELECT * FROM worker_document ORDER BY id'),
      await db.query('SELECT * FROM audit_log ORDER BY id'),
      await db.query('SELECT * FROM user_notification ORDER BY id'),
      await db.query('SELECT id,access_policy_version FROM site ORDER BY id'),
    ];
    const rejectUnchanged = async (work: () => Promise<unknown>, status: number) => {
      const before = await snapshot();
      await assert.rejects(
        work,
        (error) => (error as { getStatus?: () => number }).getStatus?.() === status,
      );
      assert.deepEqual(await snapshot(), before);
    };
    await t.test('authorized approval commits once and stale review cannot repeat it', async () => {
      const id = await newDocument();
      const before = Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      );
      const result = await review(id, site, true);
      assert.equal(result.status, 'APPROVED');
      assert.equal(result.version, 2);
      assert.equal(
        Number(
          (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
        ),
        before + 1,
      );
      assert.equal(
        (
          await db.query(
            "SELECT id FROM audit_log WHERE action='WORKER_DOCUMENT_REVIEWED' AND entity_id=$1",
            [worker],
          )
        ).length,
        1,
      );
      await rejectUnchanged(() => review(id, site, true), 409);
    });
    const pending = await newDocument();
    await t.test(
      'expired and revoked original sessions cannot commit a pending review',
      async () => {
        await db.query(
          "UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [session],
        );
        await rejectUnchanged(() => review(pending), 401);
        await db.query(
          "UPDATE auth_session SET expires_at=clock_timestamp()+interval '10 minutes',revoked_at=clock_timestamp() WHERE id=$1",
          [session],
        );
        await rejectUnchanged(() => review(pending), 401);
        await db.query('UPDATE auth_session SET revoked_at=NULL WHERE id=$1', [session]);
      },
    );
    await t.test(
      'removed current Safety role cannot use an already authenticated actor',
      async () => {
        await db.query('DELETE FROM user_role_assignment WHERE id=$1', [role]);
        try {
          assert.equal((await auth.authenticate(token.accessToken)).user.id, user);
          await rejectUnchanged(() => review(pending), 403);
        } finally {
          await restoreRole();
        }
      },
    );
    await t.test('foreign Site and missing Worker scopes fail without writes', async () => {
      await rejectUnchanged(() => review(pending, otherSite), 403);
      await rejectUnchanged(
        () =>
          service.review(
            actor,
            site,
            randomUUID(),
            pending,
            {
              expectedVersion: 1,
              approve: false,
              reviewNote: 'Synthetic review',
            },
            context,
          ),
        404,
      );
    });
    await t.test('database audit failure rolls back document and policy writes', async () => {
      await db.query(
        "CREATE FUNCTION reject_review_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$; CREATE TRIGGER synthetic_review_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_review_audit()",
      );
      const before = await snapshot();
      try {
        await assert.rejects(() => review(pending), /synthetic audit failure/);
      } finally {
        await db.query(
          'DROP TRIGGER synthetic_review_audit ON audit_log; DROP FUNCTION reject_review_audit()',
        );
      }
      assert.deepEqual(await snapshot(), before);
    });
    await t.test(
      'partial authority journal prevents review before all business writes',
      async () => {
        await db.query('CREATE TABLE authorization_history_baseline(synthetic boolean)');
        await rejectUnchanged(() => review(pending), 503);
      },
    );
  } finally {
    await owned.dispose();
  }
});
