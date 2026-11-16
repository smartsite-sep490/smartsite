import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../../config/environment.js';

/** Readiness of the explicit combined profile; not a policy adoption or permission decision. */
@Injectable()
export class CameraPpePolicyRuntime implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly config: ConfigService<BackendEnvironment, true>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (
      this.config.get('SMARTSITE_DB_MIGRATION_PROFILE', { infer: true }) !==
      'tracked-v16-identification-ppe'
    )
      return;
    const schema = this.config.get('DATABASE_SCHEMA', { infer: true });
    const migrations = this.db.options.migrationsTableName ?? 'migrations';
    const identifier = /^[a-z_][a-z0-9_]{0,62}$/;
    try {
      if (
        !schema ||
        !identifier.test(schema) ||
        !identifier.test(migrations) ||
        this.db.driver.schema !== schema
      )
        throw new Error();
      const [state] = await this.db.query<{ ready: boolean }[]>(
        `SELECT current_schema()::text=$1::text
          AND EXISTS(SELECT 1 FROM "${schema}"."${migrations}"
            WHERE "timestamp"=1795046400010 AND "name"='CameraPpePolicyStorage1795046400010')
          AND (SELECT count(*) FROM information_schema.columns
            WHERE table_schema=$1 AND (table_name,column_name) IN (
              ('camera_configuration_bundle','schema_version'),
              ('camera_configuration_bundle','camera_ppe_policy'),
              ('camera_configuration_bundle','command_id'),
              ('camera_configuration_bundle','command_actor_id'),
              ('camera_configuration_bundle','command_request_sha256'),
              ('camera_configuration_bundle_region','ppe_policy'))) = 6
          AND (SELECT count(*) FROM pg_catalog.pg_constraint c
            JOIN pg_catalog.pg_class r ON r.oid=c.conrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=$1 AND c.convalidated AND (r.relname,c.conname) IN (
              ('camera_configuration_bundle','chk_camera_bundle_schema_version'),
              ('camera_configuration_bundle','chk_camera_bundle_ppe_mode'),
              ('camera_configuration_bundle','chk_camera_bundle_command_context'),
              ('camera_configuration_bundle','fk_camera_bundle_command_actor'),
              ('camera_configuration_bundle_region','chk_camera_bundle_region_ppe_mode'))) = 5
          AND EXISTS(SELECT 1 FROM pg_catalog.pg_index i
            JOIN pg_catalog.pg_class r ON r.oid=i.indexrelid
            JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace
            WHERE n.nspname=$1 AND r.relname='uq_camera_bundle_command_id'
              AND i.indisunique AND i.indisvalid AND i.indisready) AS ready`,
        [schema],
      );
      if (state?.ready !== true) throw new Error();
    } catch {
      throw new Error('Camera PPE database profile is unavailable');
    }
  }
}
