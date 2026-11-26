import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import sharp from 'sharp';
import { healthCertificateExpiry } from '@smartsite/contracts';
import source from '../support/test-data-source.js';
import { createTestConfig } from '../support/config.js';
import { cleanupSiteAccess } from '../support/cleanup-site-access.js';
import {
  SiteEntity,
  ContractorEntity,
  ContractorRepresentativeGrantEntity,
  ContractorSiteParticipationEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  WorkerEntity,
  WorkerDocumentEntity,
  UserNotificationEntity,
} from '../../src/database/entities/index.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';
import { DocumentAnalysisService } from '../../src/modules/workforce/documents/document-analysis.service.js';
import {
  complianceDate,
  workerDocumentsAllowEntry,
} from '../../src/modules/workforce/documents/worker-compliance.js';
after(async () => {
  if (source.isInitialized) await source.destroy();
});
test('Worker document onboarding, scoped review, expiry and approval-only renewals', async (t) => {
  await source.initialize();
  const root = await mkdtemp(join(tmpdir(), 'smartsite-document-test-'));
  const siteId = randomUUID(),
    otherSite = randomUUID(),
    contractorId = randomUUID(),
    repId = randomUUID(),
    safetyId = randomUUID(),
    workerUserId = randomUUID();
  const ids: string[] = [repId, safetyId, workerUserId];
  const rep = {
    id: repId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
  };
  const safety = {
    id: safetyId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
  };
  const settings = { STORAGE_LOCAL_ROOT: root, OPENAI_API_KEY: 'synthetic-openai-key' };
  const config = createTestConfig(settings);
  const operations = new ContractorOperationsService(source);
  const notifications = new DocumentNotificationsService(source, config);
  const service = new WorkerDocumentsService(
    source,
    operations,
    new StorageService(config),
    notifications,
    new DocumentAnalysisService(config),
  );
  const accounts = new ContractorWorkerAccountsService(
    source,
    operations,
    new UsersService(source, new SiteConfigurationService(source)),
  );
  let workerId = '';
  const today = complianceDate();
  const future = complianceDate(new Date(Date.now() + 10 * 86400000));
  const later = complianceDate(new Date(Date.now() + 365 * 86400000));
  const jpeg = await sharp({ create: { width: 16, height: 12, channels: 3, background: 'white' } })
    .jpeg()
    .toBuffer();
  const openAi = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                detectedKind: 'HEALTH_CERTIFICATE',
                issuedOn: today,
                expiresOn: null,
              }),
            },
          ],
        },
      ],
    }),
  );
  const file = {
    buffer: jpeg,
    size: jpeg.length,
    mimetype: 'image/jpeg',
    originalname: 'synthetic.jpg',
  };
  try {
    for (const id of [siteId, otherSite])
      await source
        .getRepository(SiteEntity)
        .save({ id, code: id, name: 'Synthetic document Site' });
    await source.getRepository(ContractorEntity).save({
      id: contractorId,
      code: contractorId,
      name: 'Synthetic document Contractor',
      isActive: true,
    });
    for (const id of ids)
      await source.getRepository(UserEntity).save({
        id,
        username: id,
        displayName: 'Synthetic document user',
        passwordHash: 'synthetic-only',
        isActive: true,
        mustChangePassword: false,
      });
    for (const actor of [rep, safety])
      await source
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: actor.id, ...actor.roleAssignments[0] });
    await source
      .getRepository(ContractorRepresentativeGrantEntity)
      .save({ id: randomUUID(), userId: repId, contractorId });
    await source.getRepository(ContractorSiteParticipationEntity).save({
      id: randomUUID(),
      contractorId,
      siteId,
      isActive: true,
      validFrom: new Date(Date.now() - 3600000),
      validUntil: new Date(Date.now() + 400 * 86400000),
    });
    const result = await accounts.create(rep, contractorId, {
      siteId,
      username: `doc-${randomUUID().slice(0, 12)}`,
      displayName: 'Synthetic document Worker',
      nationalId: '000000000001',
      phoneNumber: '0900000001',
      gender: 'MALE',
      address: 'Synthetic address',
    });
    ids.push(result.account.id);
    workerId = result.worker.id;
    const workerActor = {
      id: result.account.id,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.WORKER, siteId }],
    };

    let submitted: import('@smartsite/contracts').WorkerDocumentSubmissionResponse;
    const base = {
      requestId: randomUUID(),
      expectedVersion: 1,
      safetyCardRequired: false,
      documents: {
        HEALTH_CERTIFICATE: { submittedIssuedOn: today },
        PERSONAL_INSURANCE: { submittedExpiresOn: future },
      },
    };
    const files = { HEALTH_CERTIFICATE: file, PERSONAL_INSURANCE: file };
    const batch = (version: number, workerIds = [workerId]) =>
      service.submitBatch(rep, siteId, contractorId, {
        items: workerIds.map((id) => ({ id, version })),
      });

    await t.test(
      'migration preserves existing requirements and exposes a profile version',
      async () => {
        const profile = await service.get(rep, siteId, workerId);
        assert.equal(profile.safetyCardRequired, true);
        assert.equal(profile.version, 1);
        assert.equal(profile.submissionStatus, 'NOT_SUBMITTED');
      },
    );
    await t.test('Worker certificate writes and cross-scope reads fail', async () => {
      await assert.rejects(service.submit(workerActor, siteId, workerId, base, files), {
        status: 403,
      });
      await assert.rejects(service.submit(rep, otherSite, workerId, base, files));
      await assert.rejects(
        service.submit({ ...rep, roleAssignments: [] }, siteId, workerId, base, files),
        { status: 403 },
      );
      await assert.rejects(
        service.get(
          { ...safety, roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: otherSite }] },
          siteId,
          workerId,
        ),
        { status: 403 },
      );
    });
    await t.test('invalid dates and metadata/file mismatch leave no partial state', async () => {
      for (const bad of [
        { ...base, documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-02-30' } } },
        { ...base, documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: today } } },
      ])
        await assert.rejects(service.submit(rep, siteId, workerId, bad, files));
      assert.equal(await source.getRepository(WorkerDocumentEntity).countBy({ workerId }), 0);
      assert.equal((await service.get(rep, siteId, workerId)).version, 1);
      assert.deepEqual(await readdir(root), []);
    });
    await t.test('drafts are private and never notify or enter the Safety queue', async () => {
      submitted = await service.submit(rep, siteId, workerId, base, files);
      assert.equal(submitted.version, 2);
      assert.equal(submitted.documentIds.length, 2);
      const profile = await service.get(rep, siteId, workerId);
      assert.equal(profile.safetyCardRequired, false);
      assert.equal(profile.canSubmit, true);
      assert.equal(profile.identityImages.length, 0);
      assert.equal(profile.submissionStatus, 'NOT_SUBMITTED');
      assert.ok(profile.documents.every((doc) => doc.status === 'DRAFT'));
      assert.equal(openAi.mock.callCount(), 0);
      assert.equal((await readdir(root)).length, 2);
      assert.equal((await service.list(safety, siteId, 0, 20, { pendingOnly: true })).total, 0);
      assert.deepEqual((await service.get(safety, siteId, workerId)).documents, []);
      assert.deepEqual((await service.get(workerActor, siteId, workerId)).documents, []);
      await assert.rejects(service.file(safety, siteId, workerId, submitted.documentIds[0]!), {
        status: 404,
      });
    });
    await t.test(
      'identical retry returns the original draft receipt without more files; changed payload conflicts',
      async () => {
        assert.deepEqual(await service.submit(rep, siteId, workerId, base, files), submitted);
        await assert.rejects(
          service.submit(rep, siteId, workerId, { ...base, safetyCardRequired: true }, files),
          { status: 409 },
        );
        await assert.rejects(
          service.submit(rep, siteId, workerId, { ...base, requestId: randomUUID() }, files),
          { status: 409 },
        );
        assert.equal((await readdir(root)).length, 2);
      },
    );
    await t.test('concurrent versioned commands have one winner', async () => {
      const input = { expectedVersion: 2, safetyCardRequired: false, documents: {} };
      const results = await Promise.allSettled([
        service.submit(rep, siteId, workerId, { ...input, requestId: randomUUID() }, {}),
        service.submit(rep, siteId, workerId, { ...input, requestId: randomUUID() }, {}),
      ]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await service.get(rep, siteId, workerId)).version, 3);
    });

    await t.test(
      'AI claims reject concurrent scans and an expired attempt cannot overwrite a retry',
      async () => {
        const health = (await service.get(rep, siteId, workerId)).documents.find(
          (doc) => doc.kind === 'HEALTH_CERTIFICATE',
        )!;
        let release!: () => void, started!: () => void;
        const begun = new Promise<void>((resolve) => {
          started = resolve;
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const analyze = t.mock.method(service['analysis'], 'analyze', async () => {
          started();
          await held;
          return {
            status: 'COMPLETE' as const,
            detectedKind: 'OTHER' as const,
            issuedOn: today,
            expiresOn: future,
          };
        });
        const first = service.analyzeDocument(rep, siteId, workerId, health.id);
        await begun;
        await assert.rejects(service.analyzeDocument(rep, siteId, workerId, health.id), {
          status: 409,
        });
        await source.query(
          "UPDATE worker_document SET ai_analysis=jsonb_set(ai_analysis,'{expiresAt}','0') WHERE id=$1",
          [health.id],
        );
        const expired = await service.get(rep, siteId, workerId);
        assert.equal(
          expired.documents.find((doc) => doc.id === health.id)?.aiAnalysis?.status,
          'UNAVAILABLE',
        );
        analyze.mock.restore();
        await service.analyzeDocument(rep, siteId, workerId, health.id);
        release();
        await assert.rejects(first, { status: 409 });
        const result = (await service.get(rep, siteId, workerId)).documents.find(
          (doc) => doc.id === health.id,
        )?.aiAnalysis;
        assert.equal(result?.status, 'COMPLETE');
        assert.equal(
          result?.status === 'COMPLETE' ? result.detectedKind : null,
          'HEALTH_CERTIFICATE',
        );
      },
    );
    await t.test(
      'only the scoped contractor representative can analyze, completed output is reused and remains advisory',
      async () => {
        const profile = await service.get(rep, siteId, workerId);
        const health = profile.documents.find((doc) => doc.kind === 'HEALTH_CERTIFICATE')!;
        for (const actor of [safety, workerActor])
          await assert.rejects(service.analyzeDocument(actor, siteId, workerId, health.id), {
            status: 403,
          });
        await service.analyzeDocument(rep, siteId, workerId, health.id);
        const count = openAi.mock.callCount();
        await service.analyzeDocument(rep, siteId, workerId, health.id);
        assert.equal(openAi.mock.callCount(), count);
        await source.query(
          'UPDATE worker_document SET ai_analysis=ai_analysis || $2::jsonb WHERE id=$1',
          [health.id, { nationalId: '000000000099' }],
        );
        const analyzed = (await service.get(rep, siteId, workerId)).documents.find(
          (doc) => doc.id === health.id,
        )!;
        assert.equal(analyzed.status, 'DRAFT');
        assert.equal(analyzed.aiAnalysis?.status, 'COMPLETE');
        assert.equal(Object.hasOwn(analyzed.aiAnalysis!, 'nationalId'), false);
        assert.equal(Object.hasOwn(analyzed.aiAnalysis!, 'identityCheck'), false);
        assert.equal((await service.get(safety, siteId, workerId)).aiSummary, undefined);
        assert.equal((await service.list(rep, siteId, 0, 20)).items[0]!.aiSummary?.complete, 1);
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
      },
    );
    await t.test(
      'editing only the date invalidates analysis and keeps the protected file',
      async () => {
        const profile = await service.get(rep, siteId, workerId);
        const health = profile.documents.find((doc) => doc.kind === 'HEALTH_CERTIFICATE')!;
        assert.equal(health.aiAnalysis?.status, 'COMPLETE');
        const edited = await service.submit(
          rep,
          siteId,
          workerId,
          {
            requestId: randomUUID(),
            expectedVersion: profile.version!,
            safetyCardRequired: false,
            documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2025-10-01' } },
          },
          {},
        );
        assert.notEqual(edited.documentIds[0], health.id);
        assert.equal((await readdir(root)).length, 2);
        assert.equal(
          (await service.get(rep, siteId, workerId)).documents.find(
            (d) => d.id === edited.documentIds[0],
          )!.aiAnalysis,
          undefined,
        );
        const fail = t.mock.method(service['analysis'], 'analyze', async () => null);
        await assert.rejects(
          service.analyzeDocument(rep, siteId, workerId, edited.documentIds[0]!),
          {
            status: 503,
          },
        );
        fail.mock.restore();
        const noticeFailure = t.mock.method(notifications, 'record', async () => {
          throw new Error('Synthetic notification failure');
        });
        assert.equal((await batch(edited.version)).items[0]!.status, 'FAILED');
        noticeFailure.mock.restore();
        assert.equal((await service.get(rep, siteId, workerId)).version, edited.version);
        assert.deepEqual((await service.get(safety, siteId, workerId)).documents, []);

        const [first, retry] = await Promise.all([
          batch(edited.version, [workerId, randomUUID()]),
          batch(edited.version),
        ]);
        assert.deepEqual(
          first.items.map((row) => row.status),
          ['SUCCEEDED', 'FAILED'],
        );
        assert.equal(retry.items[0]!.status, 'SUCCEEDED');
        assert.equal((await batch(edited.version)).items[0]!.status, 'SUCCEEDED');
        const queue = await service.list(safety, siteId, 0, 20, { pendingOnly: true });
        assert.equal(queue.total, 1);
        assert.equal(queue.items[0]!.documents.length, 2);
        assert.ok(
          queue.items[0]!.documents.every((doc) => doc.status === 'PENDING' && !doc.aiAnalysis),
        );
        assert.equal(
          await source.getRepository(UserNotificationEntity).countBy({
            recipientUserId: safetyId,
            siteId,
            event: 'DOCUMENT_SUBMITTED',
          }),
          2,
        );
      },
    );
    await t.test(
      'Safety rejection returns one document to the Representative with a reason',
      async () => {
        const doc = (await service.get(safety, siteId, workerId)).documents.find(
          (doc) => doc.kind === 'PERSONAL_INSURANCE',
        )!;
        await assert.rejects(
          service.review(safety, siteId, workerId, doc.id, {
            expectedVersion: doc.version,
            approve: false,
          }),
          { status: 400 },
        );
        await service.review(safety, siteId, workerId, doc.id, {
          expectedVersion: doc.version,
          approve: false,
          reviewNote: 'Synthetic replacement required',
        });
        const profile = await service.get(rep, siteId, workerId);
        assert.equal(profile.needsSupplement, true);
        assert.equal(
          profile.documents.find((item) => item.id === doc.id)?.reviewNote,
          'Synthetic replacement required',
        );
        assert.ok(
          await source
            .getRepository(UserNotificationEntity)
            .existsBy({ siteId, recipientUserId: repId, event: 'DOCUMENT_REJECTED' }),
        );
      },
    );
    await t.test('replacement preserves the rejected record and is visible to Safety', async () => {
      const profile = await service.get(rep, siteId, workerId);
      const result = await service.submit(
        rep,
        siteId,
        workerId,
        {
          requestId: randomUUID(),
          expectedVersion: profile.version!,
          safetyCardRequired: false,
          documents: {
            PERSONAL_INSURANCE: { submittedIssuedOn: today, submittedExpiresOn: later },
          },
        },
        { PERSONAL_INSURANCE: file },
      );
      assert.equal(result.documentIds.length, 1);
      assert.equal((await batch(result.version)).items[0]!.status, 'SUCCEEDED');
      const after = await service.get(safety, siteId, workerId);
      assert.equal(after.documents.filter((doc) => doc.kind === 'PERSONAL_INSURANCE').length, 2);
      assert.equal(after.documents.filter((doc) => doc.status === 'REJECTED').length, 1);
    });
    await t.test(
      'Safety can approve valid originals without AI; two required approvals allow entry',
      async () => {
        for (const doc of (await service.get(safety, siteId, workerId)).documents.filter(
          (doc) => doc.status === 'PENDING',
        )) {
          const approved = await service.review(safety, siteId, workerId, doc.id, {
            expectedVersion: doc.version,
            approve: true,
            ...(doc.kind === 'HEALTH_CERTIFICATE' ? { issuedOn: today } : {}),
          });
          assert.equal(approved.issuedOn, today);
          assert.equal(
            approved.expiresOn,
            doc.kind === 'HEALTH_CERTIFICATE' ? healthCertificateExpiry(today) : later,
          );
          assert.equal(approved.reviewNote, null);
        }
        assert.equal((await service.get(safety, siteId, workerId)).identityImages.length, 0);
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), true);
        const profile = await service.get(rep, siteId, workerId);
        assert.equal(profile.status, 'ACTIVE');
        assert.equal(profile.needsSupplement, false);
      },
    );
    await t.test('renewal never replaces the approved original until Safety approval', async () => {
      const profile = await service.get(rep, siteId, workerId);
      const old = profile.documents.find(
        (doc) => doc.kind === 'PERSONAL_INSURANCE' && doc.status === 'APPROVED',
      )!;
      const next = await service.submit(
        rep,
        siteId,
        workerId,
        {
          requestId: randomUUID(),
          expectedVersion: profile.version!,
          safetyCardRequired: false,
          documents: { PERSONAL_INSURANCE: { submittedExpiresOn: future } },
        },
        { PERSONAL_INSURANCE: file },
      );
      assert.equal(
        (await source.getRepository(WorkerDocumentEntity).findOneByOrFail({ id: old.id })).status,
        'APPROVED',
      );
      assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), true);
      assert.equal((await batch(next.version)).items[0]!.status, 'SUCCEEDED');
      const doc = (await service.get(safety, siteId, workerId)).documents.find(
        (item) => item.id === next.documentIds[0],
      )!;
      await service.review(safety, siteId, workerId, doc.id, {
        expectedVersion: doc.version,
        approve: false,
        reviewNote: 'Synthetic rejected renewal',
      });
      assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), true);
    });
    await t.test(
      'declaring the safety card required updates all eligibility and supplement reads',
      async () => {
        const profile = await service.get(rep, siteId, workerId);
        const request = {
          requestId: randomUUID(),
          expectedVersion: profile.version!,
          safetyCardRequired: true,
          documents: { SAFETY_CARD: { submittedExpiresOn: later } },
        };
        const draft = await service.submit(rep, siteId, workerId, request, { SAFETY_CARD: file });
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), true);
        assert.equal((await batch(draft.version)).items[0]!.status, 'SUCCEEDED');
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
        assert.ok((await service.get(rep, siteId, workerId)).missingKinds.includes('SAFETY_CARD'));
        assert.equal((await service.list(safety, siteId, 0, 20, { pendingOnly: true })).total, 1);
      },
    );

    await t.test(
      'concurrent Safety decisions have one winner and one notification per recipient',
      async () => {
        const doc = (await service.get(safety, siteId, workerId)).documents.find(
          (doc) => doc.kind === 'SAFETY_CARD' && doc.status === 'PENDING',
        )!;
        const input = {
          expectedVersion: doc.version,
          approve: true,
          issuedOn: today,
          expiresOn: later,
          reviewNote: 'Synthetic reviewed card',
        };
        const results = await Promise.allSettled([
          service.review(safety, siteId, workerId, doc.id, input),
          service.review(safety, siteId, workerId, doc.id, input),
        ]);
        assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
        assert.equal(
          results.filter((item) => item.status === 'rejected' && item.reason?.status === 409)
            .length,
          1,
        );
        assert.equal(
          await source
            .getRepository(UserNotificationEntity)
            .countBy({ requestId: doc.id, recipientUserId: repId, event: 'DOCUMENT_APPROVED' }),
          1,
        );
      },
    );
    await t.test(
      'expiry reminders are durable, scoped and skip an optional safety card',
      async () => {
        const current = await service.get(rep, siteId, workerId);
        const draft = await service.submit(
          rep,
          siteId,
          workerId,
          {
            requestId: randomUUID(),
            expectedVersion: current.version!,
            safetyCardRequired: false,
            documents: { PERSONAL_INSURANCE: { submittedExpiresOn: later } },
          },
          { PERSONAL_INSURANCE: file },
        );
        assert.equal((await batch(draft.version)).items[0]!.status, 'SUCCEEDED');
        const health = current.documents.find(
          (doc) => doc.kind === 'HEALTH_CERTIFICATE' && doc.status === 'APPROVED',
        )!;
        const at = new Date(health.expiresOn! + 'T00:00:00Z');
        await notifications.sweep(at);
        await notifications.sweep(at);
        const repository = source.getRepository(UserNotificationEntity);
        assert.equal(
          await repository.countBy({
            requestId: health.id,
            recipientUserId: repId,
            event: 'DOCUMENT_EXPIRING',
          }),
          1,
        );
        const card = current.documents.find(
          (doc) => doc.kind === 'SAFETY_CARD' && doc.status === 'APPROVED',
        )!;
        assert.equal(
          await repository.countBy({ requestId: card.id, event: 'DOCUMENT_EXPIRING' }),
          0,
        );
        const expired = new Date(at.getTime() + 86400000);
        await notifications.sweep(expired);
        await notifications.sweep(expired);
        assert.equal(
          await repository.countBy({
            requestId: health.id,
            recipientUserId: repId,
            event: 'DOCUMENT_EXPIRED',
          }),
          1,
        );
        assert.equal(await repository.countBy({ siteId: otherSite }), 0);
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId, expired), false);
      },
    );
    await t.test(
      'versioned identity corrections are audited and preserve approved certificate history',
      async () => {
        const profile = await service.get(rep, siteId, workerId);
        const before = profile.documents
          .filter((doc) => doc.status === 'APPROVED')
          .map((doc) => doc.id);
        const input = {
          expectedVersion: profile.identityVersion!,
          nationalId: '000000000099',
          phoneNumber: '0900000009',
          gender: 'FEMALE',
          address: 'Synthetic corrected address',
        };
        for (const other of [rep, safety])
          await assert.rejects(
            service.updateOwnIdentity(other, siteId, input, { FRONT: file, BACK: file }),
            { status: 403 },
          );
        await assert.rejects(
          service.updateOwnIdentity(workerActor, siteId, input, { FRONT: file }),
        );
        const receipt = await service.updateOwnIdentity(workerActor, siteId, input, {
          FRONT: file,
          BACK: file,
        });
        assert.equal(receipt.version, profile.identityVersion! + 1);
        await assert.rejects(service.updateOwnIdentity(workerActor, siteId, input, {}), {
          status: 409,
        });
        const updated = await service.get(rep, siteId, workerId);
        assert.equal(updated.nationalId, '000000000099');
        assert.equal(updated.version, profile.version);
        assert.equal(updated.identityImages.length, 2);
        assert.deepEqual(
          updated.documents.filter((doc) => doc.status === 'APPROVED').map((doc) => doc.id),
          before,
        );
      },
    );
  } finally {
    await cleanupSiteAccess(source, [siteId, otherSite]);
    await source.getRepository(WorkerEntity).delete({ siteId });
    await source.getRepository(ContractorRepresentativeGrantEntity).delete({ contractorId });
    await source.getRepository(ContractorSiteParticipationEntity).delete({ siteId });
    await source.getRepository(ContractorEntity).delete(contractorId);
    await source.getRepository(UserRoleAssignmentEntity).delete({ siteId });
    for (const id of [siteId, otherSite]) await source.getRepository(SiteEntity).delete(id);
    for (const id of ids) await source.getRepository(UserEntity).delete(id);
    assert.ok(root.startsWith(join(tmpdir(), 'smartsite-document-test-')));
    await rm(root, { recursive: true, force: true });
  }
});
