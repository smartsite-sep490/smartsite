import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationsController } from '../src/modules/workforce/notifications.controller.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import type { SchedulingNotificationService } from '../src/modules/workforce/scheduling-notification.service.js';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';

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
  }
});
