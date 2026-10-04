import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationsController } from '../src/modules/workforce/notifications.controller.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import type { SchedulingNotificationService } from '../src/modules/workforce/scheduling-notification.service.js';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import { SchedulingNotificationService as NotificationService } from '../src/modules/workforce/scheduling-notification.service.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import type { DataSource } from 'typeorm';

test('Notification boundary rejects unknown filters, invalid pagination and arbitrary command bodies', async () => {
  const controller = new NotificationsController(
    undefined as unknown as SchedulingNotificationService,
  );
  const request = {} as AuthenticatedRequest;
  const invalid = (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';
  for (const query of [
    { recipientUserId: 'other' },
    { readStatus: 'READ' },
    { limit: '101' },
    { offset: '-1' },
    { limit: ['20'] },
  ]) {
    assert.throws(() => controller.list(request, query), invalid);
  }
  for (const body of [{ recipientUserId: 'other' }, [], null, 'invalid']) {
    await assert.rejects(controller.readAll(request, body), invalid);
    await assert.rejects(controller.read(request, 'invalid', body), invalid);
    await assert.rejects(controller.deleteRead(request, body, {}), invalid);
  }
  await assert.rejects(
    controller.deleteRead(request, undefined, { recipientUserId: 'other' }),
    invalid,
  );
});

test('deleting read notifications delegates only the authenticated actor', async () => {
  const actor = { id: 'current-user' };
  const controller = new NotificationsController({
    deleteRead: async (value: unknown) => {
      assert.equal(value, actor);
      return { deleted: 3 };
    },
    delete: async (value: unknown, id: string) => {
      assert.equal(value, actor);
      assert.equal(id, 'notice-1');
      return { id: 'notice-1' };
    },
  } as unknown as SchedulingNotificationService);
  assert.deepEqual(
    await controller.deleteRead({ user: actor } as AuthenticatedRequest, undefined, {}),
    { deleted: 3 },
  );
  assert.deepEqual(
    await controller.delete({ user: actor } as AuthenticatedRequest, 'notice-1', undefined),
    { id: 'notice-1' },
  );
});

test('read-notification deletion fails closed for disabled actors and unavailable permission data', async () => {
  let calls = 0;
  const service = new NotificationService({
    query: async () => {
      calls++;
      throw new Error('Synthetic database unavailable');
    },
  } as unknown as DataSource);
  const actor = {
    id: 'synthetic-user',
    isActive: true,
    mustChangePassword: false,
  } as AuthenticatedUser;
  for (const denied of [
    { ...actor, isActive: false },
    { ...actor, mustChangePassword: true },
  ]) {
    await assert.rejects(
      service.deleteRead(denied),
      (error: unknown) =>
        error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
    );
  }
  assert.equal(calls, 0);
  await assert.rejects(service.deleteRead(actor), /Synthetic database unavailable/);
  assert.equal(calls, 1);
});
