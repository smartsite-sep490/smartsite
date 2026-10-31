import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { healthCertificateExpiry } from '@smartsite/contracts';
import type {
  Page,
  ReviewWorkerDocumentCommand,
  WorkerComplianceResponse,
  WorkerDocumentKind,
  WorkerDocumentResponse,
  WorkerComplianceListQuery,
  WorkerDocumentIdentityCheck,
  DocumentOcrResult,
  UploadWorkerDocumentCommand,
  UpdateWorkerDocumentExpiryCommand,
  WorkerDocumentCheckResponse,
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
  WorkerIdentityImageEntity,
} from '../../../database/entities/worker-document.entity.js';
import { WorkerEntity } from '../../../database/entities/worker.entity.js';
import { UserEntity, UserRole } from '../../../database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../../database/entities/user-role-assignment.entity.js';
import { StorageService } from '../../../integrations/storage/storage.service.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../directory/contractor-operations.service.js';
import { auditAccess } from '../shared/access-audit.js';
import {
  complianceDate,
  complianceState,
  documentReviewState,
  DOCUMENT_KINDS,
} from './worker-compliance.js';
import { DocumentOcrService, isCalendarDate } from './document-ocr.service.js';
import {
  ReviewWorkerDocumentDto,
  UploadWorkerDocumentDto,
  UpdateWorkerDocumentExpiryDto,
} from './worker-documents.commands.js';
import { DocumentNotificationsService } from './document-notifications.service.js';
import { compareDocumentDates } from './worker-document-date-check.js';

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
  input: UploadWorkerDocumentCommand | UpdateWorkerDocumentExpiryCommand,
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

@Injectable()
export class WorkerDocumentsService {
  constructor(
    private readonly source: DataSource,
    private readonly operations: ContractorOperationsService,
    private readonly storage: StorageService,
    private readonly ocr: DocumentOcrService,
    private readonly notifications: DocumentNotificationsService,
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
      mode === 'submit' &&
      worker.userId === actor.id &&
      actor.roleAssignments.some((r) => r.role === UserRole.WORKER && r.siteId === siteId)
    ) {
      const account = await manager.getRepository(UserEntity).findOneBy({
        id: actor.id,
        isActive: true,
        mustChangePassword: false,
      });
      const assigned = await manager.getRepository(UserRoleAssignmentEntity).existsBy({
        userId: actor.id,
        role: UserRole.WORKER,
        siteId,
      });
      if (!account || !assigned) forbidden();
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
    await this.operations.requireWorkerCreationAccess(manager, actor, worker.contractorId, siteId);
    return worker;
  }
  private requireDeclaredDate(actor: WorkforceActor, worker: WorkerEntity, provided: boolean) {
    if (
      worker.userId === actor.id &&
      actor.roleAssignments.some((r) => r.role === UserRole.WORKER && r.siteId === worker.siteId) &&
      !provided
    )
      invalid('Enter the document date before submitting.');
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
    await this.access(this.source.manager, actor, siteId, workerId, 'submit');
    const format = validateWorkerDocument(file);
    const quality = await this.ocr.quality(file!.buffer, format.mediaType);
    const ocr =
      quality.status === 'ACCEPTED' ? await this.ocr.read(file!.buffer, format.mediaType) : null;
    return { quality, ocr, dateCheck: compareDocumentDates(kind, manual, ocr) };
  }
  async get(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
  ): Promise<WorkerComplianceResponse> {
    const worker = await this.access(this.source.manager, actor, siteId, workerId);
    const profile = await this.source
      .getRepository(WorkerComplianceProfileEntity)
      .findOneBy({ workerId: worker.id });
    const identityImages = await this.source
      .getRepository(WorkerIdentityImageEntity)
      .createQueryBuilder('i')
      .addSelect('i.file')
      .where('i.worker_id=:workerId', { workerId })
      .getMany();
    const documents = await this.source
      .getRepository(WorkerDocumentEntity)
      .createQueryBuilder('d')
      .addSelect('d.file')
      .where('d.worker_id=:workerId', { workerId: worker.id })
      .orderBy('d.uploaded_at', 'DESC')
      .addOrderBy('d.id', 'DESC')
      .getMany();
    const state = complianceState(true, documents, new Date(), this.notifications.noticeDays);
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
      ),
      documents: documents.map((doc) => ({
        ...response(doc),
        identityCheck: compareDocumentIdentity(profile?.nationalId, doc.ocr),
      })),
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
        AND d.issued_on<=CAST(:today AS date) AND d.expires_on>=CAST(:today AS date))<3
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
          WHERE NOT EXISTS(SELECT 1 FROM worker_document d WHERE d.worker_id=w.id AND d.kind=kinds.kind AND d.status='PENDING')
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
    for (const worker of workers) items.push(await this.get(actor, siteId, worker.id));
    return { items, total };
  }
  async upload(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    kindInput: string,
    file: DocumentUpload | undefined,
    input: UploadWorkerDocumentCommand = {},
  ): Promise<WorkerDocumentResponse> {
    const value = command(UploadWorkerDocumentDto, input);
    const kind = kindValue(kindInput);
    const manual = submittedDates(kind, value);
    const submitter = await this.access(this.source.manager, actor, siteId, workerId, 'submit');
    this.requireDeclaredDate(actor, submitter, !!manual.submittedExpiresOn);
    const format = validateWorkerDocument(file);
    await this.requireQuality(file!);
    const stored = await this.storage.save(file!.buffer, format.mediaType, format.extension);
    let committed = false;
    try {
      const ocr = await this.ocr.read(file!.buffer, format.mediaType);
      const result = await this.source.transaction(async (manager) => {
        const worker = await this.access(manager, actor, siteId, workerId, 'submit', true);
        const docs = manager.getRepository(WorkerDocumentEntity);
        // Same original and unchanged metadata preserve the pending review/version.
        const pending = await docs
          .createQueryBuilder('d')
          .addSelect('d.file')
          .where('d.worker_id=:workerId AND d.kind=:kind AND d.status=:status', {
            workerId,
            kind,
            status: 'PENDING',
          })
          .getOne();
        if (pending?.file.sha256 === stored.sha256) {
          if (
            manual.provided &&
            (manual.submittedExpiresOn !== pending.submittedExpiresOn ||
              manual.submittedIssuedOn !== pending.submittedIssuedOn)
          ) {
            pending.submittedExpiresOn = manual.submittedExpiresOn;
            pending.submittedIssuedOn = manual.submittedIssuedOn;
            pending.version++;
            await docs.save(pending);
            await auditAccess(
              manager,
              actor.id,
              siteId,
              'WORKER_DOCUMENT_EXPIRY_SUBMITTED',
              'worker',
              workerId,
              null,
              {
                documentId: pending.id,
                submittedExpiresOn: pending.submittedExpiresOn,
                submittedIssuedOn: pending.submittedIssuedOn,
              },
            );
          }
          return { document: response(pending), reused: true };
        }
        if (pending)
          await docs.update(pending.id, { status: 'SUPERSEDED', version: pending.version + 1 });
        const profiles = manager.getRepository(WorkerComplianceProfileEntity);
        if (!(await profiles.existsBy({ workerId })))
          await profiles.save({ workerId, nationalId: null, phoneNumber: null });
        const doc = await docs.save(
          docs.create({
            id: randomUUID(),
            workerId,
            kind,
            status: 'PENDING',
            originalName: (file!.originalname ?? `document.${format.extension}`)
              .replace(/[\p{Cc}\p{Cs}\\/]/gu, '_')
              .slice(0, 255),
            file: stored,
            ocr,
            issuedOn: null,
            expiresOn: null,
            submittedExpiresOn: manual.submittedExpiresOn,
            submittedIssuedOn: manual.submittedIssuedOn,
            uploadedBy: actor.id,
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            version: 1,
          }),
        );
        await auditAccess(
          manager,
          actor.id,
          worker.siteId,
          'WORKER_DOCUMENT_SUBMITTED',
          'worker',
          worker.id,
          null,
          { documentId: doc.id, kind },
        );
        await this.notifications.record(manager, worker, doc, 'DOCUMENT_SUBMITTED');
        return { document: response(doc), reused: false };
      });
      committed = !result.reused;
      return result.document;
    } finally {
      if (!committed) await this.storage.remove(stored);
    }
  }
  async updateSubmittedExpiry(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    documentId: string,
    input: UpdateWorkerDocumentExpiryCommand,
  ) {
    const value = command(UpdateWorkerDocumentExpiryDto, input);
    return this.source.transaction(async (manager) => {
      await this.access(manager, actor, siteId, workerId, 'submit', true);
      const repo = manager.getRepository(WorkerDocumentEntity);
      const doc = await repo
        .createQueryBuilder('d')
        .addSelect('d.file')
        .where('d.id=:id AND d.worker_id=:workerId', { id: uuid(documentId), workerId })
        .getOne();
      if (!doc) missing();
      if (doc.status !== 'PENDING' || doc.version !== value.expectedVersion)
        conflict('Document changed. Reload before reviewing.');
      const manual = submittedDates(doc.kind, value, true);
      if (
        doc.submittedExpiresOn === manual.submittedExpiresOn &&
        doc.submittedIssuedOn === manual.submittedIssuedOn
      )
        return response(doc);
      doc.submittedExpiresOn = manual.submittedExpiresOn;
      doc.submittedIssuedOn = manual.submittedIssuedOn;
      doc.version++;
      await repo.save(doc);
      await auditAccess(
        manager,
        actor.id,
        siteId,
        'WORKER_DOCUMENT_EXPIRY_SUBMITTED',
        'worker',
        workerId,
        null,
        {
          documentId: doc.id,
          submittedExpiresOn: doc.submittedExpiresOn,
          submittedIssuedOn: doc.submittedIssuedOn,
        },
      );
      return response(doc);
    });
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
  ) {
    const value = command(ReviewWorkerDocumentDto, input);
    return this.source.transaction(async (manager) => {
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
    });
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
    return this.ocr.quality(file!.buffer, file!.mimetype);
  }
  async checkWorkerQuality(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    file: DocumentUpload | undefined,
  ) {
    await this.access(this.source.manager, actor, siteId, workerId, 'submit');
    validateWorkerDocument(file);
    return this.ocr.quality(file!.buffer, file!.mimetype);
  }
  private async requireQuality(file: DocumentUpload) {
    const quality = await this.ocr.quality(file.buffer, file.mimetype);
    if (quality.status === 'UNAVAILABLE')
      throw new PublicHttpException(503, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Document image quality service is unavailable. Retry before submitting.',
      });
    if (quality.status !== 'ACCEPTED')
      throw new PublicHttpException(422, {
        code: 'VALIDATION_FAILED',
        message: `Document image rejected: ${quality.reason}. Retake a clear image.`,
      });
  }
  async uploadIdentity(
    actor: WorkforceActor,
    siteId: string,
    workerId: string,
    side: string,
    file: DocumentUpload | undefined,
  ) {
    if (side !== 'FRONT' && side !== 'BACK') invalid('Invalid citizen ID side');
    await this.access(this.source.manager, actor, siteId, workerId, 'write');
    const format = validateWorkerDocument(file);
    if (format.mediaType === 'application/pdf') invalid('Citizen ID requires a JPEG or PNG image');
    await this.requireQuality(file!);
    const stored = await this.storage.save(file!.buffer, format.mediaType, format.extension);
    let committed = false;
    try {
      const ocr = await this.ocr.read(file!.buffer, format.mediaType);
      const result = await this.source.transaction(async (manager) => {
        const worker = await this.access(manager, actor, siteId, workerId, 'write', true);
        const repo = manager.getRepository(WorkerIdentityImageEntity);
        const existing = await repo
          .createQueryBuilder('i')
          .addSelect('i.file')
          .where('i.worker_id=:workerId AND i.side=:side', { workerId, side })
          .getOne();
        if (existing) {
          if (existing.file.sha256 !== stored.sha256)
            conflict('Citizen ID image already recorded. Reload the Worker profile.');
          if (!existing.ocr) await repo.update(existing.id, { ocr });
          return { id: existing.id, reused: true };
        }
        const image = await repo.save({
          id: randomUUID(),
          workerId,
          side: side as 'FRONT' | 'BACK',
          file: stored,
          ocr,
          originalName: (file!.originalname ?? 'citizen-id.jpg')
            .replace(/[\p{Cc}\p{Cs}\\/]/gu, '_')
            .slice(0, 255),
        });
        await auditAccess(
          manager,
          actor.id,
          worker.siteId,
          'WORKER_ID_IMAGE_SUBMITTED',
          'worker',
          worker.id,
          null,
          { side, imageId: image.id },
        );
        return { id: image.id, reused: false };
      });
      committed = !result.reused;
      return { id: result.id };
    } finally {
      if (!committed) await this.storage.remove(stored);
    }
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
