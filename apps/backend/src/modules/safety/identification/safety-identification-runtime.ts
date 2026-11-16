import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../../../config/environment.js';

/** An enabled workflow must not start healthy against an unprepared schema. */
@Injectable()
export class SafetyIdentificationRuntime implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get('SAFETY_IDENTIFICATION_ENABLED', { infer: true }) !== true) return;
    const schema = this.config.get('DATABASE_SCHEMA', { infer: true });
    const migrations = this.db.options.migrationsTableName ?? 'migrations';
    const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
    try {
      if (
        !schema ||
        !identifier.test(schema) ||
        !identifier.test(migrations) ||
        this.db.driver.schema !== schema ||
        this.config.get('SMARTSITE_DB_MIGRATION_PROFILE', { infer: true }) !==
          'tracked-v16-identification'
      ) {
        throw new Error();
      }
      const [state] = await this.db.query<{ ready: boolean }[]>(
        `SELECT current_schema()::text=$1::text
          AND EXISTS(SELECT 1 FROM "${schema}"."${migrations}"
            WHERE "timestamp"=1795046400009 AND "name"='SafetyIdentificationRequests1795046400009')
          AND to_regclass(format('%I.safety_identification_request',$1::text)) IS NOT NULL
          AND to_regclass(format('%I.safety_identification_action',$1::text)) IS NOT NULL
          AND (SELECT count(*) FROM pg_catalog.pg_constraint c
            JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=$1 AND c.contype='f' AND c.convalidated
              AND (r.relname,c.conname) IN (
                ('safety_identification_request','fk_safety_identification_episode'),
                ('safety_identification_request','fk_safety_identification_result'),
                ('safety_identification_action','fk_safety_identification_action_request'))) = 3
          AND (SELECT count(*) FROM pg_catalog.pg_trigger t
            JOIN pg_catalog.pg_class r ON r.oid=t.tgrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=$1 AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')
              AND (r.relname,t.tgname) IN (
                ('safety_identification_request','trg_safety_identification_context'),
                ('safety_identification_action','trg_safety_identification_action_immutable'))) = 2
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_index i
            JOIN pg_catalog.pg_class r ON r.oid=i.indexrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=$1 AND r.relname='uq_safety_identification_active_subject'
              AND i.indisunique AND i.indisvalid AND i.indisready) AS ready`,
        [schema],
      );
      if (state?.ready !== true) throw new Error();
    } catch {
      throw new Error('C02 database profile is unavailable');
    }
  }
}
