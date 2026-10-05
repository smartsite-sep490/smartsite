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
          page.items.find((n) => n.target.requestId === request.id)?.event,
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
        (n) => n.target.requestId === request.id,
      )!;
      assert.equal(incoming.event, 'SWAP_REQUESTED');
      assert.equal(incoming.target.view, 'coworker');
      assert.equal(
        (await notifications.list(repA)).items.some((n) => n.target.requestId === request.id),
        false,
      );
      await workflow.confirmShiftSwap(workerB, siteId, request.id);
      assert.equal(
        (await notifications.list(workerA)).items.find((n) => n.target.requestId === request.id)
          ?.event,
        'SWAP_CONFIRMED',
      );
      assert.equal(
        (await notifications.list(repA)).items.find((n) => n.target.requestId === request.id)
          ?.event,
        'SWAP_CONFIRMED',
      );
      await workflow.approveShiftSwap(repA, siteId, request.id);
      for (const actor of [workerA, workerB])
        assert.ok(
          (await notifications.list(actor)).items.some(
            (n) => n.target.requestId === request.id && n.event === 'REQUEST_APPLIED',
          ),
        );
      const coworkerOutcome = (await notifications.list(workerB)).items.find(
        (n) => n.target.requestId === request.id && n.event === 'REQUEST_APPLIED',
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
        (n) => n.target.requestId === request.id,
      )!;
      assert.equal(notice.event, 'SWAP_DECLINED');
      assert.match(notice.message, /Coworker cannot attend/);
      assert.equal(
        (await notifications.list(repA)).items.some((n) => n.target.requestId === request.id),
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
          (n) => n.target.requestId === swap.id && n.event === 'REQUEST_REJECTED',
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
          (n) => n.target.requestId === change.id && n.event === 'REQUEST_REJECTED',
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
        (n) => n.target.requestId === request.id && n.event === 'REQUEST_CONFLICTED',
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
