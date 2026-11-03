import './support/config.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntityManager } from 'typeorm';
import { SITE_GATES } from '@smartsite/contracts';
import {
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerGatePermissionEntity,
  ContractorEntity,
  ContractorSiteParticipationEntity,
  WorkerComplianceProfileEntity,
  WorkerDocumentEntity,
} from '../src/database/entities/index.js';
import { evaluateWorkerAccess } from '../src/modules/workforce/access/worker-access-evaluation.js';

const at = new Date('2026-10-11T10:00:00+07:00');
const worker = {
  id: 'worker',
  siteId: 'site',
  contractorId: 'contractor',
  isActive: true,
} as WorkerEntity;
function fixture(
  workDate: string | null,
  options: {
    overnight?: boolean;
    overtime?: boolean;
    missingShift?: boolean;
    legacyGateId?: string;
  } = {},
) {
  const builder = {
    innerJoin: () => builder,
    where: () => builder,
    getExists: async () => options.overtime ?? false,
  };
  return {
    getRepository: (entity: unknown) => {
      if (entity === WorkerComplianceProfileEntity) return { findOneBy: async () => null };
      if (entity === WorkerGatePermissionEntity) return { findBy: async () => [] };
      if (entity === WorkerDocumentEntity)
        return {
          findBy: async () =>
            ['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'].map((kind) => ({
              kind,
              status: 'APPROVED',
              issuedOn: '2020-01-01',
              expiresOn: '2099-01-01',
            })),
        };
      if (entity === WorkerSiteZoneAssignmentEntity)
        return {
          find: async () => [
            {
              id: 'assignment',
              gateId: options.legacyGateId ?? null,
              siteId: 'site',
              siteContractorId: 'participation',
              status: 'APPROVED',
              validFrom: new Date('2026-01-01'),
              validUntil: new Date('2027-01-01'),
            },
          ],
        };
      if (entity === WorkerScheduleEntity)
        return { find: async () => (workDate ? [{ shiftId: 'shift', workDate }] : []) };
      if (entity === ShiftEntity)
        return {
          findOne: async () =>
            options.missingShift
              ? null
              : {
                  startsAt: new Date(
                    options.overnight ? '2026-10-10T22:00:00+07:00' : '2026-10-10T08:00:00+07:00',
                  ),
                  endsAt: new Date(
                    options.overnight ? '2026-10-11T11:00:00+07:00' : '2026-10-10T17:00:00+07:00',
                  ),
                  timezone: 'Asia/Ho_Chi_Minh',
                },
        };
      if (entity === ContractorEntity) return { findOne: async () => ({ isActive: true }) };
      if (entity === ContractorSiteParticipationEntity)
        return {
          findOne: async () => ({
            isActive: true,
            contractorId: 'contractor',
            validFrom: new Date('2025-01-01'),
            validUntil: null,
          }),
        };
      return { createQueryBuilder: () => builder };
    },
  } as unknown as EntityManager;
}
test('entry requires a valid assignment for this workday, not merely historical or future schedules', async () => {
  for (const date of [null, '2026-10-10', '2026-10-12']) {
    const result = await evaluateWorkerAccess(fixture(date), worker, 'site', 'gate1', 'IN', at);
    assert.equal(result.scheduleStatus, 'NO_SCHEDULE');
    assert.deepEqual(result.decision, { authorization: 'DENIED', reasonCode: 'NO_SCHEDULE' });
  }
  assert.equal(
    (await evaluateWorkerAccess(fixture('2026-10-11'), worker, 'site', 'gate1', 'IN', at)).decision
      .authorization,
    'ALLOWED',
  );
});
test('overnight work and approved overtime can belong to yesterday, but departure never requires a schedule', async () => {
  for (const option of [{ overnight: true }, { overtime: true }]) {
    const result = await evaluateWorkerAccess(
      fixture('2026-10-10', option),
      worker,
      'site',
      'gate1',
      'IN',
      at,
    );
    assert.equal(result.scheduleStatus, 'SCHEDULED');
    assert.equal(result.decision.authorization, 'ALLOWED');
  }
  assert.equal(
    (await evaluateWorkerAccess(fixture(null), worker, 'site', 'gate1', 'OUT', at)).decision
      .reasonCode,
    'EXIT_RECORD_ONLY',
  );
});
test('missing shift data, cross-site and unavailable persistence never allow entry', async () => {
  assert.equal(
    (
      await evaluateWorkerAccess(
        fixture('2026-10-11', { missingShift: true }),
        worker,
        'site',
        'gate1',
        'IN',
        at,
      )
    ).decision.authorization,
    'MANUAL_REVIEW',
  );
  assert.equal(
    (await evaluateWorkerAccess(fixture('2026-10-11'), worker, 'other-site', 'gate1', 'IN', at))
      .decision.reasonCode,
    'SITE_MISMATCH',
  );
  await assert.rejects(
    evaluateWorkerAccess(
      {
        getRepository: () => {
          throw new Error('Synthetic unavailable');
        },
      } as unknown as EntityManager,
      worker,
      'site',
      'gate1',
      'IN',
      at,
    ),
    /Synthetic unavailable/,
  );
});

test('eligible workers can enter every site gate without gate grants or legacy gate restrictions', async () => {
  for (const options of [{}, { legacyGateId: 'gate-north-01' }]) {
    for (const gate of SITE_GATES) {
      const result = await evaluateWorkerAccess(
        fixture('2026-10-11', options),
        worker,
        'site',
        gate.id,
        'IN',
        at,
      );
      assert.deepEqual(result.decision, {
        authorization: 'ALLOWED',
        reasonCode: 'VALID_ASSIGNMENT',
      });
    }
  }
});

test('site-wide gate access still denies an inactive worker', async () => {
  const result = await evaluateWorkerAccess(
    fixture('2026-10-11'),
    { ...worker, isActive: false },
    'site',
    'gate-west-02',
    'IN',
    at,
  );
  assert.deepEqual(result.decision, { authorization: 'DENIED', reasonCode: 'WORKER_INACTIVE' });
});
