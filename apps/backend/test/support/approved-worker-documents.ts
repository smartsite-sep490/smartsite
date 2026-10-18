import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import { WorkerDocumentEntity } from '../../src/database/entities/worker-document.entity.js';

/** Historical Safety approvals for operational fixtures; onboarding tests submit/review real files instead. */
export async function approvedWorkerDocuments(
  source: DataSource,
  workerIds: string[],
  reviewerId: string,
) {
  const repository = source.getRepository(WorkerDocumentEntity);
  for (const workerId of workerIds)
    for (const kind of ['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'] as const) {
      if (await repository.existsBy({ workerId, kind, status: 'APPROVED' })) continue;
      await repository.save({
        id: randomUUID(),
        workerId,
        kind,
        status: 'APPROVED',
        originalName: 'synthetic-approved.pdf',
        file: {
          storageProvider: 'LOCAL',
          storageKey: `${randomUUID()}.pdf`,
          sha256: 'a'.repeat(64),
          size: 1,
          mediaType: 'application/pdf',
        },
        ocr: { status: 'UNAVAILABLE', issuedOn: null, expiresOn: null, warnings: [] },
        issuedOn: '2000-01-01',
        expiresOn: '2099-01-01',
        uploadedBy: reviewerId,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: 'Synthetic historical approval',
        version: 2,
      });
    }
}
