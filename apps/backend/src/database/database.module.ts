import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service.js';
import { createTypeOrmOptions } from './typeorm.options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createTypeOrmOptions(
          config.getOrThrow<string>('DATABASE_URL'),
          config.getOrThrow<number>('DATABASE_TIMEOUT_MS'),
        ),
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}
