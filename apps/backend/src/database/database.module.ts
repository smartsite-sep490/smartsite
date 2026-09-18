import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pool } from 'pg';
import { DATABASE_POOL, DatabaseService } from './database.service.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        synchronize: false,
        autoLoadEntities: true,
        connectTimeoutMS: config.getOrThrow<number>('DATABASE_TIMEOUT_MS'),
        extra: {
          max: 5,
          connectionTimeoutMillis: config.getOrThrow<number>('DATABASE_TIMEOUT_MS'),
          query_timeout: config.getOrThrow<number>('DATABASE_TIMEOUT_MS'),
          statement_timeout: config.getOrThrow<number>('DATABASE_TIMEOUT_MS'),
          idleTimeoutMillis: 30000,
          application_name: 'smartsite-backend',
        },
      }),
    }),
  ],
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const timeout = config.getOrThrow<number>('DATABASE_TIMEOUT_MS');
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: 5,
          connectionTimeoutMillis: timeout,
          query_timeout: timeout,
          statement_timeout: timeout,
          idleTimeoutMillis: 30000,
          application_name: 'smartsite-backend',
        });
        const logger = new Logger('Database');
        pool.on('error', () => logger.warn('Idle PostgreSQL connection failed'));
        return pool;
      },
    },
    DatabaseService,
  ],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}
