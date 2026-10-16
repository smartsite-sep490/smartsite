import type { DataSource } from 'typeorm';
import { QrAccess1791417600000 } from '../../src/database/migrations/1791417600000-QrAccess.js';
import { ErdVisitorAccess1791504000000 } from '../../src/database/migrations/1791504000000-ErdVisitorAccess.js';
import { ErdGateFlow1791504000001 } from '../../src/database/migrations/1791504000001-ErdGateFlow.js';
import { ErdZonePermissions1791504000003 } from '../../src/database/migrations/1791504000003-ErdZonePermissions.js';
import { ErdAccessAudit1791504000004 } from '../../src/database/migrations/1791504000004-ErdAccessAudit.js';
import { ErdAccessPolicy1791504000006 } from '../../src/database/migrations/1791504000006-ErdAccessPolicy.js';
import { Mf06MainAuthorityJournal1791590400002 } from '../../src/database/migrations/1791590400002-Mf06MainAuthorityJournal.js';

/** Legacy fixture overlay only; canonical integration schemas already applied this migration. */
export async function installMainAuthorityCandidate(db: DataSource): Promise<void> {
  if (
    db.migrations.some((migration) => migration.name === 'Mf06MainAuthorityJournal1791590400002')
  ) {
    const applied = await db.query('SELECT name FROM migrations WHERE name=$1', [
      'Mf06MainAuthorityJournal1791590400002',
    ]);
    if (applied.length !== 1) throw new Error('Canonical authority migration has not been applied');
    return;
  }
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    for (const migration of [
      new QrAccess1791417600000(),
      new ErdVisitorAccess1791504000000(),
      new ErdGateFlow1791504000001(),
      new ErdZonePermissions1791504000003(),
      new ErdAccessAudit1791504000004(),
      new ErdAccessPolicy1791504000006(),
      new Mf06MainAuthorityJournal1791590400002(),
    ])
      await migration.up(runner);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
}
