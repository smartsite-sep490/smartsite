import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DATABASE_POOL, DatabaseService } from './database.service.js';

@Module({
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
  exports: [DatabaseService],
})
export class DatabaseModule {}
