import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { healthCertificateExpiry } from '@smartsite/contracts';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import {
  ContractorEntity,
  ContractorRepresentativeGrantEntity,
  ContractorSiteParticipationEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  WorkerEntity,
} from '../../src/database/entities/index.js';
import { WorkerDocumentEntity } from '../../src/database/entities/worker-document.entity.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { AccountEmailService } from '../../src/modules/auth/account-email.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { WorkerOnboardingService } from '../../src/modules/workforce/directory/worker-onboarding.service.js';
import { DocumentAnalysisService } from '../../src/modules/workforce/documents/document-analysis.service.js';
import { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';
import {
  complianceDate,
  workerDocumentStatus,
} from '../../src/modules/workforce/documents/worker-compliance.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('intake drafts, concurrent batches, manual review and self-service identity use separate lifecycles', async () => {
  const database = createIsolatedTestDatabase();
  const root = await mkdtemp(join(tmpdir(), 'smartsite-intake-test-'));
  try {
    await database.initialize();
    const db = database.dataSource;
    const siteId = randomUUID(),
      contractorId = randomUUID(),
      otherContractor = randomUUID();
    await db.getRepository(SiteEntity).save({ id: siteId, code: siteId, name: 'Synthetic Site' });
    for (const id of [contractorId, otherContractor])
      await db.getRepository(ContractorEntity).save({ id, code: id, name: 'Synthetic Contractor' });
    const representative = {
      id: randomUUID(),
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
    };
    const safety = {
      ...representative,
      id: randomUUID(),
      roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
    };
    for (const actor of [representative, safety])
      await db.getRepository(UserEntity).save({
        id: actor.id,
        username: actor.id,
        displayName: 'Synthetic User',
        passwordHash: 'unused-synthetic',
        isActive: true,
      });
    await db.getRepository(ContractorRepresentativeGrantEntity).save({
      id: randomUUID(),
      userId: representative.id,
      contractorId,
    });
    await db.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      contractorId,
      siteId,
      validFrom: new Date(Date.now() - 10_000),
      isActive: true,
    });
    const config = createTestConfig({
      STORAGE_PROVIDER: 'LOCAL',
      STORAGE_LOCAL_ROOT: root,
      RESEND_API_KEY: 're_synthetic_intake_test',
      RESEND_FROM_EMAIL: 'test@example.invalid',
    });
    const storage = new StorageService(config);
    const operations = new ContractorOperationsService(db);
    const accounts = new ContractorWorkerAccountsService(
      db,
      operations,
      new UsersService(db, new SiteConfigurationService(db)),
      new AccountEmailService(db, config),
    );
    const intake = new WorkerOnboardingService(db, operations, accounts, storage);
    const docs = new WorkerDocumentsService(
      db,
      operations,
      storage,
      new DocumentNotificationsService(db, config),
      new DocumentAnalysisService(config),
    );
    const buffer = await sharp({
      create: { width: 64, height: 64, channels: 3, background: 'white' },
    })
      .png()
      .toBuffer();
    const image = {
      buffer,
      size: buffer.length,
      mimetype: 'image/png',
      originalname: 'synthetic.png',
    };
    const healthDate = complianceDate();
    const expiry = healthCertificateExpiry(healthDate)!;
    const id = randomUUID(),
      incompleteId = randomUUID();
    const base = {
      expectedVersion: 0,
      displayName: 'Synthetic Worker',
      username: 'syntheticworker',
      email: 'worker@example.invalid',
      safetyCardRequired: false,
      documents: { HEALTH_CERTIFICATE: {} },
    };
    const incomplete = await intake.save(
      representative,
      siteId,
      contractorId,
      incompleteId,
      {
        ...base,
        documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: healthDate } },
      },
      {},
    );
    assert.equal(incomplete.documents.HEALTH_CERTIFICATE?.submittedIssuedOn, healthDate);
    assert.equal(incomplete.documents.HEALTH_CERTIFICATE?.originalName, undefined);
    const draft = await intake.save(
      representative,
      siteId,
      contractorId,
      id,
      {
        ...base,
        documents: { ...base.documents, SAFETY_CARD: {} },
      },
      { HEALTH_CERTIFICATE: image, SAFETY_CARD: image },
    );
    assert.equal(draft.canProvision, false);
    assert.equal(await db.getRepository(WorkerEntity).countBy({ siteId }), 0);
    assert.deepEqual(
      (await intake.file(representative, siteId, contractorId, id, 'HEALTH_CERTIFICATE')).bytes,
      buffer,
    );
    await assert.rejects(
      intake.list(representative, siteId, otherContractor),
      (error) => error instanceof PublicHttpException && error.getStatus() === 403,
    );
    const ready = await intake.save(
      representative,
      siteId,
      contractorId,
      id,
      {
        ...base,
        expectedVersion: draft.version,
        documents: {
          HEALTH_CERTIFICATE: { submittedIssuedOn: healthDate },
          PERSONAL_INSURANCE: { submittedExpiresOn: expiry },
        },
      },
      { PERSONAL_INSURANCE: image },
    );
    assert.equal(ready.canProvision, true);
    const cleared = await intake.save(
      representative,
      siteId,
      contractorId,
      id,
      {
        ...base,
        expectedVersion: ready.version,
      },
      {},
    );
    assert.equal(cleared.canProvision, false);
    const restored = await intake.save(
      representative,
      siteId,
      contractorId,
      id,
      {
        ...base,
        expectedVersion: cleared.version,
        documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: healthDate } },
      },
      {},
    );
    const selection = {
      items: [
        { id, version: restored.version },
        { id: incompleteId, version: incomplete.version },
      ],
    };
    const repeated = await Promise.all([
      intake.provisionBatch(representative, siteId, contractorId, selection),
      intake.provisionBatch(representative, siteId, contractorId, selection),
    ]);
    for (const result of repeated)
      assert.deepEqual(
        result.items.map(({ status }) => status),
        ['SUCCEEDED', 'FAILED'],
      );
    const workerId = repeated[0].items[0]!.workerId!;
    assert.equal(repeated[1].items[0]!.workerId, workerId);
    const worker = await db.getRepository(WorkerEntity).findOneByOrFail({ id: workerId });
    const [outbox] = await db.query(
      'SELECT count(*)::int AS count FROM account_email_outbox WHERE user_id=$1',
      [worker.userId],
    );
    assert.equal(outbox.count, 1);
    assert.equal(
      await db.getRepository(WorkerDocumentEntity).countBy({ workerId, status: 'DRAFT' }),
      2,
    );
    assert.equal((await docs.get(safety, siteId, workerId)).documents.length, 0);
    const listed = (await intake.list(representative, siteId, contractorId)).items.find(
      (row) => row.id === id,
    )!;
    assert.equal(listed.canSubmit, true);
    const sending = { items: [{ id: workerId, version: listed.workerVersion! }] };
    for (let attempt = 0; attempt < 2; attempt++)
      assert.equal(
        (await docs.submitBatch(representative, siteId, contractorId, sending)).items[0]?.status,
        'SUCCEEDED',
      );
    const review = await docs.get(safety, siteId, workerId);
    assert.equal(review.nationalId, null);
    assert.equal(review.submissionStatus, 'PENDING_REVIEW');
    for (const doc of review.documents) {
      await docs.review(safety, siteId, workerId, doc.id, {
        approve: true,
        expectedVersion: doc.version,
        issuedOn: healthDate,
        expiresOn: expiry,
        reviewNote: '',
      });
    }
    assert.equal(await workerDocumentStatus(db.manager, workerId), 'ACTIVE');
    const owner = {
      id: worker.userId!,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.WORKER, siteId }],
    };
    await db.getRepository(WorkerEntity).update(workerId, { isActive: false });
    assert.equal((await docs.getOwn(owner, siteId)).workerId, workerId);
    await assert.rejects(docs.getOwn(representative, siteId), { status: 403 });
    const identity = {
      expectedVersion: 0,
      nationalId: '000000000001',
      gender: 'OTHER',
      address: 'Synthetic address',
      phoneNumber: '0900000000',
    };
    await assert.rejects(
      docs.updateOwnIdentity(representative, siteId, identity, { FRONT: image, BACK: image }),
      (error) => error instanceof PublicHttpException && error.getStatus() === 403,
    );
    assert.deepEqual(
      await docs.updateOwnIdentity(owner, siteId, identity, { FRONT: image, BACK: image }),
      { version: 1 },
    );
    assert.equal((await docs.get(safety, siteId, workerId)).identityImages.length, 2);
  } finally {
    await database.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
