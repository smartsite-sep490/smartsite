import { createHash, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { healthCertificateExpiry } from '@smartsite/contracts';
import type {
  Page,
  SubmitWorkerDocumentsCommand,
  WorkerDocumentSubmissionResponse,
  WorkerDocumentAiSummary,
  ReviewWorkerDocumentCommand,
  WorkerComplianceResponse,
  WorkerDocumentKind,
  WorkerDocumentResponse,
  WorkerComplianceListQuery,
  WorkerDocumentIdentityCheck,
  DocumentOcrResult,
  UploadWorkerDocumentCommand,
  WorkerDocumentCheckResponse,
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
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../directory/contractor-operations.service.js';
import { AccessAuditEntity } from '../../../database/entities/access-audit.entity.js';
import { parseDocumentSubmission } from './worker-document-submission.js';
import { auditAccess } from '../shared/access-audit.js';
import {
  executeMainConfigurationCommand,
  executeMainMetadataMutation,
  type MainConfigurationCommandContext,
} from '../../../common/configuration/main-configuration-authority.js';
import {
  complianceDate,
  complianceState,
  documentReviewState,
  DOCUMENT_KINDS,
} from './worker-compliance.js';
import { DocumentOcrService, isCalendarDate } from './document-ocr.service.js';
import { ReviewWorkerDocumentDto, UploadWorkerDocumentDto } from './worker-documents.commands.js';
import { DocumentNotificationsService } from './document-notifications.service.js';
import { compareDocumentDates } from './worker-document-date-check.js';
import {
  DOCUMENT_ANALYSIS_TIMEOUT_MS,
  DocumentAnalysisService,
} from './document-analysis.service.js';

export interface DocumentUpload {
  buffer: Buffer;
  size: number;
  mimetype: string;
  originalname?: string;
}
export function validateWorkerDocument(file: DocumentUpload | undefined) {
  if (
    !file ||
    !Buffer.isBuffer(file.buffer) ||
    file.size !== file.buffer.length ||
    file.size < 1 ||
    file.size > 5 * 1024 * 1024
  )
    invalid('Choose a document up to 5 MiB');
  const b = file.buffer;
  const jpeg =
    file.mimetype === 'image/jpeg' &&
    b.length >= 5 &&
    b[0] === 255 &&
    b[1] === 216 &&
    b[2] === 255 &&
    b.at(-2) === 255 &&
    b.at(-1) === 217;
  const png =
    file.mimetype === 'image/png' &&
    b.length >= 33 &&
    b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    b.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
  const pdf =
    file.mimetype === 'application/pdf' &&
    /^%PDF-(?:1\.[0-9]|2\.0)/.test(b.subarray(0, 8).toString('ascii')) &&
    /%%EOF\s*$/.test(b.subarray(-1024).toString('ascii'));
  if (!jpeg && !png && !pdf) invalid('Choose a JPEG, PNG or PDF with a matching signature');
  return {
    extension: jpeg ? 'jpg' : png ? 'png' : 'pdf',
    mediaType: file.mimetype as WorkerDocumentResponse['mediaType'],
  };
}
function forbidden(): never {
  throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
}
function kindValue(value: string): WorkerDocumentKind {
  if (!DOCUMENT_KINDS.includes(value as WorkerDocumentKind))
    invalid('Invalid worker document kind');
  return value as WorkerDocumentKind;
}
function submittedDates(
  kind: WorkerDocumentKind,
  input: UploadWorkerDocumentCommand,
  required = false,
) {
  const health = kind === 'HEALTH_CERTIFICATE';
  if (health && input.submittedExpiresOn !== undefined)
    invalid('Enter the health examination date; expiry is calculated one year later.');
  if (!health && input.submittedIssuedOn !== undefined)
    invalid('Examination dates are only accepted for health certificates.');
  const value = health ? input.submittedIssuedOn : input.submittedExpiresOn;
  if ((required && value === undefined) || (value != null && !isCalendarDate(value)))
    invalid('Enter a real expiry date in YYYY-MM-DD format.');
  const expires = health ? healthCertificateExpiry(value) : (value ?? null);
  if (health && value && !expires) invalid('Enter a real expiry date in YYYY-MM-DD format.');
  return {
    provided: value !== undefined,
    submittedIssuedOn: health ? (value ?? null) : null,
    submittedExpiresOn: expires,
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
    ocr: doc.ocr,
    issuedOn: doc.issuedOn,
    expiresOn: doc.expiresOn,
    submittedExpiresOn: doc.submittedExpiresOn ?? null,
    submittedIssuedOn: doc.submittedIssuedOn ?? null,
    uploadedAt: doc.uploadedAt.toISOString(),
    reviewedAt: doc.reviewedAt?.toISOString() ?? null,
    reviewNote: doc.reviewNote,
    version: doc.version,
    dateCheck: compareDocumentDates(doc.kind, doc, doc.ocr),
  };
}

export function compareDocumentIdentity(
  reference: string | null | undefined,
  ocr: DocumentOcrResult | null | undefined,
): WorkerDocumentIdentityCheck {
  const ids = ocr?.nationalIds ?? [];
  const status = !reference
    ? 'NO_REFERENCE'
    : !ocr || ocr.status === 'UNAVAILABLE' || !ocr.nationalIds
      ? 'UNAVAILABLE'
      : !ids.length
        ? 'NOT_DETECTED'
        : ids.some((id) => id !== reference)
          ? 'MISMATCH'
          : 'MATCH';
  return { status, detectedNationalIds: ids };
}

function analysisForReview(
  doc: WorkerDocumentEntity,
  analysis: WorkerDocumentAnalysisResult | WorkerDocumentAnalysisLease,
  nationalId: string | null | undefined,
): WorkerDocumentAiAnalysis {
  if (analysis.status === 'ANALYZING')
    return { status: analysis.expiresAt > Date.now() ? 'ANALYZING' : 'UNAVAILABLE' };
  if (analysis.status !== 'COMPLETE') return analysis;
  const effectiveExpiry =
    doc.kind === 'HEALTH_CERTIFICATE'
      ? healthCertificateExpiry(analysis.issuedOn)
      : analysis.expiresOn;
  const evidence: DocumentOcrResult = {
    status: 'READ',
    issuedOn: analysis.issuedOn,
    expiresOn: analysis.expiresOn,
    nationalIds: analysis.nationalId ? [analysis.nationalId] : [],
    warnings: [],
  };
  return {
    ...analysis,
    kindMismatch: analysis.detectedKind !== null && analysis.detectedKind !== doc.kind,
    dateCheck: compareDocumentDates(doc.kind, doc, evidence),
    identityCheck: compareDocumentIdentity(nationalId, evidence).status,
    validity:
      effectiveExpiry && effectiveExpiry < complianceDate()
        ? 'EXPIRED'
        : analysis.issuedOn && analysis.issuedOn > complianceDate()
          ? 'NOT_YET_VALID'
          : effectiveExpiry
            ? 'CURRENT'
            : 'UNKNOWN',
  };
}

export function summarizeAnalysis(
  documents: WorkerDocumentEntity[],
  nationalId?: string | null,
): WorkerDocumentAiSummary {
  const pending = documents.filter((doc) => doc.status === 'PENDING');
  const results = pending.map((doc) =>
    doc.aiAnalysis ? analysisForReview(doc, doc.aiAnalysis, nationalId) : null,
  );
  const complete = results.filter((result) => result?.status === 'COMPLETE');
  const attention = complete.some(
    (result) =>
      result?.status === 'COMPLETE' &&
      (result.kindMismatch ||
        result.dateCheck.status === 'MISMATCH' ||
        result.identityCheck === 'MISMATCH' ||
        result.validity === 'EXPIRED' ||
        result.validity === 'NOT_YET_VALID'),
  );
  const insufficient = complete.some(
    (result) =>
      result?.status === 'COMPLETE' &&
      (!result.detectedKind ||
        result.dateCheck.status !== 'MATCH' ||
        result.validity === 'UNKNOWN'),
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
    private readonly ocr: DocumentOcrService,
    private readonly notifications: DocumentNotificationsService,
    private readonly analysis: DocumentAnalysisService,
  ) {}

  private async access(
    manager: EntityManager,
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    mode: 'read' | 'write' | 'submit' | 'review' = 'read',
    lock = false,
  ) {
    if (actor.mustChangePassword) forbidden();
    const worker = await manager.getRepository(WorkerEntity).findOne({
      where: { id: uuid(workerId), siteId: uuid(siteId) },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!worker) missing();
    const safety = actor.roleAssignments.some(
      (r) => r.role === UserRole.SAFETY_OFFICER && r.siteId === siteId,
    );
    if (mode === 'review') {
      if (!safety) forbidden();
      return worker;
    }
    if (
      mode === 'read' &&
      (safety ||
        (worker.userId === actor.id &&
          actor.roleAssignments.some((r) => r.role === UserRole.WORKER && r.siteId === siteId)))
    )
      return worker;
    if (!worker.contractorId) forbidden();
    await this.operations.requireWorkerCreationAccess(
      manager,
      actor,
      worker.contractorId,
      siteId,
      lock,
    );
    return worker;
  }
  async checkSubmission(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    kindInput: string,
    file: DocumentUpload | undefined,
    input: UploadWorkerDocumentCommand = {},
  ): Promise<WorkerDocumentCheckResponse> {
    const value = command(UploadWorkerDocumentDto, input);
    const kind = kindValue(kindInput);
    const manual = submittedDates(kind, value);
    const worker = await this.access(this.source.manager, actor, siteId, workerId, 'submit');
    const format = validateWorkerDocument(file);
    const { quality, ocr } = await this.ocr.inspect(
      file!.buffer,
      format.mediaType,
      actor.id + ':' + siteId + ':' + worker.contractorId,
    );
    return { quality, ocr, dateCheck: compareDocumentDates(kind, manual, ocr) };
  }
  async get(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    includeAnalysis = true,
  ): Promise<WorkerComplianceResponse> {
    const worker = await this.access(this.source.manager, actor, siteId, workerId);
    const canSeeAnalysis =
      includeAnalysis &&
      actor.roleAssignments.some(
        (assignment) => assignment.role === UserRole.SAFETY_OFFICER && assignment.siteId === siteId,
      );
    const profile = await this.source
      .getRepository(WorkerComplianceProfileEntity)
      .findOneBy({ workerId: worker.id });
    const identityImages = await this.source
      .getRepository(WorkerIdentityImageEntity)
      .createQueryBuilder('i')
      .addSelect('i.file')
      .where('i.worker_id=:workerId', { workerId })
      .getMany();
    const documentQuery = this.source
      .getRepository(WorkerDocumentEntity)
      .createQueryBuilder('d')
      .addSelect('d.file')
      .where('d.worker_id=:workerId', { workerId: worker.id })
      .orderBy('d.uploaded_at', 'DESC')
      .addOrderBy('d.id', 'DESC');
    if (canSeeAnalysis) documentQuery.addSelect('d.aiAnalysis');
    const documents = await documentQuery.getMany();
    const state = complianceState(
      true,
      documents,
      new Date(),
      this.notifications.noticeDays,
      profile?.safetyCardRequired ?? true,
    );
    if (
      profile?.identityRequired &&
      (!profile.nationalId ||
        !profile.phoneNumber ||
        !profile.gender ||
        !profile.address ||
        identityImages.length !== 2) &&
      state.status === 'ACTIVE'
    )
      state.status = 'PENDING';
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
      safetyCardRequired: profile?.safetyCardRequired ?? true,
      identityImages: identityImages.map((i) => ({
        id: i.id,
        side: i.side,
        mediaType: i.file.mediaType as 'image/jpeg' | 'image/png',
        originalName: i.originalName,
        uploadedAt: i.uploadedAt.toISOString(),
        identityCheck: compareDocumentIdentity(profile?.nationalId, i.ocr),
      })),
      ...state,
      ...documentReviewState(
        documents,
        !profile?.identityRequired ||
          !!(
            profile.nationalId &&
            profile.phoneNumber &&
            profile.gender &&
            profile.address &&
            identityImages.length === 2
          ),
        new Date(),
        profile?.safetyCardRequired ?? true,
      ),
      ...(canSeeAnalysis ? { aiSummary: summarizeAnalysis(documents, profile?.nationalId) } : {}),
      documents: documents.map((doc) => {
        const analysis = doc.aiAnalysis;
        return {
          ...response(doc),
          identityCheck: compareDocumentIdentity(profile?.nationalId, doc.ocr),
          ...(canSeeAnalysis && analysis
            ? {
                aiAnalysis: analysisForReview(doc, analysis, profile?.nationalId),
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
    const siteId = uuid(siteIdValue);
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
    if (filters.pendingOnly)
      query.andWhere(
        `(
      EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.status='PENDING')
      OR (SELECT count(*) FROM worker_document d WHERE d.worker_id=w.id AND d.status='APPROVED'
        AND d.issued_on<=CAST(:today AS date) AND d.expires_on>=CAST(:today AS date)
        AND (d.kind<>'SAFETY_CARD' OR COALESCE((SELECT p.safety_card_required FROM worker_compliance_profile p WHERE p.worker_id=w.id),true)))
        <CASE WHEN COALESCE((SELECT p.safety_card_required FROM worker_compliance_profile p WHERE p.worker_id=w.id),true) THEN 3 ELSE 2 END
      OR EXISTS(SELECT 1 FROM worker_compliance_profile p WHERE p.worker_id=w.id AND p.identity_required AND
        (p.national_id IS NULL OR p.phone_number IS NULL OR p.gender IS NULL OR p.address IS NULL OR
         (SELECT count(*) FROM worker_identity_image i WHERE i.worker_id=w.id)<>2))
    )`,
        { today: complianceDate() },
      );
    const hasDocuments = `EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id)`;
    const hasPending = `EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.status='PENDING')`;
    if (filters.submissionStatus === 'NOT_SUBMITTED') query.andWhere(`NOT ${hasDocuments}`);
    if (filters.submissionStatus === 'PENDING_REVIEW') query.andWhere(hasPending);
    if (filters.submissionStatus === 'REVIEWED')
      query.andWhere(`${hasDocuments} AND NOT ${hasPending}`);
    if (filters.needsSupplement !== undefined) {
      const supplement = `(
        EXISTS(SELECT 1 FROM worker_compliance_profile p WHERE p.worker_id=w.id AND p.identity_required AND
          (p.national_id IS NULL OR p.phone_number IS NULL OR p.gender IS NULL OR p.address IS NULL OR
           (SELECT count(*) FROM worker_identity_image i WHERE i.worker_id=w.id)<>2))
        OR EXISTS(SELECT 1 FROM (VALUES ('SAFETY_CARD'), ('HEALTH_CERTIFICATE'), ('PERSONAL_INSURANCE')) kinds(kind)
          WHERE (kinds.kind<>'SAFETY_CARD' OR COALESCE((SELECT p.safety_card_required FROM worker_compliance_profile p WHERE p.worker_id=w.id),true))
          AND NOT EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status='PENDING')
          AND (NOT EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status='APPROVED'
            AND d.issued_on<=CAST(:reviewToday AS date) AND d.expires_on>=CAST(:reviewToday AS date))
            OR (SELECT d.status FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status<>'SUPERSEDED'
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
    for (const worker of workers) items.push(await this.get(actor, siteId, worker.id, safety));
    return { items, total };
  }

  async submit(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    input: SubmitWorkerDocumentsCommand,
    files: Partial<Record<WorkerDocumentKind | 'FRONT' | 'BACK', DocumentUpload>>,
    context?: MainConfigurationCommandContext,
  ): Promise<WorkerDocumentSubmissionResponse> {
    const value = parseDocumentSubmission(input);
    const worker = await this.access(this.source.manager, actor, siteId, workerId, 'submit');
    const keys = [...DOCUMENT_KINDS, 'FRONT', 'BACK'] as const;
    if (Object.keys(files).some((key) => !keys.includes(key as (typeof keys)[number])))
      invalid('Unexpected document file');
    for (const kind of DOCUMENT_KINDS) {
      if (Boolean(files[kind]) !== Boolean(value.documents[kind]))
        invalid('Each certificate requires its file and declared date');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify(value));
    for (const key of keys) {
      const file = files[key];
      if (!file) continue;
      validateWorkerDocument(file);
      if ((key === 'FRONT' || key === 'BACK') && file.mimetype === 'application/pdf')
        invalid('Citizen ID sides require JPEG or PNG');
      fingerprint.update(key).update(createHash('sha256').update(file.buffer).digest());
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
            action: 'WORKER_DOCUMENTS_SUBMITTED',
          },
        )
        .andWhere("a.changes->>'requestId'=:requestId", { requestId: value.requestId })
        .getOne();
      if (!audit) return null;
      if (audit.changes?.fingerprint !== hash)
        conflict('Submission request already used with different contents');
      return {
        requestId: value.requestId,
        version: Number(audit.changes.version),
        documentIds: audit.changes.documentIds as string[],
      };
    };
    const authorize = context
      ? async (manager: EntityManager) => {
          const roles = await manager.query(
            "SELECT id FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='CONTRACTOR_REPRESENTATIVE' FOR SHARE",
            [actor.id, siteId],
          );
          if (context.actorUserId !== actor.id || !roles.length) forbidden();
        }
      : undefined;
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
    const prepared = new Map<
      (typeof keys)[number],
      {
        file: DocumentUpload;
        stored: Awaited<ReturnType<StorageService['save']>>;
        ocr: DocumentOcrResult;
      }
    >();
    const adopted = new Set<string>();
    try {
      for (const key of keys) {
        const file = files[key];
        if (!file) continue;
        const format = validateWorkerDocument(file);
        const checked = await this.ocr.inspect(
          file.buffer,
          file.mimetype,
          actor.id + ':' + siteId + ':' + worker.contractorId,
        );
        const stored = await this.storage.save(file.buffer, format.mediaType, format.extension);
        prepared.set(key, { file, stored, ocr: checked.ocr });
      }
      return await executeMainConfigurationCommand(
        this.source,
        context,
        'WORKER_DOCUMENT_SUBMIT',
        { siteId, workerId, requestId: value.requestId, fingerprint: hash },
        async (manager) => {
          adopted.clear();
          const currentWorker = await this.access(manager, actor, siteId, workerId, 'submit', true);
          const retry = await replay(manager);
          if (retry) return retry;
          const profiles = manager.getRepository(WorkerComplianceProfileEntity);
          const existing = await profiles.findOneBy({ workerId });
          if ((existing?.version ?? 0) !== value.expectedVersion)
            conflict('Worker profile changed. Reload before submitting.');
          const profile = profiles.create({
            ...existing,
            workerId,
            safetyCardRequired: value.safetyCardRequired,
            version: value.expectedVersion + 1,
            ...(value.identity ?? {}),
          });
          const images = manager.getRepository(WorkerIdentityImageEntity);
          const currentImages = await images
            .createQueryBuilder('i')
            .addSelect('i.file')
            .where('i.worker_id=:workerId', { workerId })
            .getMany();
          if (profile.identityRequired) {
            if (
              !profile.nationalId ||
              !profile.phoneNumber ||
              !profile.gender ||
              !profile.address ||
              !(['FRONT', 'BACK'] as const).every(
                (side) => prepared.has(side) || currentImages.some((image) => image.side === side),
              )
            ) {
              invalid('Complete the citizen ID profile and both ID images before sending');
            }
          }
          const documents = manager.getRepository(WorkerDocumentEntity);
          const current = await documents
            .createQueryBuilder('d')
            .addSelect('d.file')
            .where('d.worker_id=:workerId', { workerId })
            .getMany();
          const today = complianceDate();
          for (const kind of DOCUMENT_KINDS) {
            if (kind === 'SAFETY_CARD' && !value.safetyCardRequired) continue;
            if (
              !prepared.has(kind) &&
              !current.some(
                (doc) =>
                  doc.kind === kind &&
                  (doc.status === 'PENDING' ||
                    (doc.status === 'APPROVED' &&
                      doc.issuedOn &&
                      doc.issuedOn <= today &&
                      doc.expiresOn &&
                      doc.expiresOn >= today)),
              )
            ) {
              invalid('Complete the required certificates before sending');
            }
          }
          await profiles.save(profile);
          const replacedIdentity: Record<string, unknown>[] = [];
          for (const side of ['FRONT', 'BACK'] as const) {
            const item = prepared.get(side);
            if (!item) continue;
            const old = currentImages.find((image) => image.side === side);
            if (old?.file.sha256 === item.stored.sha256) continue;
            if (old)
              replacedIdentity.push({
                side,
                file: old.file,
                originalName: old.originalName,
                uploadedAt: old.uploadedAt.toISOString(),
              });
            await images.save(
              images.create({
                ...(old ?? {}),
                id: old?.id ?? randomUUID(),
                workerId,
                side,
                file: item.stored,
                ocr: item.ocr,
                originalName: (item.file.originalname ?? side)
                  .replace(/[\p{Cc}\p{Cs}\\/]/gu, '_')
                  .slice(0, 255),
                uploadedAt: new Date(),
              }),
            );
            adopted.add(item.stored.storageKey);
          }
          const documentIds: string[] = [];
          for (const kind of DOCUMENT_KINDS) {
            const item = prepared.get(kind);
            if (!item) continue;
            const dates = submittedDates(kind, value.documents[kind]!, true);
            const pending = current.find((doc) => doc.kind === kind && doc.status === 'PENDING');
            if (
              pending?.file.sha256 === item.stored.sha256 &&
              pending.submittedIssuedOn === dates.submittedIssuedOn &&
              pending.submittedExpiresOn === dates.submittedExpiresOn
            ) {
              documentIds.push(pending.id);
              continue;
            }
            if (pending)
              await documents.update(pending.id, {
                status: 'SUPERSEDED',
                version: pending.version + 1,
              });
            const doc = await documents.save(
              documents.create({
                id: randomUUID(),
                workerId,
                kind,
                status: 'PENDING',
                originalName: (item.file.originalname ?? 'document')
                  .replace(/[\p{Cc}\p{Cs}\\/]/gu, '_')
                  .slice(0, 255),
                file: item.stored,
                ocr: item.ocr,
                submittedIssuedOn: dates.submittedIssuedOn,
                submittedExpiresOn: dates.submittedExpiresOn,
                issuedOn: null,
                expiresOn: null,
                reviewedAt: null,
                reviewedBy: null,
                reviewNote: null,
                uploadedBy: actor.id,
                version: 1,
              }),
            );
            documentIds.push(doc.id);
            await this.notifications.record(manager, currentWorker, doc, 'DOCUMENT_SUBMITTED');
            adopted.add(item.stored.storageKey);
          }
          await auditAccess(
            manager,
            actor.id,
            siteId,
            'WORKER_DOCUMENTS_SUBMITTED',
            'worker',
            workerId,
            null,
            {
              requestId: value.requestId,
              fingerprint: hash,
              version: profile.version,
              documentIds,
              safetyCardRequired: value.safetyCardRequired,
              replacedIdentity,
              identityChanged: Boolean(value.identity),
            },
          );
          await manager.query(
            'UPDATE site SET access_policy_version=access_policy_version+1 WHERE id=$1',
            [siteId],
          );
          return { requestId: value.requestId, version: profile.version, documentIds };
        },
        authorize,
      ).catch((error) => {
        adopted.clear();
        throw error;
      });
    } finally {
      for (const item of prepared.values()) {
        if (!adopted.has(item.stored.storageKey)) await this.storage.remove(item.stored);
      }
    }
  }

  async analyzeDocument(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    documentId: string,
  ) {
    const claim = await this.source.transaction(async (manager) => {
      const worker = await this.access(manager, actor, siteId, workerId, 'review', true);
      const docs = manager.getRepository(WorkerDocumentEntity);
      const doc = await docs
        .createQueryBuilder('d')
        .addSelect(['d.file', 'd.aiAnalysis'])
        .where('d.id=:id AND d.worker_id=:workerId', { id: uuid(documentId), workerId: worker.id })
        .getOne();
      if (!doc) missing();
      if (doc.status !== 'PENDING') conflict('Only pending documents can be analyzed.');
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
    });
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
  }

  async file(actor: WorkforceActor, siteId: string, workerId: string, documentId: string) {
    await this.access(this.source.manager, actor, siteId, workerId);
    const doc = await this.source
      .getRepository(WorkerDocumentEntity)
      .createQueryBuilder('d')
      .addSelect('d.file')
      .where('d.id=:id AND d.worker_id=:workerId', { id: uuid(documentId), workerId })
      .getOne();
    if (!doc) missing();
    return { doc, bytes: await this.storage.read(doc.file) };
  }
  async retryOcr(actor: WorkforceActor, siteId: string, workerId: string, documentId: string) {
    const safety = actor.roleAssignments.some(
      (r) => r.role === UserRole.SAFETY_OFFICER && r.siteId === siteId,
    );
    await this.access(this.source.manager, actor, siteId, workerId, safety ? 'review' : 'write');
    const { doc, bytes } = await this.file(actor, siteId, workerId, documentId);
    const ocr = await this.ocr.read(bytes, doc.file.mediaType);
    return this.source.transaction(async (manager) => {
      await this.access(manager, actor, siteId, workerId, safety ? 'review' : 'write', true);
      const row = await manager
        .getRepository(WorkerDocumentEntity)
        .createQueryBuilder('d')
        .addSelect('d.file')
        .where('d.id=:id AND d.worker_id=:workerId', { id: doc.id, workerId })
        .getOne();
      if (!row) missing();
      row.ocr = ocr;
      await manager.getRepository(WorkerDocumentEntity).save(row);
      return response(row);
    });
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
          .addSelect('d.file')
          .where('d.id=:id AND d.worker_id=:workerId', { id: uuid(documentId), workerId })
          .getOne();
        if (!doc) missing();
        if (doc.status !== 'PENDING' || doc.version !== value.expectedVersion)
          conflict('Document changed. Reload before reviewing.');
        if (value.approve) {
          const healthExpiry =
            doc.kind === 'HEALTH_CERTIFICATE' ? healthCertificateExpiry(value.issuedOn) : null;
          if (
            doc.kind === 'HEALTH_CERTIFICATE' &&
            value.expiresOn !== undefined &&
            value.expiresOn !== healthExpiry
          )
            invalid('Health certificate expiry must be one year after the examination date.');
          const expiresOn = doc.kind === 'HEALTH_CERTIFICATE' ? healthExpiry : value.expiresOn;
          const profile = await manager
            .getRepository(WorkerComplianceProfileEntity)
            .findOneBy({ workerId });
          if (
            profile?.identityRequired &&
            (await manager.getRepository(WorkerIdentityImageEntity).countBy({ workerId })) !== 2
          )
            conflict('Upload both citizen ID images before review');
          if (
            !isCalendarDate(value.issuedOn) ||
            !isCalendarDate(expiresOn) ||
            value.issuedOn > complianceDate() ||
            expiresOn < complianceDate() ||
            expiresOn < value.issuedOn
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
          doc.issuedOn = value.issuedOn;
          doc.expiresOn = expiresOn;
        }
        doc.status = value.approve ? 'APPROVED' : 'REJECTED';
        doc.reviewedAt = new Date();
        doc.reviewedBy = actor.id;
        doc.reviewNote = value.reviewNote;
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
          value.reviewNote,
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
  async checkQuality(
    actor: WorkforceActor,
    siteId: string,
    contractorId: string,
    file: DocumentUpload | undefined,
  ) {
    await this.operations.requireWorkerCreationAccess(
      this.source.manager,
      actor,
      uuid(contractorId),
      uuid(siteId),
    );
    validateWorkerDocument(file);
    const checked = await this.ocr.inspect(
      file!.buffer,
      file!.mimetype,
      actor.id + ':' + siteId + ':' + contractorId,
    );
    return { ...checked.quality, ocr: checked.ocr };
  }
  async checkWorkerQuality(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    file: DocumentUpload | undefined,
  ) {
    const worker = await this.access(this.source.manager, actor, siteId, workerId, 'submit');
    validateWorkerDocument(file);
    const checked = await this.ocr.inspect(
      file!.buffer,
      file!.mimetype,
      actor.id + ':' + siteId + ':' + worker.contractorId,
    );
    return { ...checked.quality, ocr: checked.ocr };
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

  async retryIdentityOcr(actor: WorkforceActor, siteId: string, workerId: string, id: string) {
    const mode = actor.roleAssignments.some(
      (r) => r.role === UserRole.SAFETY_OFFICER && r.siteId === siteId,
    )
      ? 'review'
      : 'write';
    await this.access(this.source.manager, actor, siteId, workerId, mode);
    const { image, bytes } = await this.identityFile(actor, siteId, workerId, id);
    const ocr = await this.ocr.read(bytes, image.file.mediaType);
    await this.source.transaction(async (manager) => {
      await this.access(manager, actor, siteId, workerId, mode, true);
      await manager
        .getRepository(WorkerIdentityImageEntity)
        .update({ id: image.id, workerId }, { ocr });
    });
    return { id: image.id };
  }
}
