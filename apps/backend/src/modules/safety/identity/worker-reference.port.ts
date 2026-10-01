import type { EntityManager } from 'typeorm';

export const WORKER_REFERENCE_READER = Symbol('WORKER_REFERENCE_READER');

export interface WorkerReference {
  id: string;
  siteId: string;
  externalId: string;
  displayName: string;
  isActive: boolean;
}

/** Implemented by the existing Workforce owner; no second registry or face/grant lookup. */
export interface WorkerReferenceReader {
  findForReview(
    manager: EntityManager,
    siteId: string,
    workerId: string,
    lockForResolution: boolean,
  ): Promise<WorkerReference | null>;
  listForReview(
    siteId: string,
    offset: number,
    limit: number,
  ): Promise<{ items: WorkerReference[]; total: number }>;
}
