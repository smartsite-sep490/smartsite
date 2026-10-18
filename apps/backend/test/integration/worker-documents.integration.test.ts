import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import source from '../support/test-data-source.js';
import type { WorkerDocumentResponse } from '@smartsite/contracts';
import { healthCertificateExpiry } from '@smartsite/contracts';
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
  WorkerComplianceProfileEntity,
  UserNotificationEntity,
} from '../../src/database/entities/index.js';
import { StorageService } from '../../src/integrations/storage/storage.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/directory/contractor-operations.service.js';
import { ContractorWorkerAccountsService } from '../../src/modules/workforce/directory/contractor-worker-accounts.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import { DocumentOcrService } from '../../src/modules/workforce/documents/document-ocr.service.js';
import { LocalDocumentOcr } from '../../src/modules/workforce/documents/local-document-ocr.js';
import { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';
import {
  complianceDate,
  DOCUMENT_KINDS,
  workerDocumentsAllowEntry,
  requireWorkerDocuments,
} from '../../src/modules/workforce/documents/worker-compliance.js';
import { evaluateWorkerAccess } from '../../src/modules/workforce/access/worker-access-evaluation.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/notifications/scheduling-notification.service.js';
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
  const config = createTestConfig({ STORAGE_LOCAL_ROOT: root });
  const operations = new ContractorOperationsService(source);
  const notifications = new DocumentNotificationsService(source, config);
  const ocr = new DocumentOcrService(new LocalDocumentOcr(config));
  let blurry = false;
  ocr.quality = async () =>
    blurry
      ? { status: 'RETAKE', reason: 'IMAGE_BLURRY' }
      : { status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' };
  const service = new WorkerDocumentsService(
    source,
    operations,
    new StorageService(config),
    ocr,
    notifications,
  );
  const accounts = new ContractorWorkerAccountsService(
    source,
    operations,
    new UsersService(source, new SiteConfigurationService(source)),
  );
  let workerId = '';
  const today = complianceDate();
  const past = complianceDate(new Date(Date.now() - 86400000));
  const future = complianceDate(new Date(Date.now() + 10 * 86400000));
  const later = complianceDate(new Date(Date.now() + 365 * 86400000));
  const pdf = Buffer.from('%PDF-1.7\nSynthetic document only\n%%EOF');
  const file = {
    buffer: pdf,
    size: pdf.length,
    mimetype: 'application/pdf',
    originalname: 'synthetic.pdf',
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
    const worker = await source.getRepository(WorkerEntity).findOneByOrFail({ id: workerId });
    const workerActor = {
      id: result.account.id,
      mustChangePassword: false,
      roleAssignments: [{ role: UserRole.WORKER, siteId }],
    };
    await t.test(
      'new account saves private contact fields and stays pending with no entry',
      async () => {
        const profile = await service.get(rep, siteId, workerId);
        assert.equal(profile.nationalId, '000000000001');
        assert.equal(profile.phoneNumber, '0900000001');
        assert.equal(profile.status, 'PENDING');
        assert.equal(profile.submissionStatus, 'NOT_SUBMITTED');
        assert.equal(profile.needsSupplement, true);
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
        await assert.rejects(
          requireWorkerDocuments(source.manager, worker),
          /Worker documents must be approved/,
        );
        assert.equal(
          (await evaluateWorkerAccess(source.manager, worker, siteId, 'synthetic-gate', 'IN'))
            .decision.reasonCode,
          'WORKER_DOCUMENTS_INVALID',
        );
        assert.equal(
          (await evaluateWorkerAccess(source.manager, worker, siteId, 'synthetic-gate', 'OUT'))
            .decision.authorization,
          'ALLOWED',
        );
        await assert.rejects(
          service.get(
            { ...safety, roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: otherSite }] },
            siteId,
            workerId,
          ),
        );
        await assert.rejects(service.get({ ...workerActor, id: workerUserId }, siteId, workerId));
        assert.equal((await service.get(workerActor, siteId, workerId)).status, 'PENDING');
        const profileRow = await source
          .getRepository(WorkerComplianceProfileEntity)
          .findOneByOrFail({ workerId });
        assert.equal(profileRow.nationalId, '000000000001');
      },
    );
    await t.test(
      'blurred files are rejected before storage; both validated citizen ID sides are required',
      async () => {
        blurry = true;
        await assert.rejects(
          service.upload(rep, siteId, workerId, 'SAFETY_CARD', file),
          /IMAGE_BLURRY/,
        );
        assert.equal(await source.getRepository(WorkerDocumentEntity).countBy({ workerId }), 0);
        blurry = false;
        const originalRead = ocr.read.bind(ocr);
        ocr.read = async () => ({
          status: 'READ',
          issuedOn: null,
          expiresOn: null,
          warnings: [],
          nationalIds: ['000000000099'],
        });
        const bytes = Buffer.from([255, 216, 255, 1, 2, 3, 255, 217]);
        for (const side of ['FRONT', 'BACK'])
          await service.uploadIdentity(rep, siteId, workerId, side, {
            buffer: bytes,
            size: bytes.length,
            mimetype: 'image/jpeg',
            originalname: 'synthetic-id.jpg',
          });
        assert.equal((await service.get(safety, siteId, workerId)).identityImages.length, 2);
        const identity = (await service.get(safety, siteId, workerId)).identityImages[0]!;
        await assert.rejects(service.retryIdentityOcr(workerActor, siteId, workerId, identity.id));
        await service.retryIdentityOcr(safety, siteId, workerId, identity.id);
        for (const actor of [safety, workerActor])
          assert.equal(
            (await service.get(actor, siteId, workerId)).identityImages.every(
              (i) => i.identityCheck?.status === 'MISMATCH',
            ),
            true,
          );
        ocr.read = originalRead;
      },
    );
    const uploaded: WorkerDocumentResponse[] = [];
    for (const kind of DOCUMENT_KINDS)
      uploaded.push(
        await service.upload(
          rep,
          siteId,
          workerId,
          kind,
          file,
          kind === 'HEALTH_CERTIFICATE'
            ? { submittedIssuedOn: past }
            : { submittedExpiresOn: future },
        ),
      );
    await t.test(
      'OCR unavailable preserves files and pending review; replay does not create duplicates',
      async () => {
        assert.equal(uploaded[0]!.ocr.status, 'UNAVAILABLE');
        const submitted = await service.get(rep, siteId, workerId);
        assert.equal(submitted.submissionStatus, 'PENDING_REVIEW');
        assert.equal(submitted.needsSupplement, false);
        assert.equal(
          (
            await service.list(safety, siteId, 0, 20, {
              submissionStatus: 'PENDING_REVIEW',
              needsSupplement: false,
            })
          ).total,
          1,
        );
        const retry = await service.upload(rep, siteId, workerId, 'SAFETY_CARD', file);
        assert.equal(retry.id, uploaded[0]!.id);
        assert.equal(retry.submittedExpiresOn, future);
        assert.equal(retry.expiresOn, null);
        assert.equal(await source.getRepository(WorkerDocumentEntity).countBy({ workerId }), 3);
        assert.deepEqual(
          (await service.file(safety, siteId, workerId, uploaded[0]!.id)).bytes,
          pdf,
        );
        await assert.rejects(service.upload(workerActor, siteId, workerId, 'SAFETY_CARD', file));
        await assert.rejects(
          service.review(rep, siteId, workerId, uploaded[0]!.id, {
            expectedVersion: 1,
            approve: true,
            issuedOn: past,
            expiresOn: future,
            reviewNote: 'Synthetic review',
          }),
        );
      },
    );
    await t.test(
      'manual expiry remains an unapproved suggestion, is scoped/versioned and survives OCR retry',
      async () => {
        const doc = uploaded[0]!;
        const input = { expectedVersion: doc.version, submittedExpiresOn: later };
        for (const actor of [workerActor, safety])
          await assert.rejects(
            service.updateSubmittedExpiry(actor, siteId, workerId, doc.id, input),
          );
        await assert.rejects(
          service.updateSubmittedExpiry(rep, otherSite, workerId, doc.id, input),
        );
        await assert.rejects(
          service.updateSubmittedExpiry(rep, siteId, workerId, doc.id, {
            ...input,
            submittedExpiresOn: '2026-02-30',
          }),
        );
        await assert.rejects(
          service.upload(rep, siteId, workerId, 'HEALTH_CERTIFICATE', file, {
            submittedExpiresOn: '2026-02-30',
          }),
        );
        const updated = await service.updateSubmittedExpiry(rep, siteId, workerId, doc.id, input);
        assert.equal(updated.version, 2);
        assert.equal(updated.submittedExpiresOn, later);
        assert.equal(updated.expiresOn, null);
        assert.equal(updated.status, 'PENDING');
        await assert.rejects(
          service.updateSubmittedExpiry(rep, siteId, workerId, doc.id, input),
          /Document changed/,
        );
        await assert.rejects(
          service.review(safety, siteId, workerId, doc.id, {
            expectedVersion: 1,
            approve: true,
            issuedOn: past,
            expiresOn: later,
            reviewNote: 'Stale manual date',
          }),
          /Document changed/,
        );
        await service.retryOcr(safety, siteId, workerId, doc.id);
        const profile = await service.get(workerActor, siteId, workerId);
        assert.equal(profile.documents.find((d) => d.id === doc.id)!.submittedExpiresOn, later);
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
        const cleared = await service.updateSubmittedExpiry(rep, siteId, workerId, doc.id, {
          expectedVersion: updated.version,
          submittedExpiresOn: null,
        });
        assert.equal(cleared.submittedExpiresOn, null);
        const changed = await service.upload(rep, siteId, workerId, 'SAFETY_CARD', file, {
          submittedExpiresOn: future,
        });
        assert.equal(changed.id, doc.id);
        assert.equal(changed.version, cleared.version + 1);
        const retried = await service.upload(rep, siteId, workerId, 'SAFETY_CARD', file, {
          submittedExpiresOn: future,
        });
        assert.equal(retried.version, changed.version);
        uploaded[0] = retried;
      },
    );
    await t.test(
      'health dates derive one year from examination and cannot be overridden or activate before review',
      async () => {
        const health = uploaded.find((doc) => doc.kind === 'HEALTH_CERTIFICATE')!;
        assert.equal(health.submittedIssuedOn, past);
        assert.equal(health.submittedExpiresOn, healthCertificateExpiry(past));
        assert.equal(health.expiresOn, null);
        await assert.rejects(
          service.upload(rep, siteId, workerId, 'HEALTH_CERTIFICATE', file, {
            submittedExpiresOn: later,
          }),
          /examination date/,
        );
        await assert.rejects(
          service.updateSubmittedExpiry(rep, siteId, workerId, health.id, {
            expectedVersion: health.version,
            submittedExpiresOn: later,
          }),
          /examination date/,
        );
        await assert.rejects(
          service.review(safety, siteId, workerId, health.id, {
            expectedVersion: health.version,
            approve: true,
            issuedOn: past,
            expiresOn: future,
            reviewNote: 'Forged expiry',
          }),
          /one year/,
        );
        await assert.rejects(
          service.review(safety, siteId, workerId, health.id, {
            expectedVersion: health.version,
            approve: true,
            issuedOn: '2020-01-01',
            reviewNote: 'Expired health certificate',
          }),
        );
        const changed = await service.updateSubmittedExpiry(rep, siteId, workerId, health.id, {
          expectedVersion: health.version,
          submittedIssuedOn: today,
        });
        assert.equal(changed.submittedExpiresOn, healthCertificateExpiry(today));
        await service.retryOcr(safety, siteId, workerId, health.id);
        const retained = (await service.get(workerActor, siteId, workerId)).documents.find(
          (doc) => doc.id === health.id,
        )!;
        assert.equal(retained.submittedIssuedOn, today);
        assert.equal(retained.submittedExpiresOn, healthCertificateExpiry(today));
        uploaded[1] = await service.updateSubmittedExpiry(rep, siteId, workerId, health.id, {
          expectedVersion: changed.version,
          submittedIssuedOn: past,
        });
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
      },
    );
    await t.test(
      'mismatched citizen IDs remain submittable and visible to both Worker and Safety',
      async () => {
        const originalRead = ocr.read.bind(ocr);
        ocr.read = async () => ({
          status: 'READ',
          issuedOn: past,
          expiresOn: future,
          warnings: [],
          nationalIds: ['000000000099'],
        });
        const bytes = Buffer.from('%PDF-1.7\nSynthetic mismatched citizen ID\n%%EOF');
        uploaded[0] = await service.upload(rep, siteId, workerId, 'SAFETY_CARD', {
          ...file,
          buffer: bytes,
          size: bytes.length,
        });
        assert.equal(uploaded[0]!.status, 'PENDING');
        for (const actor of [workerActor, safety]) {
          const document = (await service.get(actor, siteId, workerId)).documents.find(
            (d) => d.id === uploaded[0]!.id,
          )!;
          assert.equal(document.identityCheck?.status, 'MISMATCH');
          assert.deepEqual(document.identityCheck?.detectedNationalIds, ['000000000099']);
        }
        ocr.read = originalRead;
      },
    );
    await t.test(
      'all three valid Safety approvals activate entry even with advisory ID mismatches',
      async () => {
        for (let i = 0; i < uploaded.length; i++) {
          const doc = uploaded[i]!;
          await service.review(safety, siteId, workerId, doc.id, {
            expectedVersion: doc.version,
            approve: true,
            issuedOn: past,
            ...(doc.kind === 'HEALTH_CERTIFICATE' ? {} : { expiresOn: future }),
            reviewNote: 'Original checked',
          });
          assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), i === 2);
        }
        assert.equal((await service.get(rep, siteId, workerId)).status, 'ACTIVE');
        assert.equal((await service.get(rep, siteId, workerId)).submissionStatus, 'REVIEWED');
        assert.equal((await service.get(rep, siteId, workerId)).needsSupplement, false);
        await assert.rejects(
          service.updateSubmittedExpiry(rep, siteId, workerId, uploaded[1]!.id, {
            expectedVersion: 2,
            submittedExpiresOn: later,
          }),
          /Document changed/,
        );
        assert.equal(
          (await service.get(rep, siteId, workerId)).documents.find(
            (d) => d.id === uploaded[1]!.id,
          )!.expiresOn,
          healthCertificateExpiry(past),
        );
        await requireWorkerDocuments(source.manager, worker);
        await assert.rejects(
          service.review(safety, siteId, workerId, uploaded[0]!.id, {
            expectedVersion: 1,
            approve: true,
            issuedOn: past,
            expiresOn: later,
            reviewNote: 'Stale review',
          }),
          /Document changed/,
        );
      },
    );
    await t.test(
      'queue search and pending filters apply globally before pagination, including legacy Workers',
      async () => {
        const extra = Array.from({ length: 25 }, (_, i) => ({
          id: randomUUID(),
          siteId,
          contractorId,
          userId: null,
          externalId: `QUEUE-${i}`,
          displayName: i === 24 ? 'OUTSIDE-PAGE' : 'Synthetic queued Worker',
          isActive: true,
          createdAt: new Date(i === 24 ? '2020-01-01' : '2026-01-01'),
        }));
        await source.getRepository(WorkerEntity).save(extra);
        const target = extra[24]!;
        assert.equal(
          (await service.list(safety, siteId, 0, 20)).items.some((w) => w.workerId === target.id),
          false,
        );
        const found = await service.list(safety, siteId, 0, 20, {
          search: 'OUTSIDE-PAGE',
          pendingOnly: true,
        });
        assert.equal(found.total, 1);
        assert.equal(found.items[0]!.workerId, target.id);
        assert.equal(found.items[0]!.status, 'PENDING');
        assert.equal(found.items[0]!.submissionStatus, 'NOT_SUBMITTED');
        assert.equal(found.items[0]!.needsSupplement, true);
        const unsubmitted = await service.list(safety, siteId, 0, 20, {
          submissionStatus: 'NOT_SUBMITTED',
          needsSupplement: true,
        });
        assert.equal(unsubmitted.total, 25);
        assert.equal(unsubmitted.items.length, 20);
        assert.ok(
          unsubmitted.items.every(
            (row) => row.submissionStatus === 'NOT_SUBMITTED' && row.needsSupplement,
          ),
        );
        const reviewed = await service.list(safety, siteId, 0, 20, {
          submissionStatus: 'REVIEWED',
          needsSupplement: false,
        });
        assert.equal(reviewed.total, 1);
        assert.equal(reviewed.items[0]!.workerId, workerId);
        assert.equal(
          (await service.list(safety, siteId, 0, 20, { submissionStatus: 'PENDING_REVIEW' })).total,
          0,
        );
        assert.equal(await workerDocumentsAllowEntry(source.manager, target.id), false);
        const pending = await service.list(rep, siteId, 0, 100, { pendingOnly: true });
        assert.equal(pending.total, 25);
        assert.equal(
          pending.items.some((w) => w.workerId === workerId),
          false,
        );
        await assert.rejects(
          service.list(
            { ...safety, roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId: otherSite }] },
            siteId,
            0,
            20,
          ),
        );
      },
    );
    await t.test(
      'expiry notices are durable and idempotent, visible to the scoped Worker and Representative',
      async () => {
        await notifications.sweep();
        await notifications.sweep();
        assert.equal(
          await source
            .getRepository(UserNotificationEntity)
            .countBy({ recipientUserId: result.account.id, event: 'DOCUMENT_EXPIRING' }),
          2,
        );
        const inbox = new SchedulingNotificationService(source);
        const list = await inbox.list(
          { ...result.account, roleAssignments: [{ role: UserRole.WORKER, siteId }] },
          'ALL',
          0,
          100,
        );
        assert.equal(
          list.items.some((n) => n.event === 'DOCUMENT_EXPIRING' && n.target.tab === 'documents'),
          true,
        );
      },
    );
    await t.test(
      'pending and rejected replacement never grant renewal; expiry blocks until replacement is approved',
      async () => {
        const replacement = await service.upload(rep, siteId, workerId, 'SAFETY_CARD', {
          ...file,
          buffer: Buffer.from('%PDF-1.7\nSynthetic replacement\n%%EOF'),
          size: Buffer.byteLength('%PDF-1.7\nSynthetic replacement\n%%EOF'),
        });
        assert.equal((await service.get(rep, siteId, workerId)).status, 'ACTIVE');
        const current = uploaded.find((d) => d.kind === 'SAFETY_CARD')!;
        await source
          .getRepository(WorkerDocumentEntity)
          .update(current.id, { issuedOn: past, expiresOn: past });
        assert.equal((await service.get(rep, siteId, workerId)).status, 'EXPIRED');
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
        await assert.rejects(
          requireWorkerDocuments(source.manager, worker),
          /Worker documents must be approved/,
        );
        await assert.rejects(
          service.review(safety, siteId, workerId, replacement.id, {
            expectedVersion: 1,
            approve: true,
            issuedOn: past,
            expiresOn: past,
            reviewNote: 'Expired upload',
          }),
        );
        await service.review(safety, siteId, workerId, replacement.id, {
          expectedVersion: 1,
          approve: false,
          reviewNote: 'Unreadable document',
        });
        const rejectedProfile = await service.get(rep, siteId, workerId);
        assert.equal(rejectedProfile.submissionStatus, 'REVIEWED');
        assert.equal(rejectedProfile.needsSupplement, true);
        assert.equal(
          (
            await service.list(safety, siteId, 0, 20, {
              search: worker.externalId,
              needsSupplement: true,
            })
          ).total,
          1,
        );
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), false);
        const next = await service.upload(rep, siteId, workerId, 'SAFETY_CARD', file);
        assert.equal((await service.get(rep, siteId, workerId)).submissionStatus, 'PENDING_REVIEW');
        assert.equal((await service.get(rep, siteId, workerId)).needsSupplement, false);
        const outcomes = await Promise.allSettled(
          [1, 2].map(() =>
            service.review(safety, siteId, workerId, next.id, {
              expectedVersion: 1,
              approve: true,
              issuedOn: today,
              expiresOn: later,
              reviewNote: 'Renewal checked',
            }),
          ),
        );
        assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
        assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1);
        assert.equal(await workerDocumentsAllowEntry(source.manager, workerId), true);
        assert.equal(
          (await source.getRepository(WorkerDocumentEntity).findOneByOrFail({ id: current.id }))
            .status,
          'SUPERSEDED',
        );
        await source.getRepository(WorkerEntity).update(workerId, { isActive: false });
        const inactive = await source.getRepository(WorkerEntity).findOneByOrFail({ id: workerId });
        assert.equal(
          (await evaluateWorkerAccess(source.manager, inactive, siteId, 'synthetic-gate', 'IN'))
            .decision.reasonCode,
          'WORKER_INACTIVE',
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
