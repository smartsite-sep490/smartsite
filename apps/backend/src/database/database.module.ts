import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../config/environment.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service.js';
import { buildMigrationOptions } from './typeorm.migration-profile.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<BackendEnvironment, true>) =>
        buildMigrationOptions(
          {
            DATABASE_URL: config.getOrThrow('DATABASE_URL', { infer: true }),
            DATABASE_TIMEOUT_MS: config.getOrThrow('DATABASE_TIMEOUT_MS', { infer: true }),
          },
          {
            profile: config.get('SMARTSITE_DB_MIGRATION_PROFILE', { infer: true }),
            schema: config.get('DATABASE_SCHEMA', { infer: true }),
            runtime: true,
          },
        ),
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}
