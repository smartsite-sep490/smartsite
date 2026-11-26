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
    {} as DocumentNotificationsService,
    new DocumentAnalysisService(createTestConfig()),
  );
  return service;
}
test('Workers cannot save certificate drafts or write another Worker identity', async () => {
  const service = fixture();
  await assert.rejects(
    service.submit(
      actor,
      siteId,
      workerId,
      { requestId: randomUUID(), expectedVersion: 0, safetyCardRequired: true, documents: {} },
      {},
    ),
    (error) => error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
  await assert.rejects(
    service.updateOwnIdentity(
      { ...actor, roleAssignments: [] },
      siteId,
      {
        expectedVersion: 0,
        nationalId: '000000000001',
        phoneNumber: '0900000000',
        gender: 'OTHER',
        address: 'Synthetic address',
      },
      { FRONT: file },
    ),
    (error) => error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
});
test('unavailable authorization fails before file validation or storage', async () => {
  const service = fixture({ unavailable: true });
  await assert.rejects(
    service.submit(
      actor,
      siteId,
      workerId,
      { requestId: randomUUID(), expectedVersion: 0, safetyCardRequired: true, documents: {} },
      {},
    ),
    /Synthetic authorization unavailable/,
  );
});
