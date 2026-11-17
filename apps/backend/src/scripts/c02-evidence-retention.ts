import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { parseArgs } from 'node:util';
import { isAbsolute } from 'node:path';
import { validateEnvironment, type BackendEnvironment } from '../config/environment.js';
import { StorageService } from '../integrations/storage/storage.service.js';
import {
  removeExpiredC02Evidence,
  removeOrphanedC02Evidence,
  scanC02EvidenceInventory,
} from '../modules/safety/identification/c02-evidence-inventory.js';

async function main() {
  const { values } = parseArgs({
    options: {
      schema: { type: 'string' },
      provider: { type: 'string' },
      'delete-expired': { type: 'boolean' },
      'delete-orphans': { type: 'boolean' },
    },
  });
  const { schema, provider, 'delete-expired': expired, 'delete-orphans': orphans } = values;
  if (expired && orphans) throw new Error('Choose one cleanup mode');
  const apply = expired || orphans;
  const databaseUrl = process.env.C02_RETENTION_DATABASE_URL;
  if (
    !schema ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
    !databaseUrl ||
    (provider !== 'LOCAL' && provider !== 'R2')
  )
    throw new Error('Invalid inventory target');
  const url = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.searchParams.has('options'))
    throw new Error('Invalid database URL');
  if (provider === 'LOCAL' && !isAbsolute(process.env.STORAGE_LOCAL_ROOT ?? ''))
    throw new Error('An explicit local storage root is required');
  if (
    apply &&
    (provider !== 'LOCAL' ||
      url.hostname !== '127.0.0.1' ||
      url.port !== '5433' ||
      url.pathname !== '/smartsite_test' ||
      url.username !== 'smartsite_test' ||
      !/^isolated_test_[0-9a-f]{32}$/.test(schema))
  )
    throw new Error('Deletion currently requires the isolated local test target');

  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({ ...process.env, DATABASE_URL: databaseUrl }),
  );
  const storage = new StorageService(config);
  const db = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [],
    migrations: [],
    synchronize: false,
    migrationsRun: false,
    extra: { options: '-c search_path=' + schema, connectionTimeoutMillis: 5000 },
  });
  await db.initialize();
  try {
    const [identity] = await db.query(
      `SELECT current_schema() AS schema,
       to_regclass('safety_identification_action') IS NOT NULL AS "hasReceipts",
       to_regclass('safety_identification_request') IS NOT NULL AS "hasRequests"`,
    );
    if (identity?.schema !== schema || !identity.hasReceipts || !identity.hasRequests)
      throw new Error('Database schema mismatch');
    const counts = { active: 0, expired: 0, unreferenced: 0, removed: 0 };
    if (apply) {
      const remove = orphans ? removeOrphanedC02Evidence : removeExpiredC02Evidence;
      for await (const key of remove(db.manager, storage, provider)) {
        void key;
        counts.removed++;
      }
    } else {
      for await (const batch of scanC02EvidenceInventory(db.manager, storage, provider)) {
        for (const { status } of batch) {
          if (status === 'REFERENCED_ACTIVE') counts.active++;
          if (status === 'REFERENCED_EXPIRED') counts.expired++;
          if (status === 'UNREFERENCED_C02') counts.unreferenced++;
        }
      }
    }
    process.stdout.write(
      JSON.stringify({
        mode: orphans ? 'delete-orphans' : expired ? 'delete-expired' : 'inventory',
        ...counts,
      }) + '\n',
    );
  } finally {
    await db.destroy();
  }
}

void main().catch(() => {
  process.stderr.write(
    'C02 retention command failed. Check the explicit database, schema and storage target.\n',
  );
  process.exitCode = 1;
});
