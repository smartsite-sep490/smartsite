import { createTestConfig } from './support/config.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
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
import { DocumentAnalysisService } from '../src/modules/workforce/documents/document-analysis.service.js';

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
    new DocumentAnalysisService(createTestConfig()),
  );
  return { service, qualityCalls: () => qualityCalls };
}
test('Workers cannot submit, preflight or edit documents, including their own profile', async () => {
  const { service, qualityCalls } = fixture();
  for (const operation of [
    () => service.checkWorkerQuality(actor, siteId, workerId, file),
    () => service.checkSubmission(actor, siteId, workerId, 'SAFETY_CARD', file),
    () =>
      service.submit(
        actor,
        siteId,
        workerId,
        { requestId: randomUUID(), expectedVersion: 0, safetyCardRequired: true, documents: {} },
        {},
      ),
  ])
    await assert.rejects(
      operation,
      (e) => e instanceof PublicHttpException && e.publicPayload.code === 'FORBIDDEN',
    );
  assert.equal(qualityCalls(), 0);
});
test('unavailable authorization fails before OCR or storage', async () => {
  const { service, qualityCalls } = fixture({ unavailable: true });
  await assert.rejects(
    service.checkWorkerQuality(actor, siteId, workerId, file),
    /Synthetic authorization unavailable/,
  );
  assert.equal(qualityCalls(), 0);
});
