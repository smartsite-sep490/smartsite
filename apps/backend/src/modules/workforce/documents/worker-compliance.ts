import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import type { WorkerEntity } from '../../../database/entities/worker.entity.js';
import type {
  WorkerComplianceStatus,
  WorkerDocumentKind,
  WorkerDocumentSubmissionStatus,
} from '@smartsite/contracts';
import {
  WorkerComplianceProfileEntity,
  WorkerDocumentEntity,
  WorkerIdentityImageEntity,
} from '../../../database/entities/worker-document.entity.js';

export const DOCUMENT_KINDS: readonly WorkerDocumentKind[] = [
  'SAFETY_CARD',
  'HEALTH_CERTIFICATE',
  'PERSONAL_INSURANCE',
];
export function complianceDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
export function complianceState(
  required: boolean,
  documents: Pick<WorkerDocumentEntity, 'kind' | 'status' | 'issuedOn' | 'expiresOn'>[],
  at = new Date(),
  noticeDays = 30,
) {
  const today = complianceDate(at);
  const notice = complianceDate(new Date(at.getTime() + noticeDays * 86400000));
  const approved = documents.filter((d) => d.status === 'APPROVED');
  const valid = (kind: WorkerDocumentKind) =>
    approved.find(
      (d) =>
        d.kind === kind && d.issuedOn && d.issuedOn <= today && d.expiresOn && d.expiresOn >= today,
    );
  const missingKinds = DOCUMENT_KINDS.filter((kind) => !valid(kind));
  const expiringKinds = DOCUMENT_KINDS.filter((kind) => {
    const doc = valid(kind);
    return !!doc?.expiresOn && doc.expiresOn <= notice;
  });
  const status: WorkerComplianceStatus = !required
    ? 'NOT_REQUIRED'
    : !missingKinds.length
      ? 'ACTIVE'
      : approved.some((d) => d.expiresOn && d.expiresOn < today)
        ? 'EXPIRED'
        : 'PENDING';
  return { status, missingKinds: [...missingKinds], expiringKinds: [...expiringKinds] };
}
/** Submission and requests for more documents are independent of operational eligibility. */
export function documentReviewState(
  documents: Pick<
    WorkerDocumentEntity,
    'id' | 'kind' | 'status' | 'issuedOn' | 'expiresOn' | 'uploadedAt'
  >[],
  identityComplete: boolean,
  at = new Date(),
): { submissionStatus: WorkerDocumentSubmissionStatus; needsSupplement: boolean } {
  const today = complianceDate(at);
  const submissionStatus = documents.some((doc) => doc.status === 'PENDING')
    ? 'PENDING_REVIEW'
    : documents.length
      ? 'REVIEWED'
      : 'NOT_SUBMITTED';
  const needsSupplement =
    !identityComplete ||
    DOCUMENT_KINDS.some((kind) => {
      const current = documents.filter((doc) => doc.kind === kind);
      if (current.some((doc) => doc.status === 'PENDING')) return false;
      const latest = [...current]
        .filter((doc) => doc.status !== 'SUPERSEDED')
        .sort(
          (a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime() || b.id.localeCompare(a.id),
        )[0];
      return (
        latest?.status === 'REJECTED' ||
        !current.some(
          (doc) =>
            doc.status === 'APPROVED' &&
            doc.issuedOn &&
            doc.issuedOn <= today &&
            doc.expiresOn &&
            doc.expiresOn >= today,
        )
      );
    });
  return { submissionStatus, needsSupplement };
}
function documentStatus(
  profile: WorkerComplianceProfileEntity | null | undefined,
  documents: WorkerDocumentEntity[],
  identityImages: number,
  at: Date,
): WorkerComplianceStatus {
  const state = complianceState(true, documents, at);
  if (
    state.status === 'ACTIVE' &&
    profile?.identityRequired &&
    (!profile.nationalId ||
      !profile.phoneNumber ||
      !profile.gender ||
      !profile.address ||
      identityImages !== 2)
  )
    return 'PENDING';
  return state.status;
}

export async function workerDocumentStatus(
  manager: EntityManager,
  workerId: string,
  at = new Date(),
): Promise<WorkerComplianceStatus> {
  const profile = await manager
    .getRepository(WorkerComplianceProfileEntity)
    .findOneBy({ workerId });
  const identityImages = profile?.identityRequired
    ? await manager.getRepository(WorkerIdentityImageEntity).countBy({ workerId })
    : 0;
  const documents = await manager
    .getRepository(WorkerDocumentEntity)
    .findBy({ workerId, status: 'APPROVED' });
  return documentStatus(profile, documents, identityImages, at);
}

/** Batch only after the caller has authorized the Worker IDs; never includes private files. */
export async function workerDocumentStatuses(
  manager: EntityManager,
  workerIds: string[],
  at = new Date(),
) {
  const result = new Map<string, WorkerComplianceStatus>();
  if (!workerIds.length) return result;
  const where = { workerId: In(workerIds) };
  const [profiles, documents, images] = await Promise.all([
    manager.getRepository(WorkerComplianceProfileEntity).findBy(where),
    manager.getRepository(WorkerDocumentEntity).findBy({ ...where, status: 'APPROVED' }),
    manager
      .getRepository(WorkerIdentityImageEntity)
      .find({ where, select: { workerId: true, side: true } }),
  ]);
  for (const workerId of workerIds)
    result.set(
      workerId,
      documentStatus(
        profiles.find((p) => p.workerId === workerId),
        documents.filter((d) => d.workerId === workerId),
        images.filter((i) => i.workerId === workerId).length,
        at,
      ),
    );
  return result;
}

export async function workerDocumentsAllowEntry(
  manager: EntityManager,
  workerId: string,
  at = new Date(),
) {
  return (await workerDocumentStatus(manager, workerId, at)) === 'ACTIVE';
}

export async function requireWorkerDocuments(
  manager: EntityManager,
  worker: Pick<WorkerEntity, 'id' | 'isActive'>,
) {
  if (!worker.isActive || !(await workerDocumentsAllowEntry(manager, worker.id)))
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'Worker documents must be approved and current before this operation',
    });
}
