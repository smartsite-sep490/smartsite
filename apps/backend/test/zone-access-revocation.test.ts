import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { ZoneAccessManagementService } from '../src/modules/zones/zone-access-management.service.js';

test('Zone revocation rejects an invalid timestamp before database access', async () => {
  const service = new ZoneAccessManagementService(undefined as unknown as DataSource);
  for (const timestamp of [new Date(Number.NaN), '2026-10-03T08:00:00Z', null]) {
    await assert.rejects(
      service.revokeGrant(randomUUID(), randomUUID(), randomUUID(), timestamp as Date),
      (error: unknown) =>
        error instanceof PublicHttpException &&
        error.getStatus() === 400 &&
        error.publicPayload.code === 'VALIDATION_FAILED',
    );
  }
});
