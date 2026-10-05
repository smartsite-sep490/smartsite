import { Mf08SafetyWorkflow1791000000000 } from './migrations/1791000000000-Mf08SafetyWorkflow.js';
import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities/index.js';
import { Mf05Mf06Foundation1789689600000 } from './migrations/1789689600000-Mf05Mf06Foundation.js';
import { CameraRegionConfiguration1790035200000 } from './migrations/1790035200000-CameraRegionConfiguration.js';
import { UserAuthentication1790121600000 } from './migrations/1790121600000-UserAuthentication.js';
import { SafetyAlertReadIndex1790467200000 } from './migrations/1790467200000-SafetyAlertReadIndex.js';
import { ScopedJwtAuthentication1790553600000 } from './migrations/1790553600000-ScopedJwtAuthentication.js';
import { Mf06ZoneAuthorization1790553600000 } from './migrations/1790553600000-Mf06ZoneAuthorization.js';
import { SafetyAlertReviews1790640000000 } from './migrations/1790640000000-SafetyAlertReviews.js';
import { ZoneEntryTrackIdRange1790812800001 } from './migrations/1790812800001-ZoneEntryTrackIdRange.js';
import { ObservationIdentityReview1790899200000 } from './migrations/1790899200000-ObservationIdentityReview.js';
import { IdentityAccessScope1790726400000 } from './migrations/1790726400000-IdentityAccessScope.js';
import { FaceEnrollmentMetadata1790812800000 } from './migrations/1790812800000-FaceEnrollmentMetadata.js';
import { AccountFaceTemplates1790899200000 } from './migrations/1790899200000-AccountFaceTemplates.js';
import { GateAccessLogs1790985600000 } from './migrations/1790985600000-GateAccessLogs.js';
import { WorkerGatePermissions1790992800000 } from './migrations/1790992800000-WorkerGatePermissions.js';

export interface DatabaseConnectionConfig {
  DATABASE_URL: string;
  DATABASE_TIMEOUT_MS?: number;
}

export function buildTypeOrmOptions(config: DatabaseConnectionConfig): DataSourceOptions {
  const timeoutMs = config.DATABASE_TIMEOUT_MS ?? 2000;
  return {
    type: 'postgres',
    url: config.DATABASE_URL,
    synchronize: false,
    migrationsRun: false,
    connectTimeoutMS: timeoutMs,
    entities: [...ENTITIES],
    migrations: [
      Mf05Mf06Foundation1789689600000,
      CameraRegionConfiguration1790035200000,
      UserAuthentication1790121600000,
      SafetyAlertReadIndex1790467200000,
      ScopedJwtAuthentication1790553600000,
      Mf06ZoneAuthorization1790553600000,
      SafetyAlertReviews1790640000000,
      IdentityAccessScope1790726400000,
      FaceEnrollmentMetadata1790812800000,
      ZoneEntryTrackIdRange1790812800001,
      AccountFaceTemplates1790899200000,
      ObservationIdentityReview1790899200000,
      GateAccessLogs1790985600000,
      WorkerGatePermissions1790992800000,
      Mf08SafetyWorkflow1791000000000,
    ],
    logging: false,
    extra: {
      max: 5,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      idleTimeoutMillis: 30000,
      application_name: 'smartsite-backend',
    },
  };
}

export function createTypeOrmOptions(databaseUrl: string, timeoutMs = 2000): DataSourceOptions {
  return buildTypeOrmOptions({
    DATABASE_URL: databaseUrl,
    DATABASE_TIMEOUT_MS: timeoutMs,
  });
}
