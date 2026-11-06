import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { WorkerDocumentsController } from '../../src/modules/workforce/documents/worker-documents.controller.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import {
  DocumentOcrService,
  unavailableOcr,
} from '../../src/modules/workforce/documents/document-ocr.service.js';
import { LocalDocumentOcr } from '../../src/modules/workforce/documents/local-document-ocr.js';
import { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test(
  'document and identity uploads recheck the original session after OCR',
  { timeout: 30000 },
  async (t) => {
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
    let app: NestExpressApplication | undefined;
    try {
      await owned.initialize();
      const [{ schema }] = await db.query('SELECT current_schema() AS schema');
      console.log(`DOCUMENT_UPLOAD_TEST_SCHEMA:${schema}`);
      const storageRoot = await mkdtemp(join(tmpdir(), 'document-upload-session-'));
      const config = createTestConfig({
        STORAGE_LOCAL_ROOT: storageRoot,
        STORAGE_PROVIDER: 'LOCAL',
      });
      const siteId = randomUUID(),
        contractorId = randomUUID(),
        actorId = randomUUID();
      await db.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Upload session test Site')",
        [siteId],
      );
      await db.query(
        "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Upload test Contractor')",
        [contractorId],
      );
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Upload test Representative','not-a-runtime-password')",
        [actorId],
      );
      await db.query(
        "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'CONTRACTOR_REPRESENTATIVE',$3)",
        [randomUUID(), actorId, siteId],
      );
      await db.query(
        'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
        [randomUUID(), actorId, contractorId],
      );
      await db.query(
        "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from) VALUES($1,$2,$3,clock_timestamp()-interval '1 day')",
        [randomUUID(), contractorId, siteId],
      );
      const tokens = new AuthTokenService(new JwtService(), config);
      const guard = new UserAuthGuard(new AuthService(db, tokens));
      const ocr = new DocumentOcrService(new LocalDocumentOcr(config));
      let sessionId = '',
        revokeDuringRead = false,
        readCalls = 0;
      ocr.quality = async () => ({ status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' });
      ocr.read = async () => {
        readCalls++;
        if (revokeDuringRead)
          await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
            sessionId,
          ]);
        return unavailableOcr();
      };
      const service = new WorkerDocumentsService(
        db,
        new ContractorOperationsService(db),
        new StorageService(config),
        ocr,
        new DocumentNotificationsService(db, config),
      );
      const module = await Test.createTestingModule({
        controllers: [WorkerDocumentsController],
        providers: [
          { provide: WorkerDocumentsService, useValue: service },
          { provide: UserAuthGuard, useValue: guard },
        ],
      })
        .overrideGuard(UserAuthGuard)
        .useValue(guard)
        .compile();
      app = module.createNestApplication<NestExpressApplication>({ logger: false });
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      for (const identity of [false, true]) {
        for (const revoked of [false, true]) {
          await t.test(
            `${identity ? 'identity image' : 'document'} / ${revoked ? 'revoked during OCR' : 'active'}`,
            async () => {
              const workerId = randomUUID();
              await db.query(
                "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Upload test Worker')",
                [workerId, siteId, contractorId],
              );
              sessionId = randomUUID();
              await db.query(
                "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,last_refreshed_at,expires_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp()+interval '1 hour')",
                [sessionId, actorId, 'a'.repeat(64)],
              );
              const { accessToken } = await tokens.issueAccessToken(actorId, sessionId);
              revokeDuringRead = revoked;
              readCalls = 0;
              const filesBefore = (await readdir(storageRoot)).length;
              const form = new FormData();
              form.append(
                'file',
                new Blob([new Uint8Array([255, 216, 255, 1, 255, 217])], { type: 'image/jpeg' }),
                'synthetic.jpg',
              );
              const suffix = identity ? 'identity-images/FRONT' : 'documents/HEALTH_CERTIFICATE';
              const response = await fetch(
                `${origin}/sites/${siteId}/workers/${workerId}/${suffix}`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}` },
                  body: form,
                },
              );
              await response.arrayBuffer();
              const table = identity ? 'worker_identity_image' : 'worker_document';
              const [{ count }] = await db.query(
                `SELECT count(*)::int AS count FROM ${table} WHERE worker_id=$1`,
                [workerId],
              );
              assert.equal(readCalls, 1, 'actual OCR await was reached once');
              assert.equal(response.status, revoked ? 401 : 201);
              assert.equal(count, revoked ? 0 : 1, 'revoked request must not persist a row');
              assert.equal(
                (await readdir(storageRoot)).length,
                filesBefore + (revoked ? 0 : 1),
                'rejected request compensates only its newly stored object',
              );
              if (revoked) {
                const [{ count: auditCount }] = await db.query(
                  'SELECT count(*)::int AS count FROM audit_log WHERE entity_id=$1',
                  [workerId],
                );
                assert.equal(auditCount, 0, 'no upload audit side effect after session revocation');
              }
            },
          );
        }
      }
    } finally {
      await app?.close();
      await owned.dispose();
    }
  },
);
