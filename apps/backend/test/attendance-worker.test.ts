import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import type { AttendanceDayEntity } from '../src/database/entities/index.js';
import { AttendanceReconciliationService } from '../src/modules/workforce/attendance-reconciliation.service.js';
import type { SchedulingNotificationService } from '../src/modules/workforce/scheduling-notification.service.js';

test('reconciliation does not skip due days beyond the first 500 records', async (t) => {
  const ids = Array.from(
    { length: 501 },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );
  let reads = 0;
  const manager = { query: async () => [] } as unknown as EntityManager;
  const source = {
    getRepository: () => ({
      find: async () => {
        const batch = reads++ === 0 ? ids.slice(0, 500) : ids.slice(500);
        return batch.map((id) => ({ id, siteId: 'synthetic-site', workerId: id }));
      },
    }),
    transaction: async (action: (value: EntityManager) => Promise<void>) => action(manager),
  } as unknown as DataSource;
  const service = new AttendanceReconciliationService(source, {} as SchedulingNotificationService);
  const refreshed: string[] = [];
  t.mock.method(service, 'refresh', async (_manager: EntityManager, id: string) => {
    refreshed.push(id);
    return { id } as AttendanceDayEntity;
  });
  await service.runDue(new Date('2026-10-08T10:05:00Z'));
  assert.deepEqual(refreshed, ids);
});
