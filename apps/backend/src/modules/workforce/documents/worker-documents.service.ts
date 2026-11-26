import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import {
  healthCertificateExpiry,
  isWorkerDocumentDate as isCalendarDate,
} from '@smartsite/contracts';
import type {
  Page,
  WorkerDocumentSubmissionResponse,
  WorkerDocumentAiSummary,
  ReviewWorkerDocumentCommand,
  WorkerComplianceResponse,
  WorkerDocumentKind,
  WorkerDocumentResponse,
  WorkerComplianceListQuery,
  UploadWorkerDocumentCommand,
  WorkerDocumentAnalysisResult,
  WorkerDocumentAiAnalysis,
} from '@smartsite/contracts';
import {
  command,
  conflict,
  invalid,
  missing,
  page,
  uuid,
} from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import {
  WorkerComplianceProfileEntity,
  WorkerDocumentEntity,
  type WorkerDocumentAnalysisLease,
  WorkerIdentityImageEntity,
} from '../../../database/entities/worker-document.entity.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import { UserRole } from '../../../database/entities/user.entity.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import type { StoredObject } from '../../../integrations/storage/storage.service.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../directory/contractor-operations.service.js';
import { AccessAuditEntity } from '../../../database/entities/access-audit.entity.js';
import {
  parseDocumentSubmission,
  parseWorkerDocumentBatch,
  parseWorkerIdentity,
} from './worker-document-submission.js';
import { auditAccess } from '../shared/access-audit.js';
import {
  executeMainConfigurationCommand,
  executeMainMetadataMutation,
  type MainConfigurationCommandContext,
} from '../../../common/configuration/main-configuration-authority.js';
import {
  complianceDate,
  complianceState,
  documentDraftMissingKinds,
  documentReviewState,
  DOCUMENT_KINDS,
} from './worker-compliance.js';
import {
  documentOriginalName,
  validateWorkerDocument,
  validateWorkerDocumentFile,
  type DocumentUpload,
} from './worker-document-file.js';
export { validateWorkerDocument, type DocumentUpload } from './worker-document-file.js';
import { ReviewWorkerDocumentDto } from './worker-documents.commands.js';
import { DocumentNotificationsService } from './document-notifications.service.js';
import { compareDocumentDates } from './worker-document-date-check.js';
import {
  DOCUMENT_ANALYSIS_TIMEOUT_MS,
  DocumentAnalysisService,
} from './document-analysis.service.js';

const documentColumns = [
  'd.id',
  'd.workerId',
  'd.kind',
  'd.status',
  'd.originalName',
  'd.file',
  'd.issuedOn',
  'd.expiresOn',
  'd.submittedIssuedOn',
  'd.submittedExpiresOn',
  'd.uploadedBy',
  'd.uploadedAt',
  'd.reviewedAt',
  'd.reviewedBy',
  'd.reviewNote',
  'd.version',
];
const identitySides = ['FRONT', 'BACK'] as const;
type IdentitySide = (typeof identitySides)[number];
type StoredUpload = { file: DocumentUpload; stored: StoredObject };
type BatchDocumentResult =
  | { id: string; workerId: string; status: 'SUCCEEDED' }
  | { id: string; status: 'FAILED'; error: { code: string; message: string } };

function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}
function submittedDates(kind: WorkerDocumentKind, input: UploadWorkerDocumentCommand) {
  const submittedIssuedOn = input.submittedIssuedOn ?? null;
  const submittedExpiresOn =
    kind === 'HEALTH_CERTIFICATE'
      ? healthCertificateExpiry(submittedIssuedOn)
      : (input.submittedExpiresOn ?? null);
  if (!submittedExpiresOn) invalid('Enter a valid expiry date.');
  return {
    submittedIssuedOn,
    submittedExpiresOn,
  };
}
function response(doc: WorkerDocumentEntity): WorkerDocumentResponse {
  return {
    id: doc.id,
    workerId: doc.workerId,
    kind: doc.kind,
    status: doc.status,
    originalName: doc.originalName,
    mediaType: doc.file.mediaType as WorkerDocumentResponse['mediaType'],
    size: doc.file.size,
    issuedOn: doc.issuedOn,
    expiresOn: doc.expiresOn,
    submittedExpiresOn: doc.submittedExpiresOn ?? null,
    submittedIssuedOn: doc.submittedIssuedOn ?? null,
    uploadedAt: doc.uploadedAt.toISOString(),
    reviewedAt: doc.reviewedAt?.toISOString() ?? null,
    reviewNote: doc.reviewNote,
    version: doc.version,
  };
}

function analysisForReview(
  doc: WorkerDocumentEntity,
  analysis: WorkerDocumentAnalysisResult | WorkerDocumentAnalysisLease,
): WorkerDocumentAiAnalysis {
  if (analysis.status === 'ANALYZING')
    return { status: analysis.expiresAt > Date.now() ? 'ANALYZING' : 'UNAVAILABLE' };
  if (analysis.status !== 'COMPLETE') return { status: 'UNAVAILABLE' };
  const today = complianceDate();
  const effectiveExpiry =
    doc.kind === 'HEALTH_CERTIFICATE'
      ? healthCertificateExpiry(analysis.issuedOn)
      : analysis.expiresOn;
  return {
    status: 'COMPLETE',
    detectedKind: analysis.detectedKind,
    issuedOn: analysis.issuedOn,
    expiresOn: analysis.expiresOn,
    kindMismatch: analysis.detectedKind !== null && analysis.detectedKind !== doc.kind,
    dateCheck: compareDocumentDates(doc.kind, doc, analysis),
    ...(doc.kind !== 'HEALTH_CERTIFICATE' &&
      doc.submittedIssuedOn && {
        startDateCheck: compareDocumentDates(doc.kind, doc, analysis, 'ISSUED_ON'),
      }),
    validity:
      effectiveExpiry && effectiveExpiry < today
        ? 'EXPIRED'
        : analysis.issuedOn && analysis.issuedOn > today
          ? 'NOT_YET_VALID'
          : effectiveExpiry
            ? 'CURRENT'
            : 'UNKNOWN',
  };
}

export function summarizeAnalysis(documents: WorkerDocumentEntity[]): WorkerDocumentAiSummary {
  const pending = documents.filter((doc) => doc.status === 'DRAFT');
  const results = pending.map((doc) =>
    doc.aiAnalysis ? analysisForReview(doc, doc.aiAnalysis) : null,
  );
  const complete = results.filter((result) => result?.status === 'COMPLETE');
  const attention = complete.some(
    (result) =>
      result.kindMismatch ||
      result.dateCheck.status === 'MISMATCH' ||
      result.startDateCheck?.status === 'MISMATCH' ||
      result.validity === 'EXPIRED' ||
      result.validity === 'NOT_YET_VALID',
  );
  const insufficient = complete.some(
    (result) =>
      !result.detectedKind ||
      result.dateCheck.status !== 'MATCH' ||
      (result.startDateCheck && result.startDateCheck.status !== 'MATCH') ||
      result.validity === 'UNKNOWN',
  );
  const unresolved = pending.length - complete.length;
  let status: WorkerDocumentAiSummary['status'] = 'NO_DISCREPANCY';
  if (attention) status = 'ATTENTION';
  else if (results.some((result) => result?.status === 'ANALYZING')) status = 'ANALYZING';
  else if (insufficient || results.some((result) => result?.status === 'UNAVAILABLE'))
    status = 'INSUFFICIENT';
  else if (!complete.length) status = 'NOT_SCANNED';
  else if (unresolved) status = 'INSUFFICIENT';
  return { pending: pending.length, complete: complete.length, unresolved, status };
}

@Injectable()
export class WorkerDocumentsService {
  private readonly logger = new Logger(WorkerDocumentsService.name);

  constructor(
    private readonly source: DataSource,
    private readonly operations: ContractorOperationsService,
    private readonly storage: StorageService,
    private readonly notifications: DocumentNotificationsService,
    private readonly analysis: DocumentAnalysisService,
  ) {}

  private hasRole(actor: WorkforceActor, siteId: string, role: UserRole) {
    return actor.roleAssignments.some(
      (assignment) => assignment.role === role && assignment.siteId === siteId,
    );
  }

  private authorizeRole(
    context: MainConfigurationCommandContext | undefined,
    actor: WorkforceActor,
    siteId: string,
    role: UserRole,
  ) {
    if (!context) return undefined;
    return async (manager: EntityManager) => {
      const roles = await manager.query(
        'SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role=$3 FOR SHARE',
        [actor.id, siteId, role],
      );
      if (context.actorUserId !== actor.id || !roles.length) forbidden();
    };
  }

  private async canSeeDrafts(manager: EntityManager, actor: WorkforceActor, worker: WorkerEntity) {
    if (
      !worker.contractorId ||
      !this.hasRole(actor, worker.siteId, UserRole.CONTRACTOR_REPRESENTATIVE)
    )
      return false;
    try {
      await this.operations.requireWorkerCreationAccess(
        manager,
        actor,
        worker.contractorId,
        worker.siteId,
      );
      return true;
    } catch (error) {
      if (error instanceof PublicHttpException && error.getStatus() === 403) return false;
      throw error;
    }
  }

  private async access(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    mode: 'read' | 'submit' | 'review' = 'read',
    lock = false,
  ) {
    if (actor.mustChangePassword) forbidden();
    const worker = await manager.getRepository(WorkerEntity).findOne({
      where: { id: uuid(workerId).toLowerCase(), siteId: uuid(siteId).toLowerCase() },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!worker) missing();
    const safety = this.hasRole(actor, worker.siteId, UserRole.SAFETY_OFFICER);
    if (mode === 'review') {
      if (!safety) forbidden();
      return worker;
    }
    if (
      mode === 'read' &&
      (safety ||
        (worker.userId === actor.id && this.hasRole(actor, worker.siteId, UserRole.WORKER)))
    )
      return worker;
    if (!worker.contractorId) forbidden();
    await this.operations.requireWorkerCreationAccess(
      manager,
      actor,
      worker.contractorId,
      worker.siteId,
      lock,
    );
    return worker;
  }
  async get(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    includeDrafts = true,
  ): Promise<WorkerComplianceResponse> {
    const worker = await this.access(this.source.manager, actor, siteId, workerId);
    const canSeeDrafts =
      includeDrafts && (await this.canSeeDrafts(this.source.manager, actor, worker));
    const profile = await this.source
      .getRepository(WorkerComplianceProfileEntity)
      .findOneBy({ workerId: worker.id });
    const identityImages = await this.source
      .getRepository(WorkerIdentityImageEntity)
      .createQueryBuilder('i')
      .select(['i.id', 'i.side', 'i.originalName', 'i.uploadedAt', 'i.file'])
      .where('i.worker_id=:workerId', { workerId })
      .getMany();
    const documentQuery = this.source
      .getRepository(WorkerDocumentEntity)
      .createQueryBuilder('d')
      .select(documentColumns)
      .where('d.worker_id=:workerId', { workerId: worker.id })
      .orderBy('d.uploaded_at', 'DESC')
      .addOrderBy('d.id', 'DESC');
    if (canSeeDrafts) documentQuery.addSelect('d.aiAnalysis');
    else documentQuery.andWhere("d.status <> 'DRAFT'");
    const documents = await documentQuery.getMany();
    const draftSafetyCardRequired =
      profile?.draftSafetyCardRequired ?? profile?.safetyCardRequired ?? true;
    const state = complianceState(
      true,
      documents,
      new Date(),
      this.notifications.noticeDays,
      profile?.safetyCardRequired ?? true,
    );
    return {
      workerId: worker.id,
      contractorId: worker.contractorId,
      displayName: worker.displayName,
      externalId: worker.externalId,
      nationalId: profile?.nationalId ?? null,
      phoneNumber: profile?.phoneNumber ?? null,
      gender: profile?.gender ?? null,
      address: profile?.address ?? null,
      version: profile?.version ?? 0,
      identityVersion: profile?.identityVersion ?? 0,
      safetyCardRequired: canSeeDrafts
        ? draftSafetyCardRequired
        : (profile?.safetyCardRequired ?? true),
      identityImages: identityImages.map((i) => ({
        id: i.id,
        side: i.side,
        mediaType: i.file.mediaType as 'image/jpeg' | 'image/png',
        originalName: i.originalName,
        uploadedAt: i.uploadedAt.toISOString(),
      })),
      ...state,
      ...documentReviewState(documents, new Date(), profile?.safetyCardRequired ?? true),
      ...(canSeeDrafts
        ? {
            aiSummary: summarizeAnalysis(documents),
            canSubmit:
              documents.some((doc) => doc.status === 'DRAFT') &&
              documentDraftMissingKinds(documents, draftSafetyCardRequired).length === 0,
          }
        : {}),
      documents: documents.map((doc) => {
        const analysis = doc.aiAnalysis;
        return {
          ...response(doc),
          ...(canSeeDrafts && analysis
            ? {
                aiAnalysis: analysisForReview(doc, analysis),
              }
            : {}),
        };
      }),
    };
  }
  async list(
    actor: WorkforceActor,
    siteIdValue: string,
    offset: number,
    limit: number,
    filters: WorkerComplianceListQuery = {},
  ): Promise<Page<WorkerComplianceResponse>> {
    const siteId = uuid(siteIdValue).toLowerCase();
    const paging = page(offset, limit);
    if (
      filters.search !== undefined &&
      (typeof filters.search !== 'string' || filters.search.length > 120)
    )
      invalid('Invalid document search');
    if (filters.pendingOnly !== undefined && typeof filters.pendingOnly !== 'boolean')
      invalid('Invalid pending document filter');
    if (
      filters.submissionStatus !== undefined &&
      !['NOT_SUBMITTED', 'PENDING_REVIEW', 'REVIEWED'].includes(filters.submissionStatus)
    )
      invalid('Invalid document submission filter');
    if (filters.needsSupplement !== undefined && typeof filters.needsSupplement !== 'boolean')
      invalid('Invalid document supplement filter');
    if (actor.mustChangePassword) forbidden();
    const safety = actor.roleAssignments.some(
      (r) => r.role === UserRole.SAFETY_OFFICER && r.siteId === siteId,
    );
    const rep = actor.roleAssignments.some(
      (r) => r.role === UserRole.CONTRACTOR_REPRESENTATIVE && r.siteId === siteId,
    );
    if (!safety && !rep) forbidden();
    const query = this.source
      .getRepository(WorkerEntity)
      .createQueryBuilder('w')
      .where('w.site_id=:siteId', { siteId });
    if (!safety)
      query.andWhere(
        `EXISTS(SELECT 1 FROM contractor_representative_grant g WHERE g.user_id=:actorId AND g.contractor_id=w.contractor_id)
      AND EXISTS(SELECT 1 FROM contractor c WHERE c.id=w.contractor_id AND c.is_active)
      AND EXISTS(SELECT 1 FROM contractor_site_participation p WHERE p.contractor_id=w.contractor_id AND p.site_id=w.site_id AND p.is_active AND p.valid_from<=CURRENT_TIMESTAMP AND (p.valid_until IS NULL OR p.valid_until>CURRENT_TIMESTAMP))`,
        { actorId: actor.id },
      );
    const search = filters.search?.trim();
    if (search)
      query.andWhere(
        "(w.display_name ILIKE :search ESCAPE '\\' OR w.external_id ILIKE :search ESCAPE '\\')",
        { search: `%${search.replace(/[\\%_]/g, '\\$&')}%` },
      );
    if (filters.contractorId)
      query.andWhere('w.contractor_id=:contractorId', {
        contractorId: uuid(filters.contractorId),
      });
    const hasDocuments =
      "EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.status<>'DRAFT')";
    const hasPending =
      "EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.status='PENDING')";
    if (safety) query.andWhere(hasDocuments);
    if (filters.pendingOnly) query.andWhere(hasPending);
    if (filters.expiringOnly) {
      const now = new Date();
      query.andWhere(
        "EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.status='APPROVED' AND d.issued_on<=CAST(:today AS date) AND d.expires_on BETWEEN CAST(:today AS date) AND CAST(:notice AS date) AND (d.kind<>'SAFETY_CARD' OR COALESCE((SELECT p.safety_card_required FROM worker_compliance_profile p WHERE p.worker_id=w.id),true)))",
        {
          today: complianceDate(now),
          notice: complianceDate(
            new Date(now.getTime() + this.notifications.noticeDays * 86400000),
          ),
        },
      );
    }
    if (filters.submissionStatus === 'NOT_SUBMITTED') query.andWhere(`NOT ${hasDocuments}`);
    if (filters.submissionStatus === 'PENDING_REVIEW') query.andWhere(hasPending);
    if (filters.submissionStatus === 'REVIEWED')
      query.andWhere(`${hasDocuments} AND NOT ${hasPending}`);
    if (filters.needsSupplement !== undefined) {
      const supplement = `(
        EXISTS(SELECT 1 FROM (VALUES ('SAFETY_CARD'), ('HEALTH_CERTIFICATE'), ('PERSONAL_INSURANCE')) kinds(kind)
          WHERE (kinds.kind<>'SAFETY_CARD' OR COALESCE((SELECT p.safety_card_required FROM worker_compliance_profile p WHERE p.worker_id=w.id),true))
          AND NOT EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status='PENDING')
          AND (NOT EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status='APPROVED'
            AND d.issued_on<=CAST(:reviewToday AS date) AND d.expires_on>=CAST(:reviewToday AS date))
            OR (SELECT d.status FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status NOT IN ('SUPERSEDED','DRAFT')
              ORDER BY d.uploaded_at DESC, d.id DESC LIMIT 1)='REJECTED'))
      )`;
      query.andWhere(filters.needsSupplement ? supplement : `NOT ${supplement}`, {
        reviewToday: complianceDate(),
      });
    }
    const [workers, total] = await query
      .orderBy('w.created_at', 'DESC')
      .addOrderBy('w.id', 'ASC')
      .skip(paging.offset)
      .take(paging.limit)
      .getManyAndCount();
    const items: WorkerComplianceResponse[] = [];
    for (const worker of workers) items.push(await this.get(actor, siteId, worker.id, !safety));
    return { items, total };
  }

  private async storeUpload(file: DocumentUpload): Promise<StoredUpload> {
    const { mediaType, extension } = await validateWorkerDocumentFile(file.buffer, file.mimetype);
    return { file, stored: await this.storage.save(file.buffer, mediaType, extension) };
  }

  async submit(
    actor: WorkforceActor,
    siteIdValue: string,
    workerIdValue: string,
    input: unknown,
    files: Partial<Record<WorkerDocumentKind, DocumentUpload>>,
    context?: MainConfigurationCommandContext,
  ): Promise<WorkerDocumentSubmissionResponse> {
    const value = parseDocumentSubmission(input);
    const worker = await this.access(
      this.source.manager,
      actor,
      siteIdValue,
      workerIdValue,
      'submit',
    );
    const { id: workerId, siteId } = worker;
    if (Object.keys(files).some((key) => !DOCUMENT_KINDS.includes(key as WorkerDocumentKind)))
      invalid('Unexpected document file');
    const fingerprint = createHash('sha256').update(JSON.stringify(value));
    for (const kind of DOCUMENT_KINDS) {
      const file = files[kind];
      if (!file) continue;
      if (!value.documents[kind]) invalid('Each certificate requires its declared date');
      validateWorkerDocument(file);
      fingerprint
        .update(kind)
        .update(file.mimetype)
        .update(createHash('sha256').update(file.buffer).digest());
    }
    const hash = fingerprint.digest('hex');
    const replay = async (manager: EntityManager) => {
      const audit = await manager
        .getRepository(AccessAuditEntity)
        .createQueryBuilder('a')
        .where(
          'a.actor_account_id=:actorId AND a.site_id=:siteId AND a.entity_id=:workerId AND a.action=:action',
          {
            actorId: actor.id,
            siteId,
            workerId,
            action: 'WORKER_DOCUMENT_DRAFTS_SAVED',
          },
        )
        .andWhere("a.changes->>'requestId'=:requestId", { requestId: value.requestId })
        .getOne();
      if (!audit?.changes) return null;
      if (audit.changes.fingerprint !== hash)
        conflict('Submission request already used with different contents');
      return {
        requestId: value.requestId,
        version: Number(audit.changes.version),
        documentIds: audit.changes.documentIds as string[],
      };
    };
    const authorize = this.authorizeRole(
      context,
      actor,
      siteId,
      UserRole.CONTRACTOR_REPRESENTATIVE,
    );
    const previous = await replay(this.source.manager);
    if (previous)
      return executeMainMetadataMutation(
        this.source,
        context,
        async (manager) => {
          await this.access(manager, actor, siteId, workerId, 'submit', true);
          return previous;
        },
        authorize,
      );

    const prepared = new Map<WorkerDocumentKind, StoredUpload>();
    const adopted = new Set<string>();
    const obsolete: StoredObject[] = [];
    let committed = false;
    try {
      for (const kind of DOCUMENT_KINDS) {
        const file = files[kind];
        if (file) prepared.set(kind, await this.storeUpload(file));
      }
      const result = await executeMainMetadataMutation(
        this.source,
        context,
        async (manager) => {
          adopted.clear();
          obsolete.length = 0;
          await this.access(manager, actor, siteId, workerId, 'submit', true);
          const retry = await replay(manager);
          if (retry) return retry;
          const profiles = manager.getRepository(WorkerComplianceProfileEntity);
          const existing = await profiles.findOneBy({ workerId });
          if ((existing?.version ?? 0) !== value.expectedVersion)
            conflict('Worker profile changed. Reload before saving.');
          const profile = await profiles.save(
            profiles.create({
              ...existing,
              workerId,
              draftSafetyCardRequired: value.safetyCardRequired,
              version: value.expectedVersion + 1,
            }),
          );
          const documents = manager.getRepository(WorkerDocumentEntity);
          const current = await documents
            .createQueryBuilder('d')
            .select(documentColumns)
            .where("d.worker_id=:workerId AND d.status='DRAFT'", { workerId })
            .getMany();
          const documentIds: string[] = [];
          for (const kind of DOCUMENT_KINDS) {
            const proposal = value.documents[kind];
            if (!proposal) continue;
            const item = prepared.get(kind);
            const old = current.find((doc) => doc.kind === kind);
            if (!item && !old) invalid('Attach a file before saving its declared date');
            const dates = submittedDates(kind, proposal);
            if (
              old &&
              (!item || old.file.sha256 === item.stored.sha256) &&
              old.submittedIssuedOn === dates.submittedIssuedOn &&
              old.submittedExpiresOn === dates.submittedExpiresOn
            ) {
              documentIds.push(old.id);
              continue;
            }
            if (old) await documents.delete(old.id);
            const doc = await documents.save(
              documents.create({
                id: randomUUID(),
                workerId,
                kind,
                status: 'DRAFT',
                file: item?.stored ?? old!.file,
                originalName: item
                  ? documentOriginalName(item.file, 'document')
                  : old!.originalName,
                submittedIssuedOn: dates.submittedIssuedOn,
                submittedExpiresOn: dates.submittedExpiresOn,
                uploadedBy: actor.id,
                version: 1,
              }),
            );
            documentIds.push(doc.id);
            if (item) adopted.add(item.stored.storageKey);
            if (item && old) obsolete.push(old.file);
          }
          await auditAccess(
            manager,
            actor.id,
            siteId,
            'WORKER_DOCUMENT_DRAFTS_SAVED',
            'worker',
            workerId,
            null,
            {
              requestId: value.requestId,
              fingerprint: hash,
              version: profile.version,
              documentIds,
            },
          );
          return { requestId: value.requestId, version: profile.version, documentIds };
        },
        authorize,
      );
      committed = true;
      return result;
    } finally {
      for (const item of prepared.values()) {
        if (!committed || !adopted.has(item.stored.storageKey))
          await this.storage.remove(item.stored);
      }
      if (committed) await Promise.all(obsolete.map((ref) => this.storage.remove(ref)));
    }
  }

  async submitBatch(
    actor: WorkforceActor,
    siteIdValue: string,
    contractorIdValue: string,
    input: unknown,
    context?: MainConfigurationCommandContext,
  ): Promise<{ items: BatchDocumentResult[] }> {
    const siteId = uuid(siteIdValue).toLowerCase();
    const contractorId = uuid(contractorIdValue).toLowerCase();
    const selected = parseWorkerDocumentBatch(input);
    await this.operations.requireWorkerCreationAccess(
      this.source.manager,
      actor,
      contractorId,
      siteId,
    );
    const authorize = this.authorizeRole(
      context,
      actor,
      siteId,
      UserRole.CONTRACTOR_REPRESENTATIVE,
    );
    const items: BatchDocumentResult[] = [];
    for (const { id: workerId, version } of selected) {
      try {
        await executeMainConfigurationCommand(
          this.source,
          context,
          'WORKER_DOCUMENT_SUBMIT',
          {
            siteId,
            contractorId,
            workerId,
            expectedVersion: version,
          },
          async (manager) => {
            const worker = await this.access(manager, actor, siteId, workerId, 'submit', true);
            if (worker.contractorId !== contractorId) missing();
            const profiles = manager.getRepository(WorkerComplianceProfileEntity);
            const profile = await profiles.findOneBy({ workerId });
            if (profile?.version !== version) {
              const previous = await manager
                .getRepository(AccessAuditEntity)
                .createQueryBuilder('a')
                .where('a.site_id=:siteId AND a.entity_id=:workerId AND a.action=:action', {
                  siteId,
                  workerId,
                  action: 'WORKER_DOCUMENTS_SUBMITTED',
                })
                .andWhere("a.changes->>'submittedVersion'=:version", { version: String(version) })
                .getOne();
              if (previous) return;
              conflict('Worker profile changed. Reload before sending.');
            }
            const documents = manager.getRepository(WorkerDocumentEntity);
            const current = await documents
              .createQueryBuilder('d')
              .select(documentColumns)
              .where('d.worker_id=:workerId', { workerId })
              .getMany();
            const drafts = current.filter((doc) => doc.status === 'DRAFT');
            const safetyCardRequired =
              profile.draftSafetyCardRequired ?? profile.safetyCardRequired;
            if (documentDraftMissingKinds(current, safetyCardRequired).length)
              invalid('Complete the required certificates before sending');
            if (!drafts.length) conflict('No draft certificates to send.');
            for (const doc of drafts) {
              await documents
                .createQueryBuilder()
                .update()
                .set({ status: 'SUPERSEDED', version: () => 'version + 1' })
                .where("worker_id=:workerId AND kind=:kind AND status='PENDING'", {
                  workerId,
                  kind: doc.kind,
                })
                .execute();
              doc.status = 'PENDING';
              doc.version += 1;
              await documents.save(doc);
              await this.notifications.record(manager, worker, doc, 'DOCUMENT_SUBMITTED');
            }
            profile.safetyCardRequired = safetyCardRequired;
            profile.draftSafetyCardRequired = null;
            profile.version += 1;
            await profiles.save(profile);
            await auditAccess(
              manager,
              actor.id,
              siteId,
              'WORKER_DOCUMENTS_SUBMITTED',
              'worker',
              workerId,
              null,
              {
                submittedVersion: version,
                version: profile.version,
                documentIds: drafts.map((doc) => doc.id),
              },
            );
            await manager.query(
              'UPDATE site SET access_policy_version=access_policy_version+1 WHERE id=$1',
              [siteId],
            );
          },
          authorize,
        );
        items.push({ id: workerId, workerId, status: 'SUCCEEDED' });
      } catch (error) {
        if (!(error instanceof PublicHttpException))
          this.logger.error({ event: 'worker_documents_submission_failed' });
        const failure =
          error instanceof PublicHttpException
            ? error.publicPayload
            : {
                code: 'SERVICE_UNAVAILABLE',
                message: 'Worker documents could not be sent. Try again.',
              };
        items.push({
          id: workerId,
          status: 'FAILED',
          error: { code: failure.code, message: failure.message },
        });
      }
    }
    return { items };
  }

  private async ownWorker(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    lock = false,
  ) {
    if (actor.mustChangePassword || !this.hasRole(actor, siteId, UserRole.WORKER)) forbidden();
    const worker = await manager.getRepository(WorkerEntity).findOne({
      where: { siteId, userId: actor.id },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!worker) missing();
    return worker;
  }

  async getOwn(actor: WorkforceActor, siteIdValue: string) {
    const siteId = uuid(siteIdValue).toLowerCase();
    const worker = await this.ownWorker(this.source.manager, actor, siteId);
    return this.get(actor, siteId, worker.id, false);
  }

  async updateOwnIdentity(
    actor: WorkforceActor,
    siteIdValue: string,
    input: unknown,
    files: Partial<Record<IdentitySide, DocumentUpload>>,
    context?: MainConfigurationCommandContext,
  ): Promise<{ version: number }> {
    const siteId = uuid(siteIdValue).toLowerCase();
    const { expectedVersion, ...fields } = parseWorkerIdentity(input);
    await this.ownWorker(this.source.manager, actor, siteId);
    if (Object.keys(files).some((key) => !identitySides.includes(key as IdentitySide)))
      invalid('Unexpected identity image');
    for (const side of identitySides) {
      const file = files[side];
      if (file && validateWorkerDocument(file).mediaType === 'application/pdf')
        invalid('Citizen ID sides require JPEG or PNG');
    }
    const prepared = new Map<IdentitySide, StoredUpload>();
    const adopted = new Set<string>();
    let committed = false;
    try {
      for (const side of identitySides) {
        const file = files[side];
        if (file) prepared.set(side, await this.storeUpload(file));
      }
      const result = await executeMainMetadataMutation(
        this.source,
        context,
        async (manager) => {
          adopted.clear();
          const { id: workerId } = await this.ownWorker(manager, actor, siteId, true);
          const profiles = manager.getRepository(WorkerComplianceProfileEntity);
          const existing = await profiles.findOneBy({ workerId });
          if ((existing?.identityVersion ?? 0) !== expectedVersion)
            conflict('Personal information changed. Reload before saving.');
          const images = manager.getRepository(WorkerIdentityImageEntity);
          const current = await images
            .createQueryBuilder('i')
            .select(['i.id', 'i.workerId', 'i.side', 'i.originalName', 'i.uploadedAt', 'i.file'])
            .where('i.worker_id=:workerId', { workerId })
            .getMany();
          if (
            !identitySides.every(
              (side) => prepared.has(side) || current.some((image) => image.side === side),
            )
          )
            invalid('Upload the front and back of your citizen ID');
          const replacedImages: { side: IdentitySide; file: StoredObject }[] = [];
          for (const side of identitySides) {
            const item = prepared.get(side);
            if (!item) continue;
            const old = current.find((image) => image.side === side);
            if (old?.file.sha256 === item.stored.sha256) continue;
            if (old) replacedImages.push({ side, file: old.file });
            await images.save(
              images.create({
                id: old?.id ?? randomUUID(),
                workerId,
                side,
                file: item.stored,
                originalName: documentOriginalName(item.file, side),
                uploadedAt: new Date(),
              }),
            );
            adopted.add(item.stored.storageKey);
          }
          const version = expectedVersion + 1;
          await profiles.save(
            profiles.create({ ...existing, workerId, ...fields, identityVersion: version }),
          );
          await auditAccess(
            manager,
            actor.id,
            siteId,
            'WORKER_IDENTITY_UPDATED',
            'worker',
            workerId,
            null,
            {
              version,
              updatedSides: [...prepared.keys()],
              replacedImages,
            },
          );
          return { version };
        },
        this.authorizeRole(context, actor, siteId, UserRole.WORKER),
      );
      committed = true;
      return result;
    } finally {
      for (const item of prepared.values()) {
        if (!committed || !adopted.has(item.stored.storageKey))
          await this.storage.remove(item.stored);
      }
    }
  }

  async analyzeDocument(
    actor: WorkforceActor,
    siteIdValue: string,
    workerId: string,
    documentId: string,
    context?: MainConfigurationCommandContext,
  ) {
    const siteId = uuid(siteIdValue).toLowerCase();
    const claim = await executeMainMetadataMutation(
      this.source,
      context,
      async (manager) => {
        const worker = await this.access(manager, actor, siteId, workerId, 'submit', true);
        const docs = manager.getRepository(WorkerDocumentEntity);
        const doc = await docs
          .createQueryBuilder('d')
          .select([...documentColumns, 'd.aiAnalysis'])
          .where('d.id=:id AND d.worker_id=:workerId', {
            id: uuid(documentId),
            workerId: worker.id,
          })
          .getOne();
        if (!doc) missing();
        if (doc.status !== 'DRAFT') conflict('Only draft documents can be analyzed.');
        if (doc.aiAnalysis?.status === 'COMPLETE') return null;
        const now = Date.now();
        if (doc.aiAnalysis?.status === 'ANALYZING' && doc.aiAnalysis.expiresAt > now)
          conflict('Document analysis is already running.');
        // Release the worker lock before reading the file or calling OpenAI.
        const lease: WorkerDocumentAnalysisLease = {
          status: 'ANALYZING',
          token: randomUUID(),
          expiresAt: now + (this.analysis.timeoutMs ?? DOCUMENT_ANALYSIS_TIMEOUT_MS) + 30000,
        };
        await docs.update(doc.id, { aiAnalysis: lease });
        return { doc, lease };
      },
      this.authorizeRole(context, actor, siteId, UserRole.CONTRACTOR_REPRESENTATIVE),
    );
    if (!claim) return;

    const { doc, lease } = claim;
    const started = performance.now();
    let aiAnalysis: WorkerDocumentAnalysisResult = { status: 'UNAVAILABLE' };
    try {
      const bytes = await this.storage.read(doc.file);
      const { mediaType } = validateWorkerDocument({
        buffer: bytes,
        size: doc.file.size,
        mimetype: doc.file.mediaType,
      });
      if (Date.now() + (this.analysis.timeoutMs ?? DOCUMENT_ANALYSIS_TIMEOUT_MS) >= lease.expiresAt)
        throw new Error('Document analysis lease has insufficient time remaining');
      aiAnalysis = (await this.analysis.analyze(bytes, mediaType)) ?? aiAnalysis;
    } catch {
      this.logger.warn({
        status: 'UNAVAILABLE',
        durationMs: Math.round(performance.now() - started),
        code: 'DOCUMENT_ANALYSIS_INPUT_UNAVAILABLE',
      });
    }
    // An expired attempt must never overwrite a retry.
    const saved = await this.source
      .createQueryBuilder()
      .update(WorkerDocumentEntity)
      .set({ aiAnalysis })
      .where("id = :id AND ai_analysis->>'token' = :token", { id: doc.id, token: lease.token })
      .execute();
    if (!saved.affected) conflict('Document analysis has changed. Refresh before trying again.');
    if (aiAnalysis.status === 'UNAVAILABLE')
      throw new PublicHttpException(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Document analysis is unavailable. Try again later.',
      });
  }

  async file(actor: WorkforceActor, siteId: string, workerId: string, documentId: string) {
    const worker = await this.access(this.source.manager, actor, siteId, workerId);
    const doc = await this.source
      .getRepository(WorkerDocumentEntity)
      .createQueryBuilder('d')
      .select(documentColumns)
      .where('d.id=:id AND d.worker_id=:workerId', { id: uuid(documentId), workerId })
      .getOne();
    if (
      !doc ||
      (doc.status === 'DRAFT' && !(await this.canSeeDrafts(this.source.manager, actor, worker)))
    )
      missing();
    return { doc, bytes: await this.storage.read(doc.file) };
  }
  async review(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    documentId: string,
    input: ReviewWorkerDocumentCommand,
    context?: MainConfigurationCommandContext,
  ) {
    const value = command(ReviewWorkerDocumentDto, input);
    if (!value.approve && !value.reviewNote)
      invalid('A reason is required when returning a document');
    return executeMainConfigurationCommand(
      this.source,
      context,
      'WORKER_DOCUMENT_REVIEW',
      {
        siteId,
        workerId,
        documentId,
        approve: value.approve,
        expectedVersion: value.expectedVersion,
      },
      async (manager) => {
        const worker = await this.access(manager, actor, siteId, workerId, 'review', true);
        const repo = manager.getRepository(WorkerDocumentEntity);
        const doc = await repo
          .createQueryBuilder('d')
          .select(documentColumns)
          .where('d.id=:id AND d.worker_id=:workerId', { id: uuid(documentId), workerId })
          .getOne();
        if (!doc || doc.status === 'DRAFT') missing();
        if (doc.status !== 'PENDING' || doc.version !== value.expectedVersion)
          conflict('Document changed. Reload before reviewing.');
        if (value.approve) {
          const issuedOn = value.issuedOn ?? doc.submittedIssuedOn;
          const health = doc.kind === 'HEALTH_CERTIFICATE';
          const healthExpiry = health ? healthCertificateExpiry(issuedOn) : null;
          if (health && value.expiresOn !== undefined && value.expiresOn !== healthExpiry)
            invalid('Health certificate expiry must be one year after the examination date.');
          const expiresOn = health ? healthExpiry : (value.expiresOn ?? doc.submittedExpiresOn);
          const today = complianceDate();
          if (
            !isCalendarDate(issuedOn) ||
            !isCalendarDate(expiresOn) ||
            issuedOn > today ||
            expiresOn < today ||
            expiresOn < issuedOn
          )
            invalid('Confirm valid issue and expiry dates against the original document');
          await repo
            .createQueryBuilder()
            .update()
            .set({ status: 'SUPERSEDED', version: () => 'version + 1' })
            .where('worker_id=:workerId AND kind=:kind AND status=:status', {
              workerId,
              kind: doc.kind,
              status: 'APPROVED',
            })
            .execute();
          doc.issuedOn = issuedOn;
          doc.expiresOn = expiresOn;
        }
        doc.status = value.approve ? 'APPROVED' : 'REJECTED';
        doc.reviewedAt = new Date();
        doc.reviewedBy = actor.id;
        doc.reviewNote = value.reviewNote || null;
        doc.version += 1;
        await repo.save(doc);
        const profiles = manager.getRepository(WorkerComplianceProfileEntity);
        const currentProfile = await profiles.findOneBy({ workerId });
        if (currentProfile) await profiles.increment({ workerId }, 'version', 1);
        else
          await profiles.save(profiles.create({ workerId, version: 1, safetyCardRequired: true }));
        await this.notifications.record(
          manager,
          worker,
          doc,
          value.approve ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
        );
        await auditAccess(
          manager,
          actor.id,
          worker.siteId,
          'WORKER_DOCUMENT_REVIEWED',
          'worker',
          worker.id,
          doc.reviewNote,
          {
            documentId: doc.id,
            kind: doc.kind,
            status: doc.status,
            issuedOn: doc.issuedOn,
            expiresOn: doc.expiresOn,
          },
        );
        await manager.query(
          'UPDATE site SET access_policy_version=access_policy_version+1 WHERE id=$1',
          [siteId],
        );
        return response(doc);
      },
      context
        ? async (manager) => {
            const roles = await manager.query(
              "SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SAFETY_OFFICER' FOR SHARE",
              [actor.id, siteId],
            );
            if (context.actorUserId !== actor.id || !roles.length) forbidden();
          }
        : undefined,
    );
  }
  async identityFile(actor: WorkforceActor, siteId: string, workerId: string, id: string) {
    await this.access(this.source.manager, actor, siteId, workerId);
    const image = await this.source
      .getRepository(WorkerIdentityImageEntity)
      .createQueryBuilder('i')
      .addSelect('i.file')
      .where('i.id=:id AND i.worker_id=:workerId', { id: uuid(id), workerId })
      .getOne();
    if (!image) missing();
    return { image, bytes: await this.storage.read(image.file) };
  }
}
