import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit() {
    if (this.dataSource.isInitialized) {
      this.logger.log('Database connected successfully');
    }
  }

  async isReachable(): Promise<boolean> {
    try {
      if (!this.dataSource.isInitialized) {
        return false;
      }
      await this.dataSource.query('SELECT 1');
      return true;
    } catch {
      // Connection errors may contain credentials or private database hostnames.
      return false;
    }
  }

  /**
   * Read-only release readiness, not a complete schema-drift or migration audit.
   * Never use showMigrations(): TypeORM may create its history table on that path.
   */
  async isReady(): Promise<boolean> {
    try {
      if (!this.dataSource.isInitialized || this.dataSource.options.type !== 'postgres') {
        return false;
      }
      const schema = this.dataSource.driver.schema;
      const table = this.dataSource.options.migrationsTableName ?? 'migrations';
      const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
      if (!schema || !table || schema.includes('\0') || table.includes('\0')) return false;
      const required = this.dataSource.migrations.map((migration) => {
        const name = migration.name ?? migration.constructor.name;
        return { name, timestamp: name.slice(-13) };
      });
      if (
        required.length === 0 ||
        required.some(({ name, timestamp }) => !name || !/^[0-9]{13}$/.test(timestamp)) ||
        new Set(required.map(({ name }) => name)).size !== required.length
      )
        return false;

      // Explicit schema prevents a missing history table falling through search_path.
      const rows: unknown = await this.dataSource.query(
        `SELECT "name", "timestamp" FROM ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`,
      );
      if (!Array.isArray(rows)) return false;
      return required.every(({ name, timestamp }) => {
        const matches = rows.filter(
          (row: unknown) =>
            row !== null && typeof row === 'object' && (row as { name?: unknown }).name === name,
        );
        return (
          matches.length === 1 &&
          String((matches[0] as { timestamp?: unknown }).timestamp) === timestamp
        );
      });
    } catch {
      // Missing history, unavailable connection or unsafe metadata is never ready.
      return false;
    }
  }
}
