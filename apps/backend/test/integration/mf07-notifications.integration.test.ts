import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import dataSource from '../support/test-data-source.js';
import {
  ContractorEntity,
  ContractorRepresentativeAssignmentEntity,
  ContractorShiftAssignmentEntity,
  ContractorSiteParticipationEntity,
  ScheduleVersionEntity,
  ShiftEntity,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  UserNotificationEntity,
  ShiftRequestStatus,
  ShiftChangeRequestEntity,
} from '../../src/database/entities/index.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling-workflow.service.js';
import { SchedulingNotificationService } from '../../src/modules/workforce/scheduling-notification.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { ShiftRequestReaderService } from '../../src/modules/workforce/shift-request-reader.service.js';
import { ShiftSwapRequestEntity } from '../../src/database/entities/shift-swap-request.entity.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/schedule-configuration.service.js';

test('MF07 durable notifications: delivery, scope, transactions, history and reads', async (t) => {
  await dataSource.initialize();
  t.after(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });
  const notifications = new SchedulingNotificationService(dataSource);
  const workflow = new SchedulingWorkflowService(dataSource, notifications);
  const siteId = randomUUID(),
    otherSite = randomUUID(),
    contractorId = randomUUID(),
    foreignContractor = randomUUID();
  await dataSource.getRepository(SiteEntity).save([
    { id: siteId, code: siteId, name: 'Synthetic notification site' },
    { id: otherSite, code: otherSite, name: 'Other synthetic site' },
  ]);
  await dataSource.getRepository(ContractorEntity).save([
    { id: contractorId, code: contractorId, name: 'Synthetic contractor', isActive: true },
    { id: foreignContractor, code: foreignContractor, name: 'Other contractor', isActive: true },
  ]);
  await dataSource.getRepository(ContractorSiteParticipationEntity).save([
    {
      id: randomUUID(),
      contractorId,
      siteId,
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: null,
    },
    {
      id: randomUUID(),
      contractorId: foreignContractor,
      siteId,
      isActive: true,
      validFrom: new Date('2020-01-01'),
      validUntil: null,
    },
  ]);
  async function account(role: UserRole, site = siteId, active = true): Promise<AuthenticatedUser> {
    const id = randomUUID();
    await dataSource.getRepository(UserEntity).save({
      id,
      username: id,
      displayName: 'Synthetic user',
      passwordHash: 'not-a-real-password-hash',
      isActive: active,
      mustChangePassword: false,
    });
    await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .save({ id: randomUUID(), userId: id, siteId: site, role });
    return {
      id,
      username: id,
      displayName: 'Synthetic user',
      isActive: active,
      mustChangePassword: false,
      roleAssignments: [{ siteId: site, role }],
    };
  }
  const workerA = await account(UserRole.WORKER),
    workerB = await account(UserRole.WORKER);
  const repA = await account(UserRole.CONTRACTOR_REPRESENTATIVE),
    repB = await account(UserRole.CONTRACTOR_REPRESENTATIVE);
  const wrongRep = await account(UserRole.CONTRACTOR_REPRESENTATIVE),
    wrongSiteRep = await account(UserRole.CONTRACTOR_REPRESENTATIVE, otherSite);
  const disabledRep = await account(UserRole.CONTRACTOR_REPRESENTATIVE, siteId, false);
  const unassignedRep = await account(UserRole.CONTRACTOR_REPRESENTATIVE);
  await dataSource.getRepository(ContractorRepresentativeAssignmentEntity).save([
    ...[repA, repB, disabledRep, wrongSiteRep].map((actor) => ({
      id: randomUUID(),
      userId: actor.id,
      siteId,
      contractorId,
    })),
    { id: randomUUID(), userId: wrongRep.id, siteId, contractorId: foreignContractor },
  ]);
  const aId = randomUUID(),
    bId = randomUUID();
  await dataSource.getRepository(WorkerEntity).save([
    {
      id: aId,
      siteId,
      contractorId,
      userId: workerA.id,
      externalId: aId,
      displayName: 'Synthetic Worker A',
      isActive: true,
    },
    {
      id: bId,
      siteId,
      contractorId,
      userId: workerB.id,
      externalId: bId,
      displayName: 'Synthetic Worker B',
      isActive: true,
    },
  ]);
  const morning = randomUUID(),
    evening = randomUUID(),
    version = randomUUID();
  await dataSource.getRepository(ShiftEntity).save([
    {
      id: morning,
      siteId,
      name: 'Morning',
      startsAt: new Date('2030-01-01T08:00:00Z'),
      endsAt: new Date('2030-01-01T16:00:00Z'),
      timezone: 'UTC',
    },
    {
      id: evening,
      siteId,
      name: 'Evening',
      startsAt: new Date('2030-01-01T16:00:00Z'),
      endsAt: new Date('2030-01-02T00:00:00Z'),
      timezone: 'UTC',
    },
  ]);
  await dataSource
    .getRepository(ContractorShiftAssignmentEntity)
    .save(
      [morning, evening].map((shiftId) => ({ id: randomUUID(), siteId, contractorId, shiftId })),
    );
  await dataSource.getRepository(ScheduleVersionEntity).save({
    id: version,
    siteId,
    version: 1,
    effectiveFrom: new Date('2020-01-01'),
    effectiveUntil: null,
  });
  let dateIndex = 1;
  async function schedules() {
    const workDate = `2030-01-${String(dateIndex++).padStart(2, '0')}`;
    return dataSource.getRepository(WorkerScheduleEntity).save([
      {
        id: randomUUID(),
        siteId,
        workerId: aId,
        shiftId: morning,
        scheduleVersionId: version,
        workDate,
        isActive: true,
      },
      {
        id: randomUUID(),
        siteId,
        workerId: bId,
        shiftId: evening,
        scheduleVersionId: version,
        workDate,
        isActive: true,
      },
    ]);
  }
  const code = (expected: string) => (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === expected;

  await t.test(
    'direct changes notify all eligible representatives and applied outcomes notify only the worker',
    async () => {
      const [a] = await schedules();
      const request = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: a!.id,
        toShiftId: evening,
        reason: 'Synthetic change reason',
      });
      for (const rep of [repA, repB]) {
        const page = await notifications.list(rep);
        assert.equal(
          page.items.find((n) => 'requestId' in n.target && n.target.requestId === request.id)
            ?.event,
          'CHANGE_REQUESTED',
        );
      }
      for (const actor of [workerA, workerB, wrongRep, wrongSiteRep, unassignedRep])
        assert.equal((await notifications.list(actor)).unreadCount, 0);
      assert.equal(
        await dataSource
          .getRepository(UserNotificationEntity)
          .countBy({ recipientUserId: disabledRep.id }),
        0,
      );
      const approved = await workflow.approveShiftChange(repA, siteId, request.id);
      assert.equal(approved.status, ShiftRequestStatus.APPLIED);
      const page = await notifications.list(workerA);
      assert.equal(page.items[0]?.event, 'REQUEST_APPLIED');
      assert.equal(page.items[0]?.toShiftName, 'Evening');
      assert.equal(page.items[0]?.workDate, a!.workDate);
      assert.equal(
        (await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: a!.id }))
          .shiftId,
        evening,
      );
      await assert.rejects(workflow.approveShiftChange(repA, siteId, request.id), code('CONFLICT'));
      assert.equal((await notifications.list(workerA)).unreadCount, 1);
      await assert.rejects(notifications.read(workerB, page.items[0]!.id), code('NOT_FOUND'));
      await assert.rejects(
        workflow.getShiftRequest(wrongRep, siteId, request.id, 'CHANGE'),
        code('FORBIDDEN'),
      );
      await assert.rejects(
        workflow.getShiftRequest(workerA, otherSite, request.id, 'CHANGE'),
        code('NOT_FOUND'),
      );
      assert.equal(
        (await workflow.getShiftRequest(workerA, siteId, request.id, 'CHANGE')).id,
        request.id,
      );
    },
  );

  await t.test(
    'swap confirmation and contractor approval notify both participants correctly',
    async () => {
      const [a, b] = await schedules();
      const request = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: a!.id,
        coworkerWorkerScheduleId: b!.id,
        reason: 'Synthetic swap reason',
      });
      const incoming = (await notifications.list(workerB)).items.find(
        (n) => 'requestId' in n.target && n.target.requestId === request.id,
      )!;
      assert.equal(incoming.event, 'SWAP_REQUESTED');
      assert.ok('view' in incoming.target);
      assert.equal(incoming.target.view, 'coworker');
      assert.equal(
        (await notifications.list(repA)).items.some(
          (n) => 'requestId' in n.target && n.target.requestId === request.id,
        ),
        false,
      );
      await workflow.confirmShiftSwap(workerB, siteId, request.id);
      assert.equal(
        (await notifications.list(workerA)).items.find(
          (n) => 'requestId' in n.target && n.target.requestId === request.id,
        )?.event,
        'SWAP_CONFIRMED',
      );
      assert.equal(
        (await notifications.list(repA)).items.find(
          (n) => 'requestId' in n.target && n.target.requestId === request.id,
        )?.event,
        'SWAP_CONFIRMED',
      );
      await workflow.approveShiftSwap(repA, siteId, request.id);
      for (const actor of [workerA, workerB])
        assert.ok(
          (await notifications.list(actor)).items.some(
            (n) =>
              'requestId' in n.target &&
              n.target.requestId === request.id &&
              n.event === 'REQUEST_APPLIED',
          ),
        );
      const coworkerOutcome = (await notifications.list(workerB)).items.find(
        (n) =>
          'requestId' in n.target &&
          n.target.requestId === request.id &&
          n.event === 'REQUEST_APPLIED',
      )!;
      assert.equal(coworkerOutcome.fromShiftName, 'Evening');
      assert.equal(coworkerOutcome.toShiftName, 'Morning');
      const counts = await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ requestId: request.id });
      await assert.rejects(workflow.approveShiftSwap(repB, siteId, request.id), code('CONFLICT'));
      assert.equal(
        await dataSource.getRepository(UserNotificationEntity).countBy({ requestId: request.id }),
        counts,
      );
    },
  );

  await t.test(
    'coworker decline is distinguished from contractor rejection with the review reason',
    async () => {
      const [a, b] = await schedules();
      const request = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: a!.id,
        coworkerWorkerScheduleId: b!.id,
        reason: 'Synthetic swap reason',
      });
      await workflow.declineShiftSwap(workerB, siteId, request.id, {
        reason: 'Coworker cannot attend',
      });
      const notice = (await notifications.list(workerA)).items.find(
        (n) => 'requestId' in n.target && n.target.requestId === request.id,
      )!;
      assert.equal(notice.event, 'SWAP_DECLINED');
      assert.match(notice.message, /Coworker cannot attend/);
      assert.equal(
        (await notifications.list(repA)).items.some(
          (n) => 'requestId' in n.target && n.target.requestId === request.id,
        ),
        false,
      );
      const [c, d] = await schedules();
      const swap = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: c!.id,
        coworkerWorkerScheduleId: d!.id,
        reason: 'Synthetic swap reason',
      });
      await workflow.confirmShiftSwap(workerB, siteId, swap.id);
      await workflow.rejectShiftSwap(repA, siteId, swap.id, {
        reason: 'Contractor cannot approve',
      });
      for (const actor of [workerA, workerB]) {
        const outcome = (await notifications.list(actor)).items.find(
          (n) =>
            'requestId' in n.target &&
            n.target.requestId === swap.id &&
            n.event === 'REQUEST_REJECTED',
        )!;
        assert.match(outcome.message, /Contractor cannot approve/);
      }
      const [e] = await schedules();
      const change = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: e!.id,
        toShiftId: evening,
        reason: 'Synthetic change reason',
      });
      await workflow.rejectShiftChange(repA, siteId, change.id, {
        reason: 'Contractor cannot approve',
      });
      assert.ok(
        (await notifications.list(workerA)).items.some(
          (n) =>
            'requestId' in n.target &&
            n.target.requestId === change.id &&
            n.event === 'REQUEST_REJECTED',
        ),
      );
    },
  );

  await t.test('conflicted requests never emit approval notifications', async () => {
    const [a] = await schedules();
    const request = await workflow.createShiftChange(workerA, siteId, {
      workerScheduleId: a!.id,
      toShiftId: evening,
      reason: 'Synthetic change reason',
    });
    await dataSource.getRepository(WorkerScheduleEntity).update(a!.id, { shiftId: evening });
    assert.equal(
      (await workflow.approveShiftChange(repA, siteId, request.id)).status,
      ShiftRequestStatus.CONFLICTED,
    );
    assert.ok(
      (await notifications.list(workerA)).items.some(
        (n) =>
          'requestId' in n.target &&
          n.target.requestId === request.id &&
          n.event === 'REQUEST_CONFLICTED',
      ),
    );
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ requestId: request.id, event: 'REQUEST_APPLIED' }),
      0,
    );
  });

  await t.test(
    'read and read-all are persistent, idempotent, paginated, and never transition requests',
    async () => {
      const before = await notifications.list(workerA);
      const id = before.items[0]!.id;
      const [first, second] = await Promise.all([
        notifications.read(workerA, id),
        notifications.read(workerA, id),
      ]);
      assert.equal(first.readAt, second.readAt);
      assert.equal(
        (await notifications.list(workerA, 'UNREAD')).unreadCount,
        before.unreadCount - 1,
      );
      assert.equal((await notifications.list(workerA, 'ALL', 1, 1)).items.length, 1);
      assert.equal((await notifications.list(workerA, 'ALL', 0, 1)).total, before.total);
      assert.equal((await notifications.readAll(workerA)).updated, before.unreadCount - 1);
      assert.equal((await notifications.readAll(workerA)).updated, 0);
      assert.equal(
        (await new SchedulingNotificationService(dataSource).list(workerA)).unreadCount,
        0,
      );
      await assert.rejects(notifications.list(workerA, 'INVALID'), code('VALIDATION_FAILED'));
      await assert.rejects(notifications.list(workerA, 'ALL', 0, 101), code('VALIDATION_FAILED'));
      await assert.rejects(notifications.read(workerA, 'invalid-id'), code('VALIDATION_FAILED'));
    },
  );

  await t.test(
    'backfill restores only pending tasks and is safe under repeated concurrent runs',
    async () => {
      const [a, b] = await schedules();
      const swap = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: a!.id,
        coworkerWorkerScheduleId: b!.id,
        reason: 'Synthetic swap reason',
      });
      const [c] = await schedules();
      const change = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: c!.id,
        toShiftId: evening,
        reason: 'Synthetic change reason',
      });
      await dataSource.getRepository(UserNotificationEntity).delete({ requestId: swap.id });
      await dataSource.getRepository(UserNotificationEntity).delete({ requestId: change.id });
      await Promise.all([notifications.backfillPending(), notifications.backfillPending()]);
      assert.equal(
        await dataSource.getRepository(UserNotificationEntity).countBy({ requestId: swap.id }),
        1,
      );
      assert.equal(
        await dataSource.getRepository(UserNotificationEntity).countBy({ requestId: change.id }),
        2,
      );
      const count = await dataSource.getRepository(UserNotificationEntity).count();
      await notifications.backfillPending();
      assert.equal(await dataSource.getRepository(UserNotificationEntity).count(), count);
      const pending = await dataSource
        .getRepository(ShiftChangeRequestEntity)
        .findOneByOrFail({ id: change.id });
      assert.equal(pending.status, ShiftRequestStatus.PENDING_MANAGER);
    },
  );

  await t.test('notification errors roll back schedule/request changes', async () => {
    const [a] = await schedules();
    const request = await workflow.createShiftChange(workerA, siteId, {
      workerScheduleId: a!.id,
      toShiftId: evening,
      reason: 'Synthetic change reason',
    });
    class FailingNotificationService extends SchedulingNotificationService {
      override async record(): Promise<void> {
        throw new Error('Synthetic persistence failure');
      }
    }
    await assert.rejects(
      new SchedulingWorkflowService(
        dataSource,
        new FailingNotificationService(dataSource),
      ).approveShiftChange(repA, siteId, request.id),
      /Synthetic persistence failure/,
    );
    assert.equal(
      (await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: a!.id })).shiftId,
      morning,
    );
    assert.equal(
      (await dataSource.getRepository(ShiftChangeRequestEntity).findOneByOrFail({ id: request.id }))
        .status,
      ShiftRequestStatus.PENDING_MANAGER,
    );
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ requestId: request.id, event: 'REQUEST_APPLIED' }),
      0,
    );
    await assert.rejects(
      dataSource.transaction(async (manager) => {
        await notifications.record(manager, 'CHANGE', request, 'REQUEST_APPLIED', repA.id);
        throw new Error('Synthetic rollback after insert');
      }),
      /Synthetic rollback/,
    );
    assert.equal(
      await dataSource
        .getRepository(UserNotificationEntity)
        .countBy({ requestId: request.id, event: 'REQUEST_APPLIED' }),
      0,
    );
  });

  await t.test(
    'mixed requests are filtered before paging, including old pending work beyond 60 outcomes per type',
    async () => {
      const [a, b] = await schedules();
      const pendingChange = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: a!.id,
        toShiftId: evening,
        reason: 'Old pending needle change',
      });
      await workflow.rejectShiftChange(repA, siteId, pendingChange.id, {
        reason: 'Synthetic rejection for fixture',
      });
      const [c, d] = await schedules();
      const pendingSwap = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: c!.id,
        coworkerWorkerScheduleId: d!.id,
        reason: 'Old pending needle swap',
      });
      await workflow.confirmShiftSwap(workerB, siteId, pendingSwap.id);
      const changes = Array.from({ length: 61 }, (_, index) => ({
        id: randomUUID(),
        siteId,
        workerId: aId,
        workerScheduleId: a!.id,
        fromShiftId: morning,
        toShiftId: evening,
        expectedScheduleVersionId: version,
        status: ShiftRequestStatus.REJECTED,
        requestedByUserId: workerA.id,
        reason: 'Pagination fixture needle',
        createdAt: new Date(`2031-01-01T00:00:${String(index % 60).padStart(2, '0')}Z`),
      }));
      const swaps = changes.map((change) => ({
        id: randomUUID(),
        siteId,
        requesterWorkerId: aId,
        requesterWorkerScheduleId: a!.id,
        coworkerWorkerId: bId,
        coworkerWorkerScheduleId: b!.id,
        requesterShiftId: morning,
        coworkerShiftId: evening,
        expectedScheduleVersionId: version,
        status: ShiftRequestStatus.REJECTED,
        requestedByUserId: workerA.id,
        reason: change.reason,
        createdAt: change.createdAt,
      }));
      await dataSource.getRepository(ShiftChangeRequestEntity).save(changes);
      await dataSource.getRepository(ShiftSwapRequestEntity).save(swaps);
      const reader = new ShiftRequestReaderService(dataSource);
      const seen = new Set<string>();
      for (let offset = 0; offset < 122; offset += 10) {
        const result = await reader.list(repA, siteId, {
          view: 'HISTORY',
          search: 'Pagination fixture needle',
          offset: String(offset),
          limit: '10',
        });
        assert.equal(result.total, 122);
        for (const item of result.items) {
          assert.ok(!seen.has(item.id));
          seen.add(item.id);
          assert.equal(item.siteId, siteId);
        }
      }
      assert.equal(seen.size, 122);
      const queue = await reader.list(repA, siteId, {
        view: 'REVIEW',
        search: 'Old pending needle swap',
        limit: '1',
      });
      assert.equal(queue.total, 1);
      assert.equal(queue.items[0]!.id, pendingSwap.id);
      const workerPage = await reader.list(workerB, siteId, {
        view: 'WORKER',
        search: 'Pagination fixture needle',
        offset: '60',
        limit: '10',
      });
      assert.equal(workerPage.total, 61);
      assert.equal(workerPage.items.length, 1);
      await assert.rejects(reader.list(wrongRep, siteId, { view: 'WORKER' }), code('FORBIDDEN'));
      await assert.rejects(
        reader.list(unassignedRep, siteId, { view: 'REVIEW' }),
        code('FORBIDDEN'),
      );
      await assert.rejects(reader.list(workerA, otherSite, { view: 'WORKER' }), code('FORBIDDEN'));
      await assert.rejects(
        reader.list(repA, siteId, { view: 'REVIEW', limit: '101' }),
        code('VALIDATION_FAILED'),
      );
    },
  );

  await t.test(
    'past dates cannot create, confirm or apply, while today remains editable after start time',
    async (dateTest) => {
      dateTest.mock.timers.enable({ apis: ['Date'], now: new Date('2090-01-01T23:30:00Z') });
      const [a, b] = await schedules();
      await dataSource
        .getRepository(WorkerScheduleEntity)
        .update([a!.id, b!.id], { workDate: '2029-12-31' });
      await assert.rejects(
        workflow.createShiftChange(workerA, siteId, {
          workerScheduleId: a!.id,
          toShiftId: evening,
          reason: 'Past date synthetic request',
        }),
        code('SHIFT_WORK_DATE_PASSED'),
      );
      await assert.rejects(
        workflow.createShiftSwap(workerA, siteId, {
          requesterWorkerScheduleId: a!.id,
          coworkerWorkerScheduleId: b!.id,
          reason: 'Past swap synthetic request',
        }),
        code('SHIFT_WORK_DATE_PASSED'),
      );
      await dataSource
        .getRepository(WorkerScheduleEntity)
        .update([a!.id, b!.id], { workDate: '2090-01-01' });
      const swap = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: a!.id,
        coworkerWorkerScheduleId: b!.id,
        reason: 'Today even after start time',
      });
      dateTest.mock.timers.setTime(new Date('2090-01-02T00:00:00Z').getTime());
      await assert.rejects(
        workflow.confirmShiftSwap(workerB, siteId, swap.id),
        code('SHIFT_WORK_DATE_PASSED'),
      );
      assert.equal(
        (await dataSource.getRepository(ShiftSwapRequestEntity).findOneByOrFail({ id: swap.id }))
          .status,
        ShiftRequestStatus.PENDING_COWORKER,
      );
      dateTest.mock.timers.setTime(new Date('2090-01-01T23:30:00Z').getTime());
      await workflow.confirmShiftSwap(workerB, siteId, swap.id);
      dateTest.mock.timers.setTime(new Date('2090-01-02T00:00:00Z').getTime());
      await assert.rejects(
        workflow.approveShiftSwap(repA, siteId, swap.id),
        code('SHIFT_WORK_DATE_PASSED'),
      );
      assert.equal(
        (await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: a!.id }))
          .shiftId,
        morning,
      );
      assert.equal(
        await dataSource
          .getRepository(UserNotificationEntity)
          .countBy({ requestId: swap.id, event: 'REQUEST_APPLIED' }),
        0,
      );
      const [c] = await schedules();
      await dataSource
        .getRepository(WorkerScheduleEntity)
        .update(c!.id, { workDate: '2090-01-03' });
      dateTest.mock.timers.setTime(new Date('2090-01-03T23:30:00Z').getTime());
      const change = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: c!.id,
        toShiftId: evening,
        reason: 'Today direct synthetic change',
      });
      dateTest.mock.timers.setTime(new Date('2090-01-04T00:00:00Z').getTime());
      await assert.rejects(
        workflow.approveShiftChange(repA, siteId, change.id),
        code('SHIFT_WORK_DATE_PASSED'),
      );
      dateTest.mock.timers.setTime(new Date('2090-01-03T23:30:00Z').getTime());
      assert.equal(
        (await workflow.approveShiftChange(repA, siteId, change.id)).status,
        ShiftRequestStatus.APPLIED,
      );
    },
  );

  await t.test(
    'revoked participation blocks commands, legacy lists, detail, discovery and mixed paging',
    async () => {
      const [a, b] = await schedules();
      const swap = await workflow.createShiftSwap(workerA, siteId, {
        requesterWorkerScheduleId: a!.id,
        coworkerWorkerScheduleId: b!.id,
        reason: 'Synthetic revoked scope swap',
      });
      const [c] = await schedules();
      const change = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: c!.id,
        toShiftId: evening,
        reason: 'Synthetic revoked scope change',
      });
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update({ contractorId, siteId }, { isActive: false });
      const noticeCount = await dataSource.getRepository(UserNotificationEntity).count();
      await assert.rejects(
        workflow.createShiftChange(workerA, siteId, {
          workerScheduleId: c!.id,
          toShiftId: evening,
          reason: 'Synthetic invalid participation',
        }),
        code('FORBIDDEN'),
      );
      await assert.rejects(
        workflow.createShiftSwap(workerA, siteId, {
          requesterWorkerScheduleId: a!.id,
          coworkerWorkerScheduleId: b!.id,
          reason: 'Synthetic invalid participation',
        }),
        code('FORBIDDEN'),
      );
      await assert.rejects(workflow.confirmShiftSwap(workerB, siteId, swap.id), code('FORBIDDEN'));
      await assert.rejects(
        workflow.declineShiftSwap(workerB, siteId, swap.id, { reason: 'Synthetic refusal reason' }),
        code('FORBIDDEN'),
      );
      await assert.rejects(workflow.approveShiftChange(repA, siteId, change.id), code('FORBIDDEN'));
      await assert.rejects(workflow.listShiftChangeRequests(workerA, siteId), code('FORBIDDEN'));
      await assert.rejects(workflow.listShiftSwapRequests(workerB, siteId), code('FORBIDDEN'));
      await assert.rejects(
        workflow.getShiftRequest(workerA, siteId, change.id, 'CHANGE'),
        code('FORBIDDEN'),
      );
      const reader = new ShiftRequestReaderService(dataSource);
      await assert.rejects(reader.list(workerA, siteId, { view: 'WORKER' }), code('FORBIDDEN'));
      await assert.rejects(reader.list(repA, siteId, { view: 'REVIEW' }), code('FORBIDDEN'));
      const configuration = new ScheduleConfigurationService(dataSource);
      await assert.rejects(configuration.listWorkerSchedules(workerA, siteId), code('FORBIDDEN'));
      await assert.rejects(
        configuration.listEligibleShifts(workerA, siteId, c!.id),
        code('FORBIDDEN'),
      );
      await assert.rejects(
        configuration.listSwapCandidates(workerA, siteId, c!.id),
        code('FORBIDDEN'),
      );
      assert.equal(await dataSource.getRepository(UserNotificationEntity).count(), noticeCount);
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update({ contractorId, siteId }, { isActive: true });
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update({ contractorId, siteId }, { validUntil: new Date('2025-01-01') });
      await assert.rejects(reader.list(workerA, siteId, { view: 'WORKER' }), code('FORBIDDEN'));
      await assert.rejects(workflow.confirmShiftSwap(workerB, siteId, swap.id), code('FORBIDDEN'));
      await assert.rejects(workflow.approveShiftChange(repA, siteId, change.id), code('FORBIDDEN'));
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update({ contractorId, siteId }, { validUntil: null });
    },
  );

  await t.test(
    'delete read inbox entries is scoped, idempotent and cannot be undone by delivery replay',
    async () => {
      const [a] = await schedules();
      const request = await workflow.createShiftChange(workerA, siteId, {
        workerScheduleId: a!.id,
        toShiftId: evening,
        reason: 'Synthetic dismissible request',
      });
      const notice = (await notifications.list(repA, 'ALL', 0, 100)).items.find(
        (n) => 'requestId' in n.target && n.target.requestId === request.id,
      )!;
      await notifications.read(repA, notice.id);
      const repository = dataSource.getRepository(UserNotificationEntity);
      const content = {
        siteName: 'Synthetic site',
        title: 'Synthetic deletion fixture',
        message: 'Synthetic read record',
        workDate: '2030-01-01',
        fromShiftName: 'Morning',
        toShiftName: 'Evening',
      };
      const row = (recipientUserId: string, overrides = {}) => ({
        id: randomUUID(),
        recipientUserId,
        siteId,
        contractorId,
        workerId: null,
        recipientRole: 'CONTRACTOR_REPRESENTATIVE' as const,
        requestType: 'CHANGE' as const,
        requestId: randomUUID(),
        event: 'REQUEST_REJECTED' as const,
        content,
        readAt: new Date(),
        ...overrides,
      });
      const readRows = await repository.save(Array.from({ length: 25 }, () => row(repA.id)));
      const [unread, otherAccount, otherScope] = await repository.save([
        row(repA.id, { readAt: null }),
        row(repB.id),
        row(repA.id, { siteId: otherSite }),
      ]);
      const before = await notifications.list(repA, 'ALL', 0, 100);
      const readCount = before.total - before.unreadCount;
      assert.ok(readCount >= 26);
      assert.deepEqual(await notifications.deleteRead(repA), { deleted: readCount });
      const after = await notifications.list(repA, 'ALL', 0, 100);
      assert.equal(after.total, before.unreadCount);
      assert.equal(after.unreadCount, before.unreadCount);
      assert.ok(after.items.every((n) => n.readAt === null));
      assert.deepEqual(await notifications.deleteRead(repA), { deleted: 0 });
      for (const r of [...readRows, notice])
        assert.ok((await repository.findOneByOrFail({ id: r.id })).deletedAt);
      for (const r of [unread!, otherAccount!, otherScope!])
        assert.equal((await repository.findOneByOrFail({ id: r.id })).deletedAt, null);
      const singleNotice = await repository.save(row(repA.id, { readAt: null }));
      assert.deepEqual(await notifications.delete(repA, singleNotice.id), { id: singleNotice.id });
      assert.ok((await repository.findOneByOrFail({ id: singleNotice.id })).deletedAt);
      await assert.rejects(notifications.delete(repA, singleNotice.id), code('NOT_FOUND'));
      await assert.rejects(notifications.delete(repA, otherAccount!.id), code('NOT_FOUND'));
      await assert.rejects(notifications.read(repA, notice.id), code('NOT_FOUND'));
      await dataSource.transaction(async (manager) =>
        notifications.record(
          manager,
          'CHANGE',
          request as ShiftChangeRequestEntity,
          'CHANGE_REQUESTED',
          workerA.id,
        ),
      );
      await notifications.backfillPending();
      assert.equal(
        (await notifications.list(repA, 'ALL', 0, 100)).items.some((n) => n.id === notice.id),
        false,
      );
      assert.equal(
        await repository.countBy({
          recipientUserId: repA.id,
          requestId: request.id,
          event: 'CHANGE_REQUESTED',
        }),
        1,
      );
      assert.equal(
        (await dataSource.getRepository(WorkerScheduleEntity).findOneByOrFail({ id: a!.id }))
          .shiftId,
        morning,
      );
      assert.equal(
        (
          await dataSource
            .getRepository(ShiftChangeRequestEntity)
            .findOneByOrFail({ id: request.id })
        ).status,
        ShiftRequestStatus.PENDING_MANAGER,
      );
      await assert.rejects(
        notifications.deleteRead({ ...repA, isActive: false }),
        code('FORBIDDEN'),
      );
      await assert.rejects(
        notifications.deleteRead({ ...repA, mustChangePassword: true }),
        code('FORBIDDEN'),
      );
      await notifications.read(repA, unread!.id);
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update({ siteId, contractorId }, { isActive: false });
      try {
        assert.deepEqual(await notifications.deleteRead(repA), { deleted: 0 });
        assert.equal((await repository.findOneByOrFail({ id: unread!.id })).deletedAt, null);
      } finally {
        await dataSource
          .getRepository(ContractorSiteParticipationEntity)
          .update({ siteId, contractorId }, { isActive: true });
      }
      await assert.rejects(
        repository.update({ id: otherAccount!.id }, { readAt: null, deletedAt: new Date() }),
        /chk_notification_deleted_read/,
      );
    },
  );

  await t.test(
    'revoked role, representative assignment, worker linkage and participation hide list/count/read',
    async () => {
      const notice = (await notifications.list(repB)).items[0]!;
      await dataSource
        .getRepository(ContractorRepresentativeAssignmentEntity)
        .delete({ userId: repB.id });
      assert.equal((await notifications.list(repB)).total, 0);
      await assert.rejects(notifications.read(repB, notice.id), code('NOT_FOUND'));
      await dataSource.getRepository(UserRoleAssignmentEntity).delete({ userId: repA.id });
      assert.equal((await notifications.list(repA)).unreadCount, 0);
      await dataSource.getRepository(WorkerEntity).update(bId, { userId: null });
      assert.equal((await notifications.list(workerB)).total, 0);
      await dataSource
        .getRepository(ContractorSiteParticipationEntity)
        .update({ contractorId, siteId }, { isActive: false });
      assert.equal((await notifications.list(workerA)).total, 0);
      await assert.rejects(
        notifications.list({ ...workerA, mustChangePassword: true }),
        code('FORBIDDEN'),
      );
    },
  );
});
