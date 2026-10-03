import { randomUUID } from 'node:crypto';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { DataSource, type EntityManager } from 'typeorm';
import { z } from 'zod';
import { conflict, invalid, missing } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  ContractorZoneAccessGrantEntity,
  UserEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ZoneAccessEffect,
  ZoneAccessGrantEntity,
  ZoneAuthorityCommandEntity,
  ZoneAuthorityFactRevisionEntity,
  ZoneAuthoritySourceKind,
  ZoneEntity,
  ZoneRestrictionPolicy,
} from '../../database/entities/index.js';
import { withZoneAuthorityTransaction } from './zone-authority-transaction.js';

// PostgreSQL uuid has one canonical spelling; accept case-insensitive UUID input.
const id = z.uuid().transform((value) => value.toLowerCase());
const instant = z.iso.datetime({ offset: true }).refine((v) => Number.isFinite(Date.parse(v)));
const interval = { validFrom: instant, validUntil: instant.nullable() };
const scoped = { siteId: id, contractorId: id };
const grant = {
  grantId: id,
  ...scoped,
  zoneId: id,
  effect: z.enum(ZoneAccessEffect),
  ...interval,
  revokedAt: instant.nullable(),
};
const envelope = {
  sourceId: id,
  siteId: id,
  effectiveFrom: z.date(),
  effectiveTo: z.date().nullable(),
};
const payloads = {
  CONTRACTOR_STATE: z.strictObject({ contractorId: id, isActive: z.boolean() }),
  WORKER_MEMBERSHIP: z.strictObject({
    workerId: id,
    ...scoped,
    contractorId: id.nullable(),
    isActive: z.boolean(),
  }),
  PARTICIPATION: z.strictObject({
    participationId: id,
    ...scoped,
    ...interval,
    isActive: z.boolean(),
  }),
  ASSIGNMENT: z.strictObject({
    assignmentId: id,
    workerId: id,
    ...scoped,
    contractorId: id.nullable(),
    zoneIds: z
      .array(id)
      .min(1)
      .max(64)
      .refine((ids) => new Set(ids).size === ids.length),
    status: z.enum(WorkerSiteZoneAssignmentStatus),
    ...interval,
  }),
  CONTRACTOR_ZONE_GRANT: z.strictObject(grant),
  WORKER_ZONE_GRANT: z.strictObject({ ...grant, workerId: id, contractorId: id.nullable() }),
  ZONE_POLICY: z.strictObject({
    zoneId: id,
    siteId: id,
    restrictionPolicy: z.enum(ZoneRestrictionPolicy),
  }),
};
const factSchema = z.discriminatedUnion('sourceKind', [
  z.strictObject({
    ...envelope,
    siteId: z.null(),
    sourceKind: z.literal(ZoneAuthoritySourceKind.CONTRACTOR_STATE),
    payload: payloads.CONTRACTOR_STATE,
  }),
  z.strictObject({
    ...envelope,
    sourceKind: z.literal(ZoneAuthoritySourceKind.WORKER_MEMBERSHIP),
    payload: payloads.WORKER_MEMBERSHIP,
  }),
  z.strictObject({
    ...envelope,
    sourceKind: z.literal(ZoneAuthoritySourceKind.PARTICIPATION),
    payload: payloads.PARTICIPATION,
  }),
  z.strictObject({
    ...envelope,
    sourceKind: z.literal(ZoneAuthoritySourceKind.ASSIGNMENT),
    payload: payloads.ASSIGNMENT,
  }),
  z.strictObject({
    ...envelope,
    sourceKind: z.literal(ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT),
    payload: payloads.CONTRACTOR_ZONE_GRANT,
  }),
  z.strictObject({
    ...envelope,
    sourceKind: z.literal(ZoneAuthoritySourceKind.WORKER_ZONE_GRANT),
    payload: payloads.WORKER_ZONE_GRANT,
  }),
  z.strictObject({
    ...envelope,
    sourceKind: z.literal(ZoneAuthoritySourceKind.ZONE_POLICY),
    payload: payloads.ZONE_POLICY,
  }),
]);
export type ZoneAuthorityFact = z.infer<typeof factSchema>;
const sourceIdFields = {
  CONTRACTOR_STATE: 'contractorId',
  WORKER_MEMBERSHIP: 'workerId',
  PARTICIPATION: 'participationId',
  ASSIGNMENT: 'assignmentId',
  CONTRACTOR_ZONE_GRANT: 'grantId',
  WORKER_ZONE_GRANT: 'grantId',
  ZONE_POLICY: 'zoneId',
} as const;

export function parseZoneAuthorityFact(input: unknown): ZoneAuthorityFact {
  const result = factSchema.safeParse(input);
  if (!result.success) invalid('Invalid authority fact');
  const fact = result.data;
  const payload: Record<string, unknown> = fact.payload;
  if (
    payload[sourceIdFields[fact.sourceKind]] !== fact.sourceId ||
    (fact.siteId !== null && payload.siteId !== fact.siteId) ||
    (fact.effectiveTo !== null && fact.effectiveTo <= fact.effectiveFrom) ||
    Buffer.byteLength(JSON.stringify(payload), 'utf8') > 16384
  )
    invalid('Invalid authority fact scope or interval');
  if (
    'validFrom' in fact.payload &&
    fact.payload.validUntil !== null &&
    Date.parse(fact.payload.validUntil) <= Date.parse(fact.payload.validFrom)
  )
    invalid('Invalid authority validity interval');
  return fact;
}

const actorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('USER'), userId: id }),
  z.strictObject({
    kind: z.literal('SERVICE'),
    subject: z
      .string()
      .min(1)
      .max(64)
      .refine((v) => v === v.trim()),
  }),
]);
export type ZoneAuthorityActor = z.infer<typeof actorSchema>;
const commandSchema = z.strictObject({
  commandId: id,
  operation: z
    .string()
    .min(1)
    .max(64)
    .refine((v) => v === v.trim()),
  actor: actorSchema,
  request: z.record(z.string(), z.json()),
});

/** The owning module changes its projection. This protocol verifies and journals the actual rows. */
export async function executeZoneAuthorityCommand(
  source: DataSource,
  input: unknown,
  mutate: (manager: EntityManager) => Promise<readonly unknown[]>,
): Promise<{ commandId: string; replayed: boolean; facts: ZoneAuthorityFactRevisionEntity[] }> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) invalid('Invalid authority command');
  const value = parsed.data;
  if (Buffer.byteLength(JSON.stringify(value.request), 'utf8') > 65536)
    invalid('Authority command exceeds size limit');
  let requestHash: string;
  try {
    requestHash = computeCanonicalPayloadHash({
      operation: value.operation,
      actor: value.actor,
      request: value.request,
    });
  } catch (error) {
    if (error instanceof TypeError) invalid('Authority request is not interoperable JSON');
    throw error;
  }
  return withZoneAuthorityTransaction(source, async (manager) => {
    if (value.actor.kind === 'USER') {
      const user = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('actor')
        .setLock('pessimistic_read')
        .where('actor.id = :id', { id: value.actor.userId })
        .getOne();
      if (!user?.isActive || user.mustChangePassword)
        throw new PublicHttpException(403, {
          code: 'FORBIDDEN',
          message: 'Authority actor is unavailable',
        });
    }
    const inserted: { command_id: string }[] = await manager.query(
      `INSERT INTO zone_authority_command(command_id,operation,actor_kind,actor_user_id,service_subject,request_hash)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (command_id) DO NOTHING RETURNING command_id`,
      [
        value.commandId,
        value.operation,
        value.actor.kind,
        value.actor.kind === 'USER' ? value.actor.userId : null,
        value.actor.kind === 'SERVICE' ? value.actor.subject : null,
        requestHash,
      ],
    );
    if (!inserted.length) {
      const existing = await manager
        .getRepository(ZoneAuthorityCommandEntity)
        .findOneBy({ commandId: value.commandId });
      if (
        !existing ||
        existing.requestHash !== requestHash ||
        existing.operation !== value.operation
      )
        conflict('Authority command ID was already used for another request');
      const facts = await readCommandFacts(manager, value.commandId);
      if (!facts.length) conflict('Authority command has no persisted facts');
      return { commandId: value.commandId, replayed: true, facts };
    }
    const raw = await mutate(manager);
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 64)
      invalid('Authority command must contain 1 to 64 facts');
    const facts = raw
      .map(parseZoneAuthorityFact)
      .sort(
        (a, b) => a.sourceKind.localeCompare(b.sourceKind) || a.sourceId.localeCompare(b.sourceId),
      );
    const keys = facts.map((f) => `${f.sourceKind}:${f.sourceId}`);
    if (new Set(keys).size !== keys.length) invalid('Duplicate authority source in command');
    for (const fact of facts) {
      const actual = await lockProjection(manager, fact);
      // Normalize timestamptz spellings before comparing JSON; +00:00 and Z describe the same instant.
      if (
        computeCanonicalPayloadHash(normalizePayload(actual)) !==
        computeCanonicalPayloadHash(normalizePayload(fact.payload))
      )
        invalid('Authority fact does not match its source projection');
      const rows: { revision: string }[] = await manager.query(
        `SELECT COALESCE(MAX(revision),0)::text AS revision FROM zone_authority_fact_revision WHERE source_kind=$1 AND source_id=$2`,
        [fact.sourceKind, fact.sourceId],
      );
      await manager.query(
        `INSERT INTO zone_authority_fact_revision(id,command_id,source_kind,source_id,site_id,revision,effective_from,effective_to,payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [
          randomUUID(),
          value.commandId,
          fact.sourceKind,
          fact.sourceId,
          fact.siteId,
          (BigInt(rows[0]!.revision) + 1n).toString(),
          fact.effectiveFrom,
          fact.effectiveTo,
          JSON.stringify(fact.payload),
        ],
      );
    }
    return {
      commandId: value.commandId,
      replayed: false,
      facts: await readCommandFacts(manager, value.commandId),
    };
  });
}

async function readCommandFacts(manager: EntityManager, commandId: string) {
  const facts = await manager.getRepository(ZoneAuthorityFactRevisionEntity).find({
    where: { commandId },
    order: { sourceKind: 'ASC', sourceId: 'ASC' },
  });
  for (const fact of facts)
    parseZoneAuthorityFact({
      sourceKind: fact.sourceKind,
      sourceId: fact.sourceId,
      siteId: fact.siteId,
      effectiveFrom: fact.effectiveFrom,
      effectiveTo: fact.effectiveTo,
      payload: fact.payload,
    });
  return facts;
}

function normalizePayload(payload: Record<string, unknown>) {
  const copy = { ...payload };
  for (const key of ['validFrom', 'validUntil', 'revokedAt'])
    if (typeof copy[key] === 'string') copy[key] = new Date(copy[key]).toISOString();
  return copy;
}

async function lockProjection(
  manager: EntityManager,
  fact: ZoneAuthorityFact,
): Promise<Record<string, unknown>> {
  // These are database-owned registry entities, never another feature's persistence service.
  async function lock<T extends { id: string }>(entity: new () => T): Promise<T> {
    const row = await manager
      .getRepository(entity)
      .createQueryBuilder('source')
      .setLock('pessimistic_write')
      .where('source.id = :id', { id: fact.sourceId })
      .getOne();
    return row ?? missing();
  }
  const times = (row: { validFrom: Date; validUntil: Date | null }) => ({
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
  });
  switch (fact.sourceKind) {
    case ZoneAuthoritySourceKind.CONTRACTOR_STATE: {
      const row = await lock(ContractorEntity);
      return { contractorId: row.id, isActive: row.isActive };
    }
    case ZoneAuthoritySourceKind.WORKER_MEMBERSHIP: {
      const row = await lock(WorkerEntity);
      return {
        workerId: row.id,
        siteId: row.siteId,
        contractorId: row.contractorId,
        isActive: row.isActive,
      };
    }
    case ZoneAuthoritySourceKind.PARTICIPATION: {
      const row = await lock(ContractorSiteParticipationEntity);
      return {
        participationId: row.id,
        siteId: row.siteId,
        contractorId: row.contractorId,
        ...times(row),
        isActive: row.isActive,
      };
    }
    case ZoneAuthoritySourceKind.ASSIGNMENT: {
      const row = await lock(WorkerSiteZoneAssignmentEntity);
      return {
        assignmentId: row.id,
        workerId: row.workerId,
        siteId: row.siteId,
        contractorId: row.contractorId,
        zoneIds: row.zoneIds,
        status: row.status,
        ...times(row),
      };
    }
    case ZoneAuthoritySourceKind.CONTRACTOR_ZONE_GRANT: {
      const row = await lock(ContractorZoneAccessGrantEntity);
      return {
        grantId: row.id,
        siteId: row.siteId,
        zoneId: row.zoneId,
        contractorId: row.contractorId,
        effect: row.effect,
        ...times(row),
        revokedAt: row.revokedAt?.toISOString() ?? null,
      };
    }
    case ZoneAuthoritySourceKind.WORKER_ZONE_GRANT: {
      const row = await lock(ZoneAccessGrantEntity);
      return {
        grantId: row.id,
        workerId: row.workerId,
        siteId: row.siteId,
        zoneId: row.zoneId,
        contractorId: row.contractorId,
        effect: row.effect,
        ...times(row),
        revokedAt: row.revokedAt?.toISOString() ?? null,
      };
    }
    case ZoneAuthoritySourceKind.ZONE_POLICY: {
      const row = await lock(ZoneEntity);
      return { zoneId: row.id, siteId: row.siteId, restrictionPolicy: row.restrictionPolicy };
    }
  }
}
