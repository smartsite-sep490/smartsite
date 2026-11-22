import { createHash } from 'node:crypto';
import { Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../../config/environment.js';
import { ServiceAuthGuard } from '../../modules/auth/service-auth.guard.js';
import { CameraEventAdmissionService } from '../../modules/cameras/camera-event-admission.service.js';
import { TrackedSafetyProjection } from '../../modules/safety/alerts/tracked-safety-projection.js';
import { TrackedFrameAdmission, type TrackedFrameKey } from './tracked-frame-admission.js';
import { TrackedFrameRecovery } from './tracked-frame-recovery.js';
import { TrackedSourceGapResume } from './tracked-source-gap-resume.js';
import { CamerasModule } from '../../modules/cameras/cameras.module.js';
import { CameraSourceService } from '../../modules/cameras/camera-source.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { StorageService } from '../storage/storage.service.js';
import { TrackedFrameEvidenceController } from './tracked-frame-evidence.controller.js';
import { TrackedFrameEvidenceUpload } from './tracked-frame-evidence-upload.js';
import {
  TrackedFrameResultController,
  TrackedRawPartController,
} from './tracked-frame-result.controller.js';
import { TrackedFramePrototypeStore, type TrackedPendingPolicy } from './tracked-frame-storage.js';
import {
  TrackedPartAuthenticator,
  type TrackedPartProfilePolicy,
} from './tracked-part-authentication.js';

export interface TrackedFrameRuntimeOptions {
  readonly profile: TrackedPartProfilePolicy & {
    readonly wireVersion: '1.5.0' | '1.6.0' | '1.7.0';
  };
  readonly pending: TrackedPendingPolicy;
  readonly heads: ConstructorParameters<typeof TrackedFrameAdmission>[1];
  readonly recovery: Omit<ConstructorParameters<typeof TrackedFrameRecovery>[2], 'cameraIds'> & {
    readonly automaticResume?: {
      readonly hostId: string;
      readonly minPersistentMs: number;
      readonly maxStarts: number;
    };
  };
  readonly maxRecipients: number;
}

const v16ConstraintPins = {
  'ai_observation_event.chk_ai_event_tracking_fields':
    '4fe09662a7f23611c1fec1204a2aa722f0944b7756aa4a7929ec68f05fa4d05c',
  'ai_observation_event.chk_v16_requires_tracked_route':
    '11901da3905d345db0180f02b95ed1057a423fd3c0f6d5db26c2016ca9333148',
  'camera_worker_generation.chk_generation_tracked_wire_version':
    '8e31c8279ff93c5813ea2513f62697c6c816884e53d52f454a1c01d267dd26f8',
};

const v17ConstraintPins = {
  ...v16ConstraintPins,
  'ai_observation_event.chk_ai_event_tracking_fields':
    '6f578c9510650ce74e507049f73fca5631d56d1821df7de612eb1f217b8b6fac',
  'camera_worker_generation.chk_generation_tracked_wire_version':
    '132aec098458b30551465815ae6b20ff866e7ca9f0a56d7b02a6f21ff8168549',
  'ai_observation_event.chk_v17_requires_tracked_route':
    'cf3b240fb6dfc06077b0c0e0d7348024a4f0f9089e600bc0351dd5c73e83cffb',
};

const triggerPins = {
  'ai_observation_event.trg_claim_tracked_generation_wire': {
    definition:
      'CREATE TRIGGER trg_claim_tracked_generation_wire AFTER INSERT ON <schema>.ai_observation_event FOR EACH ROW WHEN ((new.tracking_scope_sha256 IS NOT NULL)) EXECUTE FUNCTION claim_tracked_generation_wire()',
    bodySha256: 'f0f156872d863dc5532d91849bb5009e8e271b98131b352302e7d201021e56ab',
  },
  'camera_worker_generation.trg_guard_tracked_generation_wire': {
    definition:
      'CREATE TRIGGER trg_guard_tracked_generation_wire BEFORE UPDATE OF tracked_wire_version ON <schema>.camera_worker_generation FOR EACH ROW EXECUTE FUNCTION guard_tracked_generation_wire()',
    bodySha256: 'c237b598fd59438637a2451b22785271fcb58dc4d23e84d8fad58847805f20cb',
  },
};

// The tracked profile must see the reviewed forward-migration fence before binding routes.
async function requireTrackedDatabaseFence(
  db: DataSource,
  version: '1.6.0' | '1.7.0',
): Promise<void> {
  const constraintPins = version === '1.7.0' ? v17ConstraintPins : v16ConstraintPins;
  const schema = db.driver.schema;
  if (typeof schema !== 'string')
    throw new Error('Tracked database fencing is unavailable for ' + version);

  const [active] = await db.query('SELECT current_schema() AS schema');
  if (active?.schema !== schema)
    throw new Error('Tracked database connection does not match its selected schema');

  const rows = await db.query<
    {
      key: string;
      definition: string;
      body: string | null;
    }[]
  >(
    `SELECT r.relname || '.' || c.conname AS key, pg_get_constraintdef(c.oid) AS definition,
            NULL::text AS body
       FROM pg_catalog.pg_constraint c
       JOIN pg_catalog.pg_class r ON r.oid = c.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = $1 AND n.nspname = current_schema()
        AND current_setting('session_replication_role') = 'origin'
        AND c.contype = 'c' AND c.convalidated
        AND r.relname || '.' || c.conname = ANY($2::text[])
      UNION ALL
     SELECT r.relname || '.' || t.tgname AS key, pg_get_triggerdef(t.oid) AS definition, p.prosrc AS body
       FROM pg_catalog.pg_trigger t
       JOIN pg_catalog.pg_class r ON r.oid = t.tgrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = r.relnamespace
       JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
       JOIN pg_catalog.pg_language l ON l.oid = p.prolang
      WHERE n.nspname = $1 AND n.nspname = current_schema()
        AND current_setting('session_replication_role') = 'origin'
        AND NOT t.tgisinternal AND t.tgenabled IN ('O', 'A')
        AND p.pronamespace = n.oid AND 'trg_' || p.proname = t.tgname
        AND NOT p.prosecdef AND p.proconfig IS NULL AND l.lanname = 'plpgsql'
        AND r.relname || '.' || t.tgname = ANY($3::text[])`,
    [schema, Object.keys(constraintPins), Object.keys(triggerPins)],
  );

  const byKey = new Map(rows.map((row) => [row.key, row]));
  const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
  const constraintsMatch = Object.entries(constraintPins).every(([key, pin]) => {
    const row = byKey.get(key);
    return row?.body === null && sha256(row.definition) === pin;
  });
  const triggersMatch = Object.entries(triggerPins).every(([key, pin]) => {
    const row = byKey.get(key);
    return (
      typeof row?.body === 'string' &&
      row.definition
        .replaceAll('"' + schema + '".', '<schema>.')
        .replaceAll(schema + '.', '<schema>.') === pin.definition &&
      sha256(row.body.replaceAll('"' + schema + '".', '"<schema>".')) === pin.bodySha256
    );
  });
  if (!constraintsMatch || !triggersMatch)
    throw new Error('Tracked database fencing is unavailable for ' + version);
}

class TrackedDatabaseFence implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly version: '1.6.0' | '1.7.0',
  ) {}

  async onModuleInit(): Promise<void> {
    await requireTrackedDatabaseFence(this.db, this.version);
  }
}

/** Composition for a server-owned policy. The application does not register an enabled instance. */
@Module({})
export class TrackedFrameRuntimeModule {
  static register(options?: TrackedFrameRuntimeOptions): DynamicModule {
    if (options === undefined) return { module: TrackedFrameRuntimeModule };
    if (!options.profile || !['1.5.0', '1.6.0', '1.7.0'].includes(options.profile.wireVersion))
      throw new Error('An explicit tracked wire version is required');
    const { profile, pending, heads, recovery, maxRecipients } = structuredClone(options);
    const { automaticResume, ...frameRecovery } = recovery;
    return {
      module: TrackedFrameRuntimeModule,
      imports: [StorageModule, ...(automaticResume ? [CamerasModule] : [])],
      controllers: [
        TrackedRawPartController,
        TrackedFrameResultController,
        TrackedFrameEvidenceController,
      ],
      providers: [
        ServiceAuthGuard,
        {
          provide: TrackedPartAuthenticator,
          useFactory: () =>
            new TrackedPartAuthenticator(new CameraEventAdmissionService(), profile),
        },
        {
          provide: TrackedFramePrototypeStore,
          inject: [TrackedPartAuthenticator],
          useFactory: (auth: TrackedPartAuthenticator) =>
            new TrackedFramePrototypeStore(auth, pending),
        },
        {
          provide: TrackedFrameEvidenceUpload,
          inject: [TrackedPartAuthenticator, StorageService, ConfigService],
          useFactory: (
            auth: TrackedPartAuthenticator,
            storage: StorageService,
            config: ConfigService<BackendEnvironment, true>,
          ) =>
            new TrackedFrameEvidenceUpload(
              auth,
              storage,
              config.get('AI_EVIDENCE_OBJECT_STORAGE_ENABLED', { infer: true }) === true,
            ),
        },
        ...(profile.wireVersion !== '1.5.0'
          ? [
              {
                provide: TrackedDatabaseFence,
                inject: [DataSource],
                useFactory: (db: DataSource) =>
                  new TrackedDatabaseFence(db, profile.wireVersion as '1.6.0' | '1.7.0'),
              },
            ]
          : []),
        {
          provide: TrackedFrameAdmission,
          inject: [TrackedPartAuthenticator, DataSource, ConfigService],
          useFactory: (
            auth: TrackedPartAuthenticator,
            db: DataSource,
            config: ConfigService<BackendEnvironment, true>,
          ) =>
            new TrackedFrameAdmission(
              auth,
              heads,
              new TrackedSafetyProjection(db, config, { maxRecipients }),
            ),
        },
        ...(automaticResume
          ? [
              {
                provide: TrackedSourceGapResume,
                inject: [CameraSourceService, DataSource, TrackedFrameAdmission],
                useFactory: (
                  sources: CameraSourceService,
                  db: DataSource,
                  admission: TrackedFrameAdmission,
                ) =>
                  new TrackedSourceGapResume(
                    sources,
                    (key) => admission.recheckSourceGap(db, key),
                    profile.allowedCameraIds,
                    automaticResume.maxStarts,
                  ),
              },
            ]
          : []),
        {
          provide: TrackedFrameRecovery,
          inject: [
            DataSource,
            TrackedFrameAdmission,
            ...(automaticResume ? [TrackedSourceGapResume] : []),
          ],
          useFactory: (
            db: DataSource,
            admission: TrackedFrameAdmission,
            resume?: TrackedSourceGapResume,
          ) =>
            new TrackedFrameRecovery(db, admission, {
              ...frameRecovery,
              ...(automaticResume
                ? {
                    sourceGap: {
                      minPersistentMs: automaticResume.minPersistentMs,
                      onGap: (key: Readonly<TrackedFrameKey>) => resume!.notify(key),
                    },
                  }
                : {}),
              cameraIds: profile.allowedCameraIds,
            }),
        },
      ],
    };
  }
}
