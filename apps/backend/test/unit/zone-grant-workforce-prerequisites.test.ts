import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { readZoneGrantWorkforcePrerequisites } from '../../src/modules/workforce/workforce-configuration.service.js';

const siteId = '10000000-0000-4000-8000-000000000001';
const zoneId = '10000000-0000-4000-8000-000000000002';
const workerId = '10000000-0000-4000-8000-000000000003';
const contractorId = '10000000-0000-4000-8000-000000000004';
const participationId = '10000000-0000-4000-8000-000000000005';
const otherParticipationId = '10000000-0000-4000-8000-000000000006';
const validFrom = new Date('2026-10-01T00:00:00.000Z');
const validUntil = new Date('2026-11-01T00:00:00.000Z');

function fixture(
  options: {
    participationIds?: string[];
    assignmentParticipation?: string | null;
    workerMissing?: boolean;
    contractorMissing?: boolean;
    workerContractorMissing?: boolean;
    participationFrom?: Record<string, Date>;
    participationUntil?: Record<string, Date | null>;
    assignmentFrom?: Date;
    assignmentUntil?: Date | null;
  } = {},
) {
  const assignmentQueries: Array<{
    where: Record<string, unknown>;
    lock: unknown;
    order: unknown;
  }> = [];
  const participations = (options.participationIds ?? [participationId]).map((id) => ({
    id,
    siteId,
    contractorId,
    validFrom: options.participationFrom?.[id] ?? validFrom,
    validUntil:
      options.participationUntil && id in options.participationUntil
        ? options.participationUntil[id]!
        : validUntil,
    isActive: true,
  }));
  const assignment = {
    id: '10000000-0000-4000-8000-000000000007',
    siteId,
    workerId,
    status: 'APPROVED',
    zoneIds: [zoneId],
    validFrom: options.assignmentFrom ?? validFrom,
    validUntil: options.assignmentUntil === undefined ? validUntil : options.assignmentUntil,
    siteContractorId:
      options.assignmentParticipation === undefined
        ? participationId
        : options.assignmentParticipation,
  };
  const manager = {
    getRepository(entity: { name: string }) {
      switch (entity.name) {
        case 'WorkerEntity':
          return {
            findOne: async () =>
              options.workerMissing
                ? null
                : {
                    id: workerId,
                    siteId,
                    contractorId: options.workerContractorMissing ? null : contractorId,
                    isActive: true,
                  },
          };
        case 'ContractorEntity':
          return {
            findOne: async () =>
              options.contractorMissing ? null : { id: contractorId, isActive: true },
          };
        case 'ContractorSiteParticipationEntity':
          return { find: async () => participations };
        case 'WorkerSiteZoneAssignmentEntity':
          return {
            find: async (query: {
              where: Record<string, unknown>;
              lock: unknown;
              order: unknown;
            }) => {
              assignmentQueries.push(query);
              return [assignment];
            },
          };
        default:
          throw new Error('Unexpected repository: ' + entity.name);
      }
    },
  } as unknown as EntityManager;
  return { manager, assignmentQueries };
}

test('legacy grant prerequisites bind Main assignment to participation FK and return its contractor identity', async () => {
  const { manager, assignmentQueries } = fixture();
  const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
  assert.ok(value);
  assert.equal(value?.assignmentIntervals.length, 1);
  assert.equal(value.assignmentIntervals[0]?.contractorId, contractorId);
  assert.equal(value.assignmentIntervals[0]?.workerId, workerId);
  assert.equal(value.assignmentIntervals[0]?.zoneId, zoneId);
  assert.equal(value.assignmentIntervals[0]?.validFrom, validFrom);
  assert.equal(value.assignmentIntervals[0]?.validUntil, validUntil);
  const query = assignmentQueries[0]!;
  assert.equal('contractorId' in query.where, false);
  assert.equal(query.where.siteId, siteId);
  assert.equal(query.where.workerId, workerId);
  assert.equal(query.where.status, 'APPROVED');
  assert.deepEqual((query.where.siteContractorId as { value: string[] }).value, [participationId]);
  assert.deepEqual(query.lock, { mode: 'pessimistic_read' });
  assert.deepEqual(query.order, { id: 'ASC' });
  assert.deepEqual((query.where.zoneIds as { value: string[] }).value, [zoneId]);
});

test('no active participation yields no assignment prerequisites and does not issue an unbounded assignment query', async () => {
  const { manager, assignmentQueries } = fixture({ participationIds: [] });
  const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
  assert.deepEqual(value?.participationIntervals, []);
  assert.deepEqual(value?.assignmentIntervals, []);
  assert.equal(assignmentQueries.length, 0);
});

for (const assignmentParticipation of [null, otherParticipationId]) {
  test(`unlinked assignment ${assignmentParticipation ?? 'NULL'} cannot become contractor prerequisites`, async () => {
    const { manager } = fixture({ assignmentParticipation });
    const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
    assert.deepEqual(value?.assignmentIntervals, []);
  });
}

test('a second participation cannot extend an assignment attached to the first participation', async () => {
  const boundary = new Date('2026-10-15T00:00:00.000Z');
  const { manager } = fixture({
    participationIds: [participationId, otherParticipationId],
    participationUntil: { [participationId]: boundary },
    participationFrom: { [otherParticipationId]: boundary },
  });
  const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
  assert.equal(value?.assignmentIntervals.length, 1);
  assert.equal(value?.assignmentIntervals[0]?.validUntil?.getTime(), boundary.getTime());
});

test('an assignment starting after its own participation ended yields no effective interval', async () => {
  const { manager } = fixture({
    participationUntil: { [participationId]: new Date('2026-10-15T00:00:00.000Z') },
    assignmentFrom: new Date('2026-10-20T00:00:00.000Z'),
  });
  assert.deepEqual(
    (await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId))
      ?.assignmentIntervals,
    [],
  );
});

test('an open-ended assignment remains bounded by its own finite participation', async () => {
  const { manager } = fixture({ assignmentUntil: null });
  const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
  assert.equal(value?.assignmentIntervals[0]?.validUntil?.getTime(), validUntil.getTime());
});

test('an open-ended participation does not erase the assignment end', async () => {
  const { manager } = fixture({ participationUntil: { [participationId]: null } });
  const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
  assert.equal(value?.assignmentIntervals[0]?.validUntil?.getTime(), validUntil.getTime());
});

test('a later participation start bounds the effective assignment start', async () => {
  const boundary = new Date('2026-10-15T00:00:00.000Z');
  const { manager } = fixture({ participationFrom: { [participationId]: boundary } });
  const value = await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId);
  assert.equal(value?.assignmentIntervals[0]?.validFrom.getTime(), boundary.getTime());
});

test('an active worker without a contractor remains unavailable', async () => {
  const { manager, assignmentQueries } = fixture({ workerContractorMissing: true });
  assert.equal(await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId), null);
  assert.equal(assignmentQueries.length, 0);
});

for (const missing of ['workerMissing', 'contractorMissing'] as const) {
  test(`${missing} still returns unavailable without assignment queries`, async () => {
    const { manager, assignmentQueries } = fixture({ [missing]: true });
    assert.equal(
      await readZoneGrantWorkforcePrerequisites(manager, siteId, zoneId, workerId),
      null,
    );
    assert.equal(assignmentQueries.length, 0);
  });
}
