import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ZONE_ENTRY_STORAGE_NAMES,
  ZONE_ENTRY_STORAGE_FUNCTIONS,
} from '../../common/configuration/zone-entry-storage-profile-v1.js';

/** Rename storage only; preserve object identities, business payloads and history. */
export class ZoneEntryPhysicalStorage1792454400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Physical storage migration requires a transaction');
    const names = Object.entries(ZONE_ENTRY_STORAGE_NAMES);
    const pattern = new RegExp(`\\b(${names.map(([old]) => old).join('|')})\\b`, 'g');
    const rename = (sql: string) =>
      sql.replace(
        pattern,
        (old) => ZONE_ENTRY_STORAGE_NAMES[old as keyof typeof ZONE_ENTRY_STORAGE_NAMES],
      );
    const digest = (sql: string) => createHash('sha256').update(sql).digest('hex');
    const relations: { name: string; kind: string; rls: boolean }[] = await runner.query(`
      SELECT c.relname name,c.relkind kind,(c.relrowsecurity OR c.relforcerowsecurity) rls
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema()`);
    for (const [old, canonical] of names) {
      const source = relations.find((r) => r.name === old);
      if (
        !source ||
        source.kind !== 'r' ||
        source.rls ||
        relations.some((r) => r.name === canonical)
      )
        throw new Error(`Physical storage collision or incompatible source: ${old}`);
    }
    await runner.query(
      `LOCK TABLE ${names.map(([old]) => `"${old}"`).join(',')} IN ACCESS EXCLUSIVE MODE`,
    );
    const functions: { name: string; body: string; definition: string; valid: boolean }[] =
      await runner.query(
        `SELECT p.proname name,p.prosrc body,pg_get_functiondef(p.oid) definition,
        p.prokind='f' AND p.pronargs=0 AND p.prorettype='trigger'::regtype
        AND l.lanname='plpgsql' AND p.provolatile='v' AND NOT p.prosecdef
        AND NOT p.proisstrict AND NOT p.proleakproof AND p.proparallel='u'
        AND p.prosupport=0 AND p.provariadic=0 AND p.proargmodes IS NULL
        AND p.proallargtypes IS NULL AND p.pronargdefaults=0 AND p.proargdefaults IS NULL
        AND COALESCE(p.proconfig,ARRAY[]::text[])=
          (CASE WHEN f.search_path THEN ARRAY['search_path='||current_setting('search_path')]
            ELSE ARRAY[]::text[] END || CASE WHEN f.utc THEN ARRAY['TimeZone=UTC']
            ELSE ARRAY[]::text[] END) AS valid
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_language l ON l.oid=p.prolang
        LEFT JOIN jsonb_to_recordset($1::jsonb) AS f(name text,search_path boolean,utc boolean)
          ON p.proname=f.name
        WHERE n.nspname=current_schema()`,
        [JSON.stringify(ZONE_ENTRY_STORAGE_FUNCTIONS)],
      );
    for (const expected of ZONE_ENTRY_STORAGE_FUNCTIONS) {
      const actual = functions.filter((f) => f.name === expected.name);
      if (
        actual.length !== 1 ||
        !actual[0]!.valid ||
        !expected.before.includes(digest(actual[0]!.body))
      )
        throw new Error(`Physical storage function profile mismatch: ${expected.name}`);
    }
    if (
      functions.some(
        (f) =>
          rename(f.body) !== f.body &&
          !ZONE_ENTRY_STORAGE_FUNCTIONS.some((expected) => expected.name === f.name),
      )
    )
      throw new Error('Unreviewed function references old physical storage');
    for (const [old, canonical] of names)
      await runner.query(`ALTER TABLE "${old}" RENAME TO "${canonical}"`);
    for (const expected of ZONE_ENTRY_STORAGE_FUNCTIONS) {
      const actual = functions.find((f) => f.name === expected.name)!;
      await runner.query(rename(actual.definition));
      const [updated]: { body: string }[] = await runner.query(
        `SELECT p.prosrc body FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND p.proname=$1`,
        [expected.name],
      );
      if (!updated || !expected.after.includes(digest(updated.body)))
        throw new Error(`Physical storage final function profile mismatch: ${expected.name}`);
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'Physical storage is forward-only; recover using a verified database/media backup',
    );
  }
}
