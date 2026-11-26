import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import type {
  WorkerDocumentKind,
  WorkerOnboardingBatchItem,
  WorkerOnboardingBatchResult,
  WorkerOnboardingDraft,
} from '@smartsite/contracts';
import { conflict, invalid, missing, uuid } from '../../../common/configuration/commands.js';
import {
  executeMainConfigurationCommand,
  executeMainMetadataMutation,
  type MainConfigurationCommandContext,
} from '../../../common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import {
  WorkerComplianceProfileEntity,
  WorkerDocumentEntity,
} from '../../../database/entities/worker-document.entity.js';
import {
  WorkerOnboardingDraftEntity,
  type IntakeAttachment,
} from '../../../database/entities/worker-onboarding-draft.entity.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import {
  StorageService,
  type StoredObject,
} from '../../../integrations/storage/storage.service.js';
import { documentDraftMissingKinds, DOCUMENT_KINDS } from '../documents/worker-compliance.js';
import { parseWorkerDocumentBatch } from '../documents/worker-document-submission.js';
import {
  documentOriginalName,
  validateWorkerDocument,
  validateWorkerDocumentFile,
  type DocumentUpload,
} from '../documents/worker-document-file.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from './contractor-operations.service.js';
import { ContractorWorkerAccountsService } from './contractor-worker-accounts.service.js';
import {
  intakeHasAccountDetails,
  missingIntakeDocuments,
  parseIntakeDraft,
} from './worker-intake-policy.js';

type DocumentFiles = Partial<Record<WorkerDocumentKind, DocumentUpload>>;

function describeDraft(
  row: WorkerOnboardingDraftEntity,
  worker?: WorkerEntity,
  profile?: WorkerComplianceProfileEntity,
  documents: WorkerDocumentEntity[] = [],
): WorkerOnboardingDraft {
  const { id, version, displayName, username, email, language, safetyCardRequired } = row;
  const attachments: WorkerOnboardingDraft['documents'] = {};
  const missingKinds = worker
    ? documentDraftMissingKinds(
        documents,
        profile?.draftSafetyCardRequired ?? profile?.safetyCardRequired ?? true,
      )
    : missingIntakeDocuments(row.documents, safetyCardRequired);
  const submitted = documents.filter((doc) => doc.status !== 'DRAFT');
  for (const kind of DOCUMENT_KINDS) {
    const draftFile = row.documents[kind];
    const doc = documents.find((item) => item.kind === kind && item.status !== 'SUPERSEDED');
    if (draftFile) {
      const { file, ...metadata } = draftFile;
      attachments[kind] = {
        ...metadata,
        mediaType: file?.mediaType as NonNullable<
          WorkerOnboardingDraft['documents'][WorkerDocumentKind]
        >['mediaType'],
      };
    } else if (doc) {
      attachments[kind] = {
        originalName: doc.originalName,
        mediaType: doc.file.mediaType as NonNullable<
          WorkerOnboardingDraft['documents'][WorkerDocumentKind]
        >['mediaType'],
        submittedIssuedOn: doc.submittedIssuedOn ?? undefined,
        submittedExpiresOn: doc.submittedExpiresOn ?? undefined,
      };
    }
  }
  return {
    id,
    version,
    displayName: worker?.displayName ?? displayName,
    username,
    email,
    language,
    safetyCardRequired:
      profile?.draftSafetyCardRequired ?? profile?.safetyCardRequired ?? safetyCardRequired,
    documents: attachments,
    workerId: row.workerId,
    workerCode: worker?.externalId ?? null,
    workerVersion: profile?.version ?? null,
    canProvision: !row.workerId && !missingKinds.length && intakeHasAccountDetails(row),
    canSubmit: !!worker && !missingKinds.length && documents.some((doc) => doc.status === 'DRAFT'),
    missingKinds,
    submissionStatus: submitted.some((doc) => doc.status === 'PENDING')
      ? 'PENDING_REVIEW'
      : submitted.length
        ? 'REVIEWED'
        : 'NOT_SUBMITTED',
  };
}

@Injectable()
export class WorkerOnboardingService {
  constructor(
    private readonly source: DataSource,
    private readonly operations: ContractorOperationsService,
    private readonly accounts: ContractorWorkerAccountsService,
    private readonly storage: StorageService,
  ) {}

  async list(actor: WorkforceActor, siteIdValue: string, contractorIdValue: string) {
    const siteId = uuid(siteIdValue);
    const contractorId = uuid(contractorIdValue);
    return this.source.transaction(async (manager) => {
      await this.operations.requireWorkerCreationAccess(manager, actor, contractorId, siteId);
      const rows = await manager.getRepository(WorkerOnboardingDraftEntity).find({
        where: { siteId, contractorId },
        order: { updatedAt: 'DESC', id: 'ASC' },
      });
      const ids = rows.flatMap((row) => (row.workerId ? [row.workerId] : []));
      if (!ids.length) return { items: rows.map((row) => describeDraft(row)) };
      const workers = await manager
        .getRepository(WorkerEntity)
        .findBy({ id: In(ids), siteId, contractorId });
      const workerById = new Map(workers.map((worker) => [worker.id, worker]));
      const scopedIds = workers.map((worker) => worker.id);
      const profiles = await manager
        .getRepository(WorkerComplianceProfileEntity)
        .findBy({ workerId: In(scopedIds) });
      const profileById = new Map(profiles.map((profile) => [profile.workerId, profile]));
      const documents = await manager
        .getRepository(WorkerDocumentEntity)
        .createQueryBuilder('doc')
        .addSelect('doc.file')
        .where({
          workerId: In(scopedIds),
          status: In(['DRAFT', 'PENDING', 'APPROVED', 'REJECTED']),
        })
        .orderBy("CASE doc.status WHEN 'DRAFT' THEN 0 WHEN 'PENDING' THEN 1 ELSE 2 END", 'ASC')
        .addOrderBy('doc.uploadedAt', 'DESC')
        .addOrderBy('doc.id', 'DESC')
        .getMany();
      const documentsByWorker = new Map<string, WorkerDocumentEntity[]>();
      for (const doc of documents) {
        if (!documentsByWorker.has(doc.workerId)) documentsByWorker.set(doc.workerId, []);
        documentsByWorker.get(doc.workerId)!.push(doc);
      }
      return {
        items: rows.map((row) =>
          row.workerId
            ? describeDraft(
                row,
                workerById.get(row.workerId),
                profileById.get(row.workerId),
                documentsByWorker.get(row.workerId),
              )
            : describeDraft(row),
        ),
      };
    });
  }

  async save(
    actor: WorkforceActor,
    siteIdValue: string,
    contractorIdValue: string,
    idValue: string,
    input: unknown,
    files: DocumentFiles,
    context?: MainConfigurationCommandContext,
  ) {
    const siteId = uuid(siteIdValue);
    const contractorId = uuid(contractorIdValue);
    const id = uuid(idValue);
    const value = parseIntakeDraft(input);
    await this.source.transaction((manager) =>
      this.operations.requireWorkerCreationAccess(manager, actor, contractorId, siteId),
    );
    const staged: Partial<Record<WorkerDocumentKind, IntakeAttachment>> = {};
    let saved = false;
    const replaced: StoredObject[] = [];
    try {
      for (const kind of DOCUMENT_KINDS) {
        const file = files[kind];
        if (!file) continue;
        if (!value.documents[kind]) invalid('Missing attachment details');
        const { mediaType, extension } = validateWorkerDocument(file);
        await validateWorkerDocumentFile(file.buffer, mediaType);
        staged[kind] = {
          ...value.documents[kind],
          originalName: documentOriginalName(file, kind),
          file: await this.storage.save(file.buffer, mediaType, extension),
        };
      }
      const row = await executeMainMetadataMutation(
        this.source,
        context,
        async (manager) => {
          await this.operations.requireWorkerCreationAccess(
            manager,
            actor,
            contractorId,
            siteId,
            true,
          );
          const repo = manager.getRepository(WorkerOnboardingDraftEntity);
          const where = { id, siteId, contractorId };
          const existing = await repo.findOne({ where, lock: { mode: 'pessimistic_write' } });
          if (existing?.workerId || (existing?.version ?? 0) !== value.expectedVersion)
            conflict('Worker intake changed. Reload before editing.');
          const documents = { ...existing?.documents };
          for (const kind of DOCUMENT_KINDS) {
            const old = documents[kind];
            const next = staged[kind];
            const metadata = value.documents[kind];
            if (next) {
              documents[kind] = next;
              if (old?.file) replaced.push(old.file);
            } else if (metadata) {
              documents[kind] = {
                ...metadata,
                ...(old?.file && { file: old.file, originalName: old.originalName }),
              };
            }
          }
          const next = {
            ...where,
            displayName: value.displayName,
            username: value.username,
            email: value.email,
            safetyCardRequired: value.safetyCardRequired,
            language: value.language ?? existing?.language ?? 'vi',
            workerId: null,
            version: value.expectedVersion + 1,
            documents,
          };
          if (existing) {
            await repo.update(where, next);
          } else {
            // Client-generated IDs also prevent accidental ownership transfer on a duplicate insert.
            const inserted = await repo
              .createQueryBuilder()
              .insert()
              .values(next)
              .orIgnore()
              .returning('id')
              .execute();
            if (!inserted.raw.length) conflict('Worker intake changed. Reload before editing.');
          }
          return repo.findOneByOrFail(where);
        },
        this.accounts.commandAuthorization(context, actor, siteId, contractorId),
      );
      saved = true;
      return describeDraft(row);
    } finally {
      const unused = saved
        ? replaced
        : Object.values(staged).flatMap(({ file }) => (file ? [file] : []));
      await Promise.all(unused.map((file) => this.storage.remove(file)));
    }
  }

  async file(
    actor: WorkforceActor,
    siteIdValue: string,
    contractorIdValue: string,
    idValue: string,
    kind: string,
  ) {
    const siteId = uuid(siteIdValue);
    const contractorId = uuid(contractorIdValue);
    const id = uuid(idValue);
    if (!DOCUMENT_KINDS.includes(kind as WorkerDocumentKind)) invalid();
    const ref = await this.source.transaction(async (manager) => {
      await this.operations.requireWorkerCreationAccess(manager, actor, contractorId, siteId);
      const row = await manager
        .getRepository(WorkerOnboardingDraftEntity)
        .findOneBy({ id, siteId, contractorId });
      const attachment = row?.documents[kind as WorkerDocumentKind]?.file;
      if (!attachment) missing();
      return attachment;
    });
    return { bytes: await this.storage.read(ref), mediaType: ref.mediaType };
  }

  async provisionBatch(
    actor: WorkforceActor,
    siteIdValue: string,
    contractorIdValue: string,
    input: unknown,
    context?: MainConfigurationCommandContext,
  ) {
    const siteId = uuid(siteIdValue);
    const contractorId = uuid(contractorIdValue);
    const selected = parseWorkerDocumentBatch(input);
    await this.source.transaction((manager) =>
      this.operations.requireWorkerCreationAccess(manager, actor, contractorId, siteId),
    );
    const items: WorkerOnboardingBatchResult[] = [];
    for (const item of selected) {
      try {
        const workerId = await this.provisionOne(actor, siteId, contractorId, item, context);
        items.push({ id: item.id, status: 'SUCCEEDED', workerId });
      } catch (error) {
        const detail =
          error instanceof PublicHttpException
            ? { code: error.publicPayload.code, message: error.publicPayload.message }
            : { code: 'INTERNAL_SERVER_ERROR', message: 'Unable to create worker account. Retry.' };
        items.push({ id: item.id, status: 'FAILED', error: detail });
      }
    }
    return { items };
  }

  private async provisionOne(
    actor: WorkforceActor,
    siteId: string,
    contractorId: string,
    item: WorkerOnboardingBatchItem,
    context?: MainConfigurationCommandContext,
  ) {
    const where = { id: item.id, siteId, contractorId };
    const original = await this.source.transaction(async (manager) => {
      await this.operations.requireWorkerCreationAccess(manager, actor, contractorId, siteId);
      return manager.getRepository(WorkerOnboardingDraftEntity).findOneBy(where);
    });
    if (!original) missing();
    if (original.workerId && original.version === item.version + 1) return original.workerId;
    if (original.version !== item.version || original.workerId)
      conflict('Worker intake changed. Reload before creating.');
    if (
      !intakeHasAccountDetails(original) ||
      missingIntakeDocuments(original.documents, original.safetyCardRequired).length
    )
      invalid('Complete the account details and required certificates before creating.');
    const account = {
      siteId,
      displayName: original.displayName,
      username: original.username,
      email: original.email,
      language: original.language,
    };
    const prepared = await this.accounts.prepareLinkedAccount(account);
    try {
      const result = await executeMainConfigurationCommand(
        this.source,
        context,
        'USER_CONTRACTOR_WORKER_ACCOUNT_CREATE',
        { siteId, contractorId, draftId: item.id, version: item.version },
        async (manager) => {
          await this.operations.requireWorkerCreationAccess(
            manager,
            actor,
            contractorId,
            siteId,
            true,
          );
          const repo = manager.getRepository(WorkerOnboardingDraftEntity);
          const row = await repo.findOne({ where, lock: { mode: 'pessimistic_write' } });
          if (!row) missing();
          if (row.workerId && row.version === item.version + 1)
            return { workerId: row.workerId, unused: undefined };
          if (row.version !== item.version || row.workerId)
            conflict('Worker intake changed. Reload before creating.');
          const { worker } = await this.accounts.createLinkedAccount(
            manager,
            actor,
            contractorId,
            account,
            prepared,
          );
          await manager.getRepository(WorkerComplianceProfileEntity).update(
            { workerId: worker.id },
            {
              draftSafetyCardRequired: row.safetyCardRequired,
            },
          );
          const docs = [];
          for (const kind of DOCUMENT_KINDS) {
            if (kind === 'SAFETY_CARD' && row.safetyCardRequired === false) continue;
            const attachment = row.documents[kind];
            if (!attachment?.file || !attachment.originalName) continue;
            docs.push({
              id: randomUUID(),
              workerId: worker.id,
              kind,
              status: 'DRAFT' as const,
              originalName: attachment.originalName,
              file: attachment.file,
              submittedIssuedOn: attachment.submittedIssuedOn ?? null,
              submittedExpiresOn: attachment.submittedExpiresOn ?? null,
              uploadedBy: actor.id,
            });
          }
          await manager.getRepository(WorkerDocumentEntity).insert(docs);
          await repo.update(where, {
            workerId: worker.id,
            version: row.version + 1,
            documents: {},
          });
          return {
            workerId: worker.id,
            unused: row.safetyCardRequired === false ? row.documents.SAFETY_CARD?.file : undefined,
          };
        },
        this.accounts.commandAuthorization(context, actor, siteId, contractorId),
      );
      if (result.unused) await this.storage.remove(result.unused);
      return result.workerId;
    } catch (error) {
      return this.accounts.workerAccountConflict(error);
    }
  }
}
