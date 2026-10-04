import 'reflect-metadata';
import dataSource from '../database/typeorm.data-source.js';
import { SchedulingNotificationService } from '../modules/workforce/scheduling-notification.service.js';

async function main() {
  await dataSource.initialize();
  try {
    const processed = await new SchedulingNotificationService(dataSource).backfillPending();
    process.stdout.write(
      `Pending notification backfill completed: ${processed} requests processed.\n`,
    );
  } finally {
    await dataSource.destroy();
  }
}

void main().catch(() => {
  process.stderr.write(
    'Notification backfill failed; verify migrations and database access. Rerunning is safe.\n',
  );
  process.exitCode = 1;
});
