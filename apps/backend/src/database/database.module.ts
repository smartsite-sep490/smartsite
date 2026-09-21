import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../config/environment.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service.js';
import { createTypeOrmOptions } from './typeorm.options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<BackendEnvironment, true>) =>
        createTypeOrmOptions(
          config.getOrThrow('DATABASE_URL', { infer: true }),
          config.getOrThrow('DATABASE_TIMEOUT_MS', { infer: true }),
        ),
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}
