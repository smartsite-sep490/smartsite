import './support/config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import type { UploadWorkerDocumentCommand } from '@smartsite/contracts';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import {
  WorkerEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
} from '../src/database/entities/index.js';
import { WorkerDocumentsService } from '../src/modules/workforce/documents/worker-documents.service.js';
import type { ContractorOperationsService } from '../src/modules/workforce/directory/contractor-operations.service.js';
import type { StorageService } from '../src/integrations/storage/storage.service.js';
import type { DocumentOcrService } from '../src/modules/workforce/documents/document-ocr.service.js';
import type { DocumentNotificationsService } from '../src/modules/workforce/documents/document-notifications.service.js';

const siteId = randomUUID(),
  workerId = randomUUID(),
  userId = randomUUID();
const actor = {
  id: userId,
  mustChangePassword: false,
  roleAssignments: [{ role: UserRole.WORKER, siteId }],
};
const buffer = Buffer.from([255, 216, 255, 1, 255, 217]);
const file = { buffer, size: buffer.length, mimetype: 'image/jpeg' };
function fixture(
  options: { active?: boolean; role?: boolean; owner?: string; unavailable?: boolean } = {},
) {
  let qualityCalls = 0;
  const source = {
    manager: {
      getRepository(entity: unknown) {
        if (options.unavailable) throw new Error('Synthetic authorization unavailable');
        if (entity === WorkerEntity)
          return {
            findOne: async ({ where }: { where: { siteId: string } }) =>
              where.siteId === siteId
                ? {
                    id: workerId,
                    siteId,
                    userId: options.owner ?? userId,
                    contractorId: randomUUID(),
                    isActive: false,
                  }
                : null,
          };
        if (entity === UserEntity)
          return { findOneBy: async () => (options.active === false ? null : { id: userId }) };
        if (entity === UserRoleAssignmentEntity)
          return { existsBy: async () => options.role !== false };
        throw new Error('Unexpected authorization repository');
      },
    },
  } as unknown as DataSource;
  const service = new WorkerDocumentsService(
    source,
    {
      requireWorkerCreationAccess: async () => {
        throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
      },
    } as unknown as ContractorOperationsService,
    {} as StorageService,
    {
      quality: async () => {
        qualityCalls++;
        return { status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' };
      },
      read: async () => ({
        status: 'READ',
        issuedOn: '2026-10-27',
        expiresOn: '2030-10-27',
        warnings: [],
      }),
    } as unknown as DocumentOcrService,
    {} as DocumentNotificationsService,
  );
  return { service, qualityCalls: () => qualityCalls };
}
test('an authenticated Worker can check a renewal image even while their Worker is suspended', async () => {
  const { service, qualityCalls } = fixture();
  assert.deepEqual(await service.checkWorkerQuality(actor, siteId, workerId, file), {
    status: 'ACCEPTED',
    reason: 'IMAGE_ACCEPTED',
  });
  assert.equal(qualityCalls(), 1);
});
test('Worker submission denies other owners, revoked accounts/roles, cross-site and missing scope before OCR', async () => {
  for (const options of [{ owner: randomUUID() }, { active: false }, { role: false }]) {
    const { service, qualityCalls } = fixture(options);
    await assert.rejects(
      service.checkWorkerQuality(actor, siteId, workerId, file),
      (e: unknown) => e instanceof PublicHttpException && e.publicPayload.code === 'FORBIDDEN',
    );
    assert.equal(qualityCalls(), 0);
  }
  const { service, qualityCalls } = fixture();
  await assert.rejects(service.checkWorkerQuality(actor, randomUUID(), workerId, file));
  await assert.rejects(
    service.checkWorkerQuality({ ...actor, roleAssignments: [] }, siteId, workerId, file),
  );
  assert.equal(qualityCalls(), 0);
});
test('unavailable authorization and malformed renewal images never reach OCR', async () => {
  const unavailable = fixture({ unavailable: true });
  await assert.rejects(
    unavailable.service.checkWorkerQuality(actor, siteId, workerId, file),
    /Synthetic authorization unavailable/,
  );
  assert.equal(unavailable.qualityCalls(), 0);
  const valid = fixture();
  await assert.rejects(
    valid.service.checkWorkerQuality(actor, siteId, workerId, { ...file, size: 0 }),
  );
  assert.equal(valid.qualityCalls(), 0);
});

test('Workers must declare a real date before final upload, while OCR preflight accepts no date', async () => {
  const { service, qualityCalls } = fixture();
  for (const input of [{}, { submittedExpiresOn: null }, { submittedExpiresOn: '2030-02-30' }]) {
    await assert.rejects(
      service.upload(
        actor,
        siteId,
        workerId,
        'SAFETY_CARD',
        file,
        input as UploadWorkerDocumentCommand,
      ),
    );
  }
  assert.equal(qualityCalls(), 0);
  const preview = await service.checkSubmission(actor, siteId, workerId, 'SAFETY_CARD', file);
  assert.equal(preview.dateCheck.status, 'NO_REFERENCE');
  assert.equal(preview.dateCheck.detectedDate, '2030-10-27');
  await assert.rejects(
    service.checkSubmission(actor, siteId, workerId, 'SAFETY_CARD', file, {
      submittedExpiresOn: '2030-02-30',
    }),
  );
});

test('preflight checks dates without storage or persistence and enforces current owner/account/scope', async () => {
  const { service } = fixture();
  const result = await service.checkSubmission(actor, siteId, workerId, 'SAFETY_CARD', file, {
    submittedExpiresOn: '2030-10-27',
  });
  assert.equal(result.dateCheck.status, 'MATCH');
  assert.equal(
    (
      await service.checkSubmission(actor, siteId, workerId, 'HEALTH_CERTIFICATE', file, {
        submittedIssuedOn: '2026-10-28',
      })
    ).dateCheck.status,
    'MISMATCH',
  );
  for (const options of [
    { owner: randomUUID() },
    { active: false },
    { role: false },
    { unavailable: true },
  ]) {
    const denied = fixture(options);
    await assert.rejects(
      denied.service.checkSubmission(actor, siteId, workerId, 'SAFETY_CARD', file, {
        submittedExpiresOn: '2030-10-27',
      }),
    );
    assert.equal(denied.qualityCalls(), 0);
  }
  await assert.rejects(
    service.checkSubmission(actor, randomUUID(), workerId, 'SAFETY_CARD', file, {
      submittedExpiresOn: '2030-10-27',
    }),
  );
  await assert.rejects(
    service.checkSubmission(
      { ...actor, roleAssignments: [] },
      siteId,
      workerId,
      'SAFETY_CARD',
      file,
      { submittedExpiresOn: '2030-10-27' },
    ),
  );
});
