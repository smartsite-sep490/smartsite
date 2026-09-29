import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { AlertStatus } from '../src/database/entities/enums.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { SafetyAlertAccessGuard } from '../src/modules/safety/alerts/safety-alert-access.guard.js';
import {
  canReviewTransition,
  SafetyAlertReviewService,
} from '../src/modules/safety/alerts/safety-alert-review.service.js';

test('safety alert review transition policy keeps terminal states closed', () => {
  assert.equal(
    canReviewTransition(AlertStatus.PENDING_REVIEW, AlertStatus.NEEDS_MORE_EVIDENCE),
    true,
  );
  assert.equal(canReviewTransition(AlertStatus.PENDING_REVIEW, AlertStatus.CONFIRMED), true);
  assert.equal(canReviewTransition(AlertStatus.NEEDS_MORE_EVIDENCE, AlertStatus.DISMISSED), true);
  assert.equal(
    canReviewTransition(AlertStatus.NEEDS_MORE_EVIDENCE, AlertStatus.PENDING_REVIEW),
    false,
  );
  assert.equal(canReviewTransition(AlertStatus.CONFIRMED, AlertStatus.CLOSED), false);
  assert.equal(canReviewTransition(AlertStatus.DISMISSED, AlertStatus.CONFIRMED), false);
  assert.equal(canReviewTransition(AlertStatus.CLOSED, AlertStatus.CONFIRMED), false);
});

test('SafetyAlertReviewService validates the command before database access', async () => {
  const service = new SafetyAlertReviewService(undefined as unknown as DataSource);
  const invalid = (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === 'VALIDATION_FAILED';

  await assert.rejects(
    service.review(randomUUID(), randomUUID(), randomUUID(), {
      commandId: randomUUID(),
      expectedRevision: 0,
      targetStatus: AlertStatus.DISMISSED,
      reason: ' no ',
    }),
    invalid,
  );
  await assert.rejects(
    service.review(randomUUID(), randomUUID(), randomUUID(), {
      commandId: randomUUID(),
      expectedRevision: 0,
      targetStatus: AlertStatus.CLOSED as never,
      reason: 'Incident closure is out of scope',
    }),
    invalid,
  );
});

function contextFor(input: {
  siteId: string;
  mustChangePassword?: boolean;
  assignments: Array<{ role: UserRole; siteId: string | null }>;
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        params: { siteId: input.siteId },
        user: {
          id: randomUUID(),
          username: 'reviewer',
          displayName: 'Reviewer',
          isActive: true,
          mustChangePassword: input.mustChangePassword ?? false,
          roleAssignments: input.assignments,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

test('SafetyAlertAccessGuard allows global Admin and exact-Site Safety Officer only', () => {
  const siteId = randomUUID();
  const otherSiteId = randomUUID();
  const guard = new SafetyAlertAccessGuard();

  assert.equal(
    guard.canActivate(
      contextFor({ siteId, assignments: [{ role: UserRole.ADMIN, siteId: null }] }),
    ),
    true,
  );
  assert.equal(
    guard.canActivate(
      contextFor({ siteId, assignments: [{ role: UserRole.SAFETY_OFFICER, siteId }] }),
    ),
    true,
  );
  assert.equal(
    guard.canActivate(
      contextFor({
        siteId: siteId.toUpperCase(),
        assignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
      }),
    ),
    true,
  );
  assert.throws(
    () =>
      guard.canActivate(
        contextFor({
          siteId,
          assignments: [{ role: UserRole.SAFETY_OFFICER, siteId: otherSiteId }],
        }),
      ),
    (error: unknown) =>
      error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN',
  );
  assert.throws(
    () =>
      guard.canActivate(
        contextFor({
          siteId,
          mustChangePassword: true,
          assignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
        }),
      ),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.publicPayload.code === 'PASSWORD_CHANGE_REQUIRED',
  );
});
