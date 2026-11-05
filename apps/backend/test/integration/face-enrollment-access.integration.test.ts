import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { FaceEnrollmentService } from '../../src/modules/workforce/identity/face-enrollment.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('enrollment access retains current account and Site grant state in its transaction', async (t) => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      user = randomUUID(),
      worker = randomUUID(),
      role = randomUUID(),
      grant = randomUUID(),
      participation = randomUUID();
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Enrollment test Site')",
      [site],
    );
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Enrollment test Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Enrollment test Representative','not-a-runtime-password')",
      [user],
    );
    const restoreRole = () =>
      db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
        [role, user, site],
      );
    const restoreGrant = () =>
      db.query(
        'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
        [grant, user, contractor],
      );
    await restoreRole();
    await restoreGrant();
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')",
      [participation, contractor, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Enrollment test Worker')",
      [worker, site, contractor],
    );
    const actor = {
      id: user,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site }],
    };
    const service = new ContractorOperationsService(db);
    const access = () =>
      db.transaction((manager) => service.requireWorkerEnrollmentAccess(manager, actor, worker));
    const forbidden = (error: unknown) =>
      error instanceof Error &&
      'getStatus' in error &&
      typeof error.getStatus === 'function' &&
      error.getStatus() === 403;

    await t.test('current representative retains existing enrollment access', async () => {
      assert.equal((await access()).id, worker);
    });
    await t.test('old request cannot bypass account deactivation', async () => {
      await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [user]);
      try {
        await assert.rejects(access, forbidden);
      } finally {
        await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [user]);
      }
    });
    await t.test('old request cannot bypass current password restriction', async () => {
      await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [user]);
      try {
        await assert.rejects(access, forbidden);
      } finally {
        await db.query('UPDATE app_user SET must_change_password=false WHERE id=$1', [user]);
      }
    });
    await t.test('old request cannot reuse a removed Site role', async () => {
      await db.query('DELETE FROM user_role_assignment WHERE id=$1', [role]);
      try {
        await assert.rejects(access, forbidden);
      } finally {
        await restoreRole();
      }
    });
    await t.test('a current role at another Site cannot satisfy the old Site claim', async () => {
      const otherSite = randomUUID();
      await db.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Other enrollment Site')",
        [otherSite],
      );
      await db.query('UPDATE user_role_assignment SET site_id=$1 WHERE id=$2', [otherSite, role]);
      try {
        await assert.rejects(access, forbidden);
      } finally {
        await db.query('UPDATE user_role_assignment SET site_id=$1 WHERE id=$2', [site, role]);
      }
    });
    await t.test('contractor grant revocation remains enforced', async () => {
      await db.query('DELETE FROM contractor_representative_grant WHERE id=$1', [grant]);
      try {
        await assert.rejects(access, forbidden);
      } finally {
        await restoreGrant();
      }
    });
    await t.test('expired participation remains forbidden', async () => {
      await db.query(
        "UPDATE contractor_site_participation SET valid_until=clock_timestamp()-interval '1 hour' WHERE id=$1",
        [participation],
      );
      try {
        await assert.rejects(access, forbidden);
      } finally {
        await db.query('UPDATE contractor_site_participation SET valid_until=NULL WHERE id=$1', [
          participation,
        ]);
      }
    });
    await t.test('completion rejects a role revoked while awaiting the adapter', async () => {
      let adapterCalls = 0;
      const enrollment = new FaceEnrollmentService(db, service, {
        assessSampleQuality: async () => {
          throw new Error('This authorization test must not process images');
        },
        submitSample: async () => {
          throw new Error('This authorization test must not submit images');
        },
        completeEnrollment: async () => {
          adapterCalls++;
          await db.query('DELETE FROM user_role_assignment WHERE id=$1', [role]);
          return {
            profileReference: `synthetic:${randomUUID()}`,
            modelVersion: 'synthetic-authorization-test',
            encryptedTemplate: 'a'.repeat(150),
          };
        },
      });
      const session = await enrollment.start(actor, worker, {
        consentVersion: 'synthetic-authorization-test',
      });
      await enrollment.confirmConsent(session.id, {
        consentToken: session.consentToken,
        workerConfirmed: true,
      });
      // Synthetic session setup: no biometric data or real consent is collected.
      await db.query('UPDATE face_enrollment_session SET accepted_sample_count=3 WHERE id=$1', [
        session.id,
      ]);
      try {
        await assert.rejects(() => enrollment.complete(actor, session.id), forbidden);
        assert.equal(adapterCalls, 1);
        const [{ count }] = await db.query(
          'SELECT count(*)::int AS count FROM face_profile WHERE worker_id=$1',
          [worker],
        );
        assert.equal(count, 0);
        const [stored] = await db.query('SELECT status FROM face_enrollment_session WHERE id=$1', [
          session.id,
        ]);
        assert.notEqual(stored.status, 'COMPLETED');
      } finally {
        if (adapterCalls) await restoreRole();
      }
    });
    await t.test('a concurrent role deletion waits for the enrollment transaction', async () => {
      const reader = db.createQueryRunner(),
        writer = db.createQueryRunner();
      let deletion: Promise<void> | undefined;
      let completed = false,
        writeError: unknown;
      try {
        await reader.connect();
        await writer.connect();
        await reader.startTransaction();
        await writer.startTransaction();
        await service.requireWorkerEnrollmentAccess(reader.manager, actor, worker);
        const [{ pid }] = await writer.query('SELECT pg_backend_pid() AS pid');
        deletion = writer.query('DELETE FROM user_role_assignment WHERE id=$1', [role]).then(
          () => {
            completed = true;
          },
          (error: unknown) => {
            completed = true;
            writeError = error;
          },
        );
        let blocked = false;
        const deadline = performance.now() + 5000;
        while (performance.now() < deadline && !completed) {
          const [state] = await db.query(
            'SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',
            [pid],
          );
          if (state?.wait_event_type === 'Lock') {
            blocked = true;
            break;
          }
          await setTimeout(20);
        }
        assert.equal(blocked, true, 'The database must actually report a lock wait');
        assert.equal(completed, false);
      } finally {
        if (reader.isTransactionActive) await reader.rollbackTransaction();
        await deletion;
        if (writer.isTransactionActive) await writer.rollbackTransaction();
        await reader.release();
        await writer.release();
      }
      if (writeError) throw writeError;
      assert.equal(completed, true);
    });
  } finally {
    await owned.dispose();
  }
});
