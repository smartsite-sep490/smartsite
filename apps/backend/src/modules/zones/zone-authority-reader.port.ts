import type { EntityManager } from 'typeorm';
import type { ZoneAuthorityFact } from './zone-authority-history.js';
import type { CompleteZoneAuthoritySnapshot } from './zone-authority-chain.policy.js';
import type { ZoneRestrictionPolicy } from '../../database/entities/enums.js';

export const AUTHORITY_HISTORY_FACT_LIMIT = 2048;
export const AUTHORITY_SNAPSHOT_BYTE_LIMIT = 2 * 1024 * 1024;

export class AuthorityHistoryLimitError extends Error {
  constructor() {
    super('Authority history resource limit exceeded');
  }
}

export type AuthorityHistoryRow = ZoneAuthorityFact & {
  id: string;
  commandId: string;
  revision: string;
  recordedAt: Date;
};

/** Current source inventory for detecting gaps, never evidence of historical state. */
export interface AuthoritySourceProjection {
  sourceKind: ZoneAuthorityFact['sourceKind'];
  sourceId: string;
  siteId: string | null;
  payload: Record<string, unknown>;
}

export interface AuthorityHistoryEvidence {
  facts: AuthorityHistoryRow[];
  sources: AuthoritySourceProjection[];
}

export interface WorkforceAuthorityHistoryScope {
  siteId: string;
  workerId: string;
  contractorId?: string;
}

export type WorkforceAuthorityHistoryQuery = (
  manager: EntityManager,
  scope: WorkforceAuthorityHistoryScope,
) => Promise<AuthorityHistoryEvidence>;

export interface AuthorityHistoryReadInput {
  siteId: string;
  zoneId: string;
  /** Already-resolved Worker reference. The reader never establishes identity. */
  workerId: string;
  capturedAt: Date;
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW' | 'REPLAY_RECORDED_ASSESSMENT';
}

export interface AuthoritySnapshotArtifact {
  snapshotVersion: string;
  /** Internal JSON suitable for B3 persistence; never an accepted FE/AI payload. */
  payload: Record<string, unknown>;
}

export type AuthorityHistoryReadResult =
  | {
      status: 'COMPLETE';
      snapshot: CompleteZoneAuthoritySnapshot;
      artifact: AuthoritySnapshotArtifact;
      restrictionPolicy: ZoneRestrictionPolicy;
    }
  | { status: 'UNAVAILABLE'; reason: string };

export interface ZoneAuthoritySnapshotReader {
  read(
    manager: EntityManager,
    input: AuthorityHistoryReadInput,
  ): Promise<AuthorityHistoryReadResult>;
}
