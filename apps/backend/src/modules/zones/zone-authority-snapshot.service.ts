import type { EntityManager } from 'typeorm';
import type {
  AuthorityHistoryReadInput,
  AuthorityHistoryReadResult,
  ZoneAuthoritySnapshotReader,
} from './zone-authority-reader.port.js';
import {
  AUTHORITY_HISTORY_FACT_LIMIT,
  AUTHORITY_SNAPSHOT_BYTE_LIMIT,
  AuthorityHistoryLimitError,
} from './zone-authority-reader.port.js';
import { z } from 'zod';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  ContractorZoneAccessGrantEntity,
  ZoneAccessGrantEntity,
  ZoneAuthorityFactRevisionEntity,
  ZoneAuthorityHistoryEpochEntity,
  ZoneAuthoritySourceKind,
  ZoneEntity,
  WorkerSiteZoneAssignmentStatus,
} from '../../database/entities/index.js';
import { readWorkforceZoneAuthorityHistory } from '../workforce/workforce-zone-authority-history.query.js';
import { selectAuthorityHistory } from './zone-authority-history-selection.js';
import type { CompleteZoneAuthoritySnapshot } from './zone-authority-chain.policy.js';

const inputSchema = z.strictObject({
  siteId: z.uuid().transform((v) => v.toLowerCase()),
  zoneId: z.uuid().transform((v) => v.toLowerCase()),
  workerId: z.uuid().transform((v) => v.toLowerCase()),
  capturedAt: z.date().refine((v) => Number.isFinite(v.getTime())),
  purpose: z.enum([
    'INITIAL_OBSERVATION_ASSESSMENT',
    'RETROSPECTIVE_REVIEW',
    'REPLAY_RECORDED_ASSESSMENT',
  ]),
});

/** Not registered in runtime. Coverage attestation/cutover are separate release gates. */
export class ZoneAuthoritySnapshotService implements ZoneAuthoritySnapshotReader {
  constructor(private readonly coverage?: { writerManifestHash: string }) {}
  async read(
    manager: EntityManager,
    input: AuthorityHistoryReadInput,
  ): Promise<AuthorityHistoryReadResult> {
    const unavailable = (reason: string): AuthorityHistoryReadResult => ({
      status: 'UNAVAILABLE',
      reason,
    });
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return unavailable('INVALID_SCOPE');
    const scope = parsed.data;
    if (scope.purpose === 'REPLAY_RECORDED_ASSESSMENT')
      return unavailable('RECORDED_SNAPSHOT_REQUIRED');
    if (!manager.queryRunner?.isTransactionActive) return unavailable('TRANSACTION_REQUIRED');
    const settings: { isolation: string; now: Date }[] = await manager.query(
      "SELECT current_setting('transaction_isolation') AS isolation, statement_timestamp() AS now",
    );
    if (settings[0]?.isolation !== 'serializable')
      return unavailable('SNAPSHOT_TRANSACTION_REQUIRED');
    const readAt = settings[0].now;
    if (scope.capturedAt > readAt) return unavailable('FUTURE_OBSERVATION');
    if (!this.coverage || !/^[0-9a-f]{64}$/.test(this.coverage.writerManifestHash))
      return unavailable('COVERAGE_NOT_APPROVED');
    const epoch = await manager
      .getRepository(ZoneAuthorityHistoryEpochEntity)
      .findOneBy({ siteId: scope.siteId });
    if (!epoch || epoch.readiness !== 'READY') return unavailable('HISTORY_NOT_READY');
    if (epoch.writerManifestHash !== this.coverage.writerManifestHash)
      return unavailable('WRITER_MANIFEST_MISMATCH');
    if (scope.capturedAt < epoch.startedAt) return unavailable('BEFORE_HISTORY_EPOCH');
    try {
      const initial = selectAuthorityHistory(
        await readWorkforceZoneAuthorityHistory(manager, scope),
        scope.capturedAt,
      );
      if (initial.status !== 'SELECTED') return unavailable(initial.reason);
      const membership = initial.selected.find(
        (fact) => fact.sourceKind === ZoneAuthoritySourceKind.WORKER_MEMBERSHIP,
      );
      if (
        !membership ||
        membership.sourceKind !== ZoneAuthoritySourceKind.WORKER_MEMBERSHIP ||
        membership.payload.siteId !== scope.siteId
      )
        return unavailable('WORKER_MEMBERSHIP_UNAVAILABLE');
      const contractorId = membership.payload.contractorId;
      if (contractorId === null) return unavailable('LEGACY_CONTRACTOR_ANCHOR');
      const workforce = await readWorkforceZoneAuthorityHistory(manager, {
        ...scope,
        contractorId,
      });
      const zone = await manager
        .getRepository(ZoneEntity)
        .findOneBy({ id: scope.zoneId, siteId: scope.siteId });
      if (!zone) return unavailable('ZONE_SCOPE_UNAVAILABLE');
      const contractorGrants = await manager.getRepository(ContractorZoneAccessGrantEntity).find({
        where: { siteId: scope.siteId, zoneId: scope.zoneId, contractorId },
        order: { id: 'ASC' },
        take: AUTHORITY_HISTORY_FACT_LIMIT + 1,
      });
      const workerGrants = await manager.getRepository(ZoneAccessGrantEntity).find({
        where: { siteId: scope.siteId, zoneId: scope.zoneId, workerId: scope.workerId },
        order: { id: 'ASC' },
        take: AUTHORITY_HISTORY_FACT_LIMIT + 1,
      });
      if (contractorGrants.length + workerGrants.length > AUTHORITY_HISTORY_FACT_LIMIT)
        return unavailable('RESOURCE_LIMIT');
      const times = (row: {
        validFrom: Date;
        validUntil: Date | null;
        revokedAt: Date | null;
      }) => ({
        validFrom: row.validFrom.toISOString(),
        validUntil: row.validUntil?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      });
      const sources = [
        ...workforce.sources,
        {
          sourceKind: ZoneAuthoritySourceKind.ZONE_POLICY,
          sourceId: zone.id,
          siteId: zone.siteId,
          payload: {
            zoneId: zone.id,
            siteId: zone.siteId,
            restrictionPolicy: zone.restrictionPolicy,
          },
        },
        ...contractorGrants.map((row) => ({
          sourceKind: ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT,
          sourceId: row.id,
          siteId: row.siteId,
          payload: {
            grantId: row.id,
            siteId: row.siteId,
            zoneId: row.zoneId,
            contractorId: row.contractorId,
            effect: row.effect,
            ...times(row),
          },
        })),
        ...workerGrants.map((row) => ({
          sourceKind: ZoneAuthoritySourceKind.WORKER_ZONE_GRANT,
          sourceId: row.id,
          siteId: row.siteId,
          payload: {
            grantId: row.id,
            siteId: row.siteId,
            zoneId: row.zoneId,
            contractorId: row.contractorId,
            workerId: row.workerId,
            effect: row.effect,
            ...times(row),
          },
        })),
      ];
      const historyQuery = manager
        .getRepository(ZoneAuthorityFactRevisionEntity)
        .createQueryBuilder('fact')
        .where('(fact.sourceKind = :policy AND fact.sourceId = :zoneId)', {
          policy: ZoneAuthoritySourceKind.ZONE_POLICY,
          zoneId: scope.zoneId,
        })
        .orWhere(
          "(fact.sourceKind = :contractor AND fact.siteId = :siteId AND fact.payload->>'zoneId' = CAST(:zoneId AS text) AND fact.payload->>'contractorId' = :contractorId)",
          {
            contractor: ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT,
            siteId: scope.siteId,
            contractorId,
          },
        )
        .orWhere(
          "(fact.sourceKind = :worker AND fact.siteId = :siteId AND fact.payload->>'zoneId' = CAST(:zoneId AS text) AND fact.payload->>'workerId' = :workerId)",
          { worker: ZoneAuthoritySourceKind.WORKER_ZONE_GRANT, workerId: scope.workerId },
        );
      const grantIds = [...contractorGrants, ...workerGrants].map((row) => row.id);
      if (grantIds.length)
        historyQuery.orWhere(
          '(fact.sourceKind IN (:...grantKinds) AND fact.sourceId IN (:...grantIds))',
          {
            grantKinds: [
              ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT,
              ZoneAuthoritySourceKind.WORKER_ZONE_GRANT,
            ],
            grantIds,
          },
        );
      const zoneFacts = await historyQuery
        .orderBy('fact.sourceKind', 'ASC')
        .addOrderBy('fact.sourceId', 'ASC')
        .addOrderBy('fact.revision', 'ASC')
        .take(AUTHORITY_HISTORY_FACT_LIMIT + 1)
        .getMany();
      const selection = selectAuthorityHistory(
        { sources, facts: [...workforce.facts, ...zoneFacts] },
        scope.capturedAt,
      );
      if (selection.status !== 'SELECTED') return unavailable(selection.reason);
      const selected = selection.selected;
      const contractor = selected.find(
        (fact) =>
          fact.sourceKind === ZoneAuthoritySourceKind.CONTRACTOR_STATE &&
          fact.sourceId === contractorId,
      );
      const zonePolicy = selected.find(
        (fact) => fact.sourceKind === ZoneAuthoritySourceKind.ZONE_POLICY,
      );
      if (
        !contractor ||
        contractor.sourceKind !== ZoneAuthoritySourceKind.CONTRACTOR_STATE ||
        !zonePolicy ||
        zonePolicy.sourceKind !== ZoneAuthoritySourceKind.ZONE_POLICY
      )
        return unavailable('STATE_HISTORY_UNAVAILABLE');
      const eligible = membership.payload.isActive && contractor.payload.isActive;
      const interval = (value: {
        validFrom: string;
        validUntil: string | null;
        revokedAt?: string | null;
      }) => ({
        validFrom: new Date(value.validFrom),
        validUntil: value.validUntil === null ? null : new Date(value.validUntil),
        revokedAt: value.revokedAt == null ? null : new Date(value.revokedAt),
      });
      const scoped = {
        siteId: scope.siteId,
        zoneId: scope.zoneId,
        workerId: scope.workerId,
        contractorId,
      };
      const projection: Omit<CompleteZoneAuthoritySnapshot, 'snapshotVersion'> = {
        ...scoped,
        status: 'COMPLETE',
        participationIntervals: eligible
          ? selected.flatMap((fact) =>
              fact.sourceKind === ZoneAuthoritySourceKind.PARTICIPATION &&
              fact.payload.siteId === scope.siteId &&
              fact.payload.contractorId === contractorId &&
              fact.payload.isActive
                ? [{ ...scoped, ...interval(fact.payload) }]
                : [],
            )
          : [],
        assignmentIntervals: eligible
          ? selected.flatMap((fact) =>
              fact.sourceKind === ZoneAuthoritySourceKind.ASSIGNMENT &&
              fact.payload.siteId === scope.siteId &&
              fact.payload.workerId === scope.workerId &&
              fact.payload.contractorId === contractorId &&
              fact.payload.status === WorkerSiteZoneAssignmentStatus.APPROVED &&
              fact.payload.zoneIds.includes(scope.zoneId)
                ? [{ ...scoped, ...interval(fact.payload) }]
                : [],
            )
          : [],
        contractorGrants: selected.flatMap((fact) =>
          fact.sourceKind === ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT &&
          fact.payload.siteId === scope.siteId &&
          fact.payload.zoneId === scope.zoneId &&
          fact.payload.contractorId === contractorId
            ? [{ ...scoped, effect: fact.payload.effect, ...interval(fact.payload) }]
            : [],
        ),
        workerGrants: selected.flatMap((fact) =>
          fact.sourceKind === ZoneAuthoritySourceKind.WORKER_ZONE_GRANT &&
          fact.payload.siteId === scope.siteId &&
          fact.payload.zoneId === scope.zoneId &&
          fact.payload.workerId === scope.workerId &&
          fact.payload.contractorId === contractorId
            ? [{ ...scoped, effect: fact.payload.effect, ...interval(fact.payload) }]
            : [],
        ),
      };
      const relevantLegacy = selected.some(
        (fact) =>
          (fact.sourceKind === ZoneAuthoritySourceKind.WORKER_ZONE_GRANT &&
            fact.payload.contractorId === null) ||
          (fact.sourceKind === ZoneAuthoritySourceKind.ASSIGNMENT &&
            fact.payload.siteId === scope.siteId &&
            fact.payload.zoneIds.includes(scope.zoneId) &&
            fact.payload.contractorId === null),
      );
      if (relevantLegacy) return unavailable('LEGACY_CONTRACTOR_ANCHOR');
      // Dates converted to JSON only at the artifact boundary; policy receives typed Dates.
      const payload = JSON.parse(
        JSON.stringify({
          schemaVersion: '1.0.0',
          readerVersion: 'zone-authority-history-v1',
          purpose: scope.purpose,
          scope: scoped,
          capturedAt: scope.capturedAt,
          readAt,
          epoch: {
            siteId: epoch.siteId,
            startedAt: epoch.startedAt,
            writerManifestHash: epoch.writerManifestHash,
          },
          coverage: { method: 'SCOPED_SOURCE_CLOSURE', transactionIsolation: 'SERIALIZABLE' },
          evidence: selection.evidence,
          policyProjection: projection,
          restrictionPolicy: zonePolicy.payload.restrictionPolicy,
          eligibility: {
            workerActive: membership.payload.isActive,
            contractorActive: contractor.payload.isActive,
          },
        }),
      ) as Record<string, unknown>;
      if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > AUTHORITY_SNAPSHOT_BYTE_LIMIT)
        return unavailable('RESOURCE_LIMIT');
      const snapshotVersion = computeCanonicalPayloadHash(payload);
      return {
        status: 'COMPLETE',
        snapshot: { ...projection, snapshotVersion },
        artifact: { snapshotVersion, payload },
        restrictionPolicy: zonePolicy.payload.restrictionPolicy,
      };
    } catch (error) {
      if (error instanceof AuthorityHistoryLimitError) return unavailable('RESOURCE_LIMIT');
      // Database errors must escape to the caller transaction/retry; never complete empty history.
      throw error;
    }
  }
}
