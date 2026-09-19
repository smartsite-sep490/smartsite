import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService {
  constructor(private readonly dataSource: DataSource) {}

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
}
