import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import type { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { SafetyEpisodeInboxService } from '../src/modules/safety/alerts/safety-episode-inbox.service.js';

for (const key of ['siteId', 'cameraId', 'frameKey', 'readStatus', 'offset', 'limit']) {
  test(`frame Inbox rejects explicit null ${key} before opening a transaction`, async () => {
    let opened = false;
    const db = {
      transaction() {
        opened = true;
        throw new Error('Unexpected transaction');
      },
    };
    const inbox = new SafetyEpisodeInboxService(db as unknown as DataSource, {} as UserAuthGuard);
    await assert.rejects(
      inbox.listFrames({ headers: {} }, { [key]: null }),
      (error: unknown) =>
        typeof error === 'object' &&
        error !== null &&
        'getStatus' in error &&
        (error as { getStatus(): number }).getStatus() === 400,
    );
    assert.equal(opened, false);
  });
}
