import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('document review rechecks original Officer session and keeps document, notifications and Site policy atomic', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      other = randomUUID(),
      actor = randomUUID(),
      worker = randomUUID(),
      document = randomUUID(),
      password = 'SyntheticInitial123!';
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site'),($2,$2::uuid::text,'Synthetic other')",
      [site, other],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Officer',$2)",
      [actor, await hashPassword(password)],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'SAFETY_OFFICER')",
      [randomUUID(), actor, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic Worker')",
      [worker, site],
    );
    const file = {
      storageProvider: 'LOCAL',
      storageKey: randomUUID() + '.jpg',
      sha256: 'a'.repeat(64),
      size: 1,
      mediaType: 'image/jpeg',
    };
    await db.query(
      "INSERT INTO worker_document(id,worker_id,kind,status,original_name,file,ocr,uploaded_by) VALUES($1,$2,'SAFETY_CARD','PENDING','synthetic.jpg',$3,$4,$5)",
      [document, worker, file, { status: 'UNAVAILABLE', warnings: [] }, actor],
    );
    const config = createTestConfig(),
      notifications = new DocumentNotificationsService(db, config);
    const make = (notify = notifications) =>
      new WorkerDocumentsService(
        db,
        new ContractorOperationsService(db),
        {} as never,
        notify,
        {} as never,
      );
    const service = make(),
      auth = new AuthService(db, new AuthTokenService(new JwtService(), config)),
      guard = new UserAuthGuard(auth);
    const actorFor = async () => {
      const login = await auth.login(actor, password, AuthClientType.WEB),
        request: AuthenticatedRequest = {
          headers: { authorization: 'Bearer ' + login.accessToken },
        };
      await guard.authenticateRequest(request);
      return {
        request,
        actor: request.user!,
        context: configurationCommandContext(request, guard),
      };
    };
    const revoked = await actorFor();
    await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
      revoked.request.sessionId,
    ]);
    const input = { approve: false, expectedVersion: 1, reviewNote: 'Synthetic rejection' };
    await assert.rejects(
      Reflect.apply(service.review, service, [
        revoked.actor,
        site,
        worker,
        document,
        input,
        revoked.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    const active = await actorFor(),
      initial = Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      );
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE user_id=$1", [actor]);
    await assert.rejects(
      Reflect.apply(service.review, service, [
        active.actor,
        site,
        worker,
        document,
        input,
        active.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query("UPDATE user_role_assignment SET role='SAFETY_OFFICER' WHERE user_id=$1", [
      actor,
    ]);
    await assert.rejects(
      Reflect.apply(service.review, service, [
        active.actor,
        other,
        worker,
        document,
        input,
        active.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    const failure = make({
      record: async () => {
        throw Error('Synthetic notification failure');
      },
    } as never);
    await assert.rejects(
      Reflect.apply(failure.review, failure, [
        active.actor,
        site,
        worker,
        document,
        input,
        active.context,
      ]),
      /Synthetic notification failure/,
    );
    assert.equal(
      (await db.query('SELECT status FROM worker_document WHERE id=$1', [document]))[0].status,
      'PENDING',
    );
    assert.equal(
      Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      ),
      initial,
    );
    const result = await Reflect.apply(service.review, service, [
      active.actor,
      site,
      worker,
      document,
      input,
      active.context,
    ]);
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.version, 2);
    assert.equal(
      Number(
        (await db.query('SELECT access_policy_version AS v FROM site WHERE id=$1', [site]))[0].v,
      ),
      initial + 1,
    );
  } finally {
    await owned.dispose();
  }
});

test('document bundle rechecks the original Representative session and scope after file preparation', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const site = randomUUID(),
      contractor = randomUUID(),
      actor = randomUUID(),
      worker = randomUUID();
    const password = 'SyntheticInitial123!';
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    await db.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
      [contractor],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic Representative',$2)",
      [actor, await hashPassword(password)],
    );
    const role = randomUUID(),
      grant = randomUUID();
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'CONTRACTOR_REPRESENTATIVE')",
      [role, actor, site],
    );
    await db.query(
      'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
      [grant, actor, contractor],
    );
    await db.query(
      "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,is_active) VALUES($1,$2,$3,'2020-01-01',true)",
      [randomUUID(), contractor, site],
    );
    await db.query(
      "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
      [worker, site, contractor],
    );
    const config = createTestConfig();
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), config)),
      guard = new UserAuthGuard(auth);
    const login = async () => {
      const signedIn = await auth.login(actor, password, AuthClientType.WEB);
      const request: AuthenticatedRequest = {
        headers: { authorization: 'Bearer ' + signedIn.accessToken },
      };
      await guard.authenticateRequest(request);
      return {
        request,
        actor: request.user!,
        context: configurationCommandContext(request, guard),
      };
    };
    let interrupt: () => Promise<void> = async () => {};
    const stored = new Set<string>();
    let prepared = 0;
    const storage = {
      save: async (buffer: Buffer, mediaType: string) => {
        prepared++;
        await interrupt();
        const storageKey = randomUUID();
        stored.add(storageKey);
        return {
          storageProvider: 'LOCAL',
          storageKey,
          sha256: 'a'.repeat(64),
          size: buffer.length,
          mediaType,
        };
      },
      remove: async (file: { storageKey: string }) => {
        stored.delete(file.storageKey);
      },
    };
    const service = new WorkerDocumentsService(
      db,
      new ContractorOperationsService(db),
      storage as never,
      new DocumentNotificationsService(db, config),
      {} as never,
    );
    const buffer = await sharp({
      create: { width: 10, height: 10, channels: 3, background: 'white' },
    })
      .jpeg()
      .toBuffer();
    const file = { buffer, size: buffer.length, mimetype: 'image/jpeg' };
    const files = { HEALTH_CERTIFICATE: file, PERSONAL_INSURANCE: file };
    const command = {
      expectedVersion: 0,
      safetyCardRequired: false,
      documents: {
        HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-01' },
        PERSONAL_INSURANCE: { submittedExpiresOn: '2099-11-01' },
      },
    };
    for (const change of ['logout', 'role', 'grant'] as const) {
      const current = await login();
      let changed = false;
      interrupt = async () => {
        if (changed) return;
        changed = true;
        if (change === 'logout')
          await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
            current.request.sessionId,
          ]);
        if (change === 'role')
          await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE id=$1", [role]);
        if (change === 'grant')
          await db.query('DELETE FROM contractor_representative_grant WHERE id=$1', [grant]);
      };
      await assert.rejects(
        service.submit(
          current.actor,
          site,
          worker,
          { ...command, requestId: randomUUID() },
          files,
          current.context,
        ),
        (e) => (e as { getStatus(): number }).getStatus() === (change === 'logout' ? 401 : 403),
      );
      assert.equal(stored.size, 0);
      assert.equal(
        Number(
          (
            await db.query('SELECT count(*) AS n FROM worker_document WHERE worker_id=$1', [worker])
          )[0].n,
        ),
        0,
      );
      assert.equal(
        Number(
          (
            await db.query(
              'SELECT count(*) AS n FROM worker_compliance_profile WHERE worker_id=$1',
              [worker],
            )
          )[0].n,
        ),
        0,
      );
      if (change === 'role')
        await db.query(
          "UPDATE user_role_assignment SET role='CONTRACTOR_REPRESENTATIVE' WHERE id=$1",
          [role],
        );
      if (change === 'grant')
        await db.query(
          'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
          [grant, actor, contractor],
        );
    }
    interrupt = async () => {};
    const current = await login();
    const input = { ...command, requestId: randomUUID() };
    const receipt = await service.submit(
      current.actor,
      site,
      worker,
      input,
      files,
      current.context,
    );
    assert.equal(receipt.documentIds.length, 2);
    assert.equal(stored.size, 2);
    const count = prepared;
    assert.deepEqual(
      await service.submit(current.actor, site, worker, input, files, current.context),
      receipt,
    );
    assert.equal(prepared, count);
    await db.query("UPDATE user_role_assignment SET role='WORKER' WHERE id=$1", [role]);
    await assert.rejects(
      service.submit(current.actor, site, worker, input, files, current.context),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    assert.equal(prepared, count);
  } finally {
    await owned.dispose();
  }
});
