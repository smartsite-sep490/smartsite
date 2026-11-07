import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../common/configuration/main-team-authority-sources.js';
import { hasMainAuthorityCapture } from '../../common/configuration/main-authority-capture-preflight.js';
import { installAuthorityJournal } from './installAuthorityJournal.js';
import { extendAuthorityJournalToTeams } from './extendAuthorityJournalToTeams.js';

export class InstallAuthorityJournal1795046400000 implements MigrationInterface {
  name = 'InstallAuthorityJournal1795046400000';

  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Authority journal installation requires a transaction');
    const [{ schema }] = await runner.query('SELECT current_schema() AS schema');
    if (
      typeof schema !== 'string' ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
      schema.startsWith('pg_') ||
      schema === 'information_schema' ||
      schema !== runner.connection.driver.schema
    )
      throw new Error('Explicit authority journal schema required');

    await runner.query("SET LOCAL lock_timeout='5s'");
    const [{ temp_schema }] = await runner.query('SELECT pg_my_temp_schema() AS temp_schema');
    if (Number(temp_schema) !== 0) throw new Error('Temporary schema shadows are not allowed');
    const sourceNames = MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => table);
    const sources: { name: string }[] = await runner.query(
      `SELECT relname AS name FROM pg_catalog.pg_class
       WHERE relnamespace = $1::regnamespace AND relkind = 'r' AND relpersistence = 'p'
         AND relname = ANY($2::text[])`,
      [schema, sourceNames],
    );
    if (sources.length !== sourceNames.length)
      throw new Error('Authority journal sources must belong to the target schema');
    await installAuthorityJournal(runner);
    await extendAuthorityJournalToTeams(runner);
    if (!(await hasMainAuthorityCapture(runner.manager)))
      throw new Error('Installed authority journal does not match the current capture profile');
  }

  async down(): Promise<void> {
    throw new Error('Authority journal is forward-only; restore a verified backup');
  }
}
