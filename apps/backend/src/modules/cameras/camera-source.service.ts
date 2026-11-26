import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import type { BackendEnvironment } from '../../config/environment.js';
import { AuthService } from '../auth/auth.service.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { CameraConfigurationService } from './camera-configuration.service.js';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import {
  bootstrapCameraWorkerGeneration,
  renewCameraWorkerGeneration,
} from './camera-worker-generations.js';
import { activateTestedCameraSource } from './camera-source-activation.js';
import { readCurrentCameraPolicyBundle } from './camera-policy-bundle-reader.js';
import { resumeAcceptedCameraSource } from './camera-source-resume.js';
import { hasActiveBrowserUplinkLease } from './camera-source-ownership.js';
import type { SourceConfigurationResumeResult } from '@smartsite/contracts';
import {
  sourceCapabilitiesSchema,
  sourceDraftSchema,
  sourceHostsSchema,
  sourceProbeSchema,
  sourceActivationCommandSchema,
  sourceActivationStateSchema,
  sourceConfigurationResumeSchema,
  sourceResumeStatusSchema,
} from './camera-source-contract.js';

export const CAMERA_SOURCE_FETCH = Symbol('CAMERA_SOURCE_FETCH');
class CameraSourceScopeMissing extends Error {}
const unavailable = (): never => {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Camera source host is unavailable',
  });
};

async function boundedBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (
    !response.body ||
    response.headers.get('content-type')?.split(';')[0] !== 'application/json'
  ) {
    void response.body?.cancel().catch(() => {});
    unavailable();
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 400000)) {
    void response.body?.cancel().catch(() => {});
    unavailable();
  }
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Source operation cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (signal.aborted) unavailable();
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      total += next.value.length;
      if (total > 400000) unavailable();
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => {});
  }
}

@Injectable()
export class CameraSourceService {
  constructor(
    private readonly config: ConfigService<BackendEnvironment, true>,
    private readonly auth: AuthService,
    private readonly cameras: CameraConfigurationService,
    @Optional()
    @Inject(CAMERA_SOURCE_FETCH)
    private readonly fetcher: typeof fetch = globalThis.fetch,
    @Optional() private readonly database?: DataSource,
  ) {}

  private async authorize(token: string, siteId: string, write: boolean) {
    const { user } = await this.auth.authenticate(token);
    if (
      user.mustChangePassword ||
      !user.roleAssignments.some(
        (r) =>
          r.siteId !== null &&
          r.siteId.toLowerCase() === siteId &&
          (r.role === UserRole.SITE_MANAGER || (!write && r.role === UserRole.SAFETY_OFFICER)),
      )
    )
      throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
  }

  private hosts(siteId: string) {
    try {
      const configured = this.config.get('SMARTSITE_AI_SOURCE_HOSTS', { infer: true });
      const hosts = sourceHostsSchema.parse(configured ? JSON.parse(configured) : []);
      if (new Set(hosts.map((h) => h.id)).size !== hosts.length) unavailable();
      for (const host of hosts) {
        const url = new URL(host.origin);
        const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash ||
          !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              local &&
              this.config.get('NODE_ENV', { infer: true }) !== 'production')
          )
        )
          unavailable();
      }
      return hosts.filter((h) => h.siteIds.some((id) => id.toLowerCase() === siteId));
    } catch {
      return unavailable();
    }
  }

  private async monitoringCamera(siteId: string, cameraId: string) {
    const camera = await this.cameras.get(siteId, cameraId);
    if (camera.siteId !== siteId) missing();
    // Reject before any host operation; the generation issuer also rechecks under lock.
    if ('type' in camera && camera.type === 'GATE')
      conflict('Gate Cameras cannot run monitoring workers');
    return camera;
  }

  private async call(
    origin: string,
    path: string,
    body: unknown,
    signal: AbortSignal,
    expectedMissing?: 'resume' | 'scope',
  ) {
    if (signal.aborted) unavailable();
    const token = this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true });
    if (!token) unavailable();
    const response = await this.fetcher(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (expectedMissing && response.status === 404) {
        const value = await boundedBody(response, signal);
        if (
          value &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.keys(value).length === 1 &&
          Object.hasOwn(value, 'code') &&
          (value as { code: unknown }).code ===
            (expectedMissing === 'resume' ? 'SOURCE_RESUME_NOT_FOUND' : 'SOURCE_SCOPE_NOT_FOUND')
        ) {
          if (expectedMissing === 'scope') throw new CameraSourceScopeMissing();
          return undefined;
        }
        unavailable();
      }
      void response.body?.cancel().catch(() => {});
      if ([400, 409, 504].includes(response.status))
        throw new PublicHttpException(response.status, {
          code:
            response.status === 400
              ? 'BAD_REQUEST'
              : response.status === 409
                ? 'CONFLICT'
                : 'SERVICE_UNAVAILABLE',
          message: 'Camera source operation failed',
        });
      unavailable();
    }
    return boundedBody(response, signal);
  }

  async list(token: string, siteValue: string, cameraValue: string, signal?: AbortSignal) {
    const siteId = uuid(siteValue),
      cameraId = uuid(cameraValue);
    await this.authorize(token, siteId, false);
    const camera = await this.monitoringCamera(siteId, cameraId);
    const hosts = await Promise.all(
      this.hosts(siteId).map(async (host) => {
        try {
          const budget = signal
            ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000);
          const parsed = sourceCapabilitiesSchema.parse(
            await this.call(
              host.origin,
              `/v1/source-control/${siteId}/${encodeURIComponent(camera.externalId)}/capabilities`,
              undefined,
              budget,
              'scope',
            ),
          );
          if (parsed.hostId !== host.id) unavailable();
          return {
            id: host.id,
            label: host.label,
            available: true as const,
            capabilities: parsed,
          };
        } catch (error) {
          return {
            id: host.id,
            label: host.label,
            available: false as const,
            reason:
              error instanceof CameraSourceScopeMissing
                ? ('CAMERA_UNBOUND' as const)
                : ('AGENT_UNAVAILABLE' as const),
          };
        }
      }),
    );
    await this.authorize(token, siteId, false);
    return { hosts };
  }

  async probe(
    token: string,
    siteValue: string,
    cameraValue: string,
    hostId: string,
    input: unknown,
    signal?: AbortSignal,
  ) {
    const siteId = uuid(siteValue),
      cameraId = uuid(cameraValue);
    await this.authorize(token, siteId, true);
    const camera = await this.monitoringCamera(siteId, cameraId);
    if (camera.siteId !== siteId) missing();
    const host = this.hosts(siteId).find((h) => h.id === hostId);
    if (!host) missing();
    const draft = sourceDraftSchema.safeParse(input);
    if (!draft.success) invalid('Invalid camera source');
    try {
      const budget = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);
      const value = sourceProbeSchema.parse(
        await this.call(
          host.origin,
          `/v1/source-control/${siteId}/${encodeURIComponent(camera.externalId)}/probe`,
          draft.data,
          budget,
        ),
      );
      if (
        value.frame.width * value.frame.height > 8000000 ||
        (draft.data.kind === 'VIDEO' ? value.sourceKind !== 'REPLAY' : value.sourceKind !== 'LIVE')
      )
        unavailable();
      await this.authorize(token, siteId, true);
      return value;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return unavailable();
    }
  }

  async resume(
    token: string,
    siteValue: string,
    cameraValue: string,
    hostId: string,
    input: unknown,
  ): Promise<SourceConfigurationResumeResult> {
    return this.resumeWithAuthority(
      () => this.authorize(token, uuid(siteValue), true),
      siteValue,
      cameraValue,
      hostId,
      input,
    );
  }

  /** Internal Backend recovery only; no HTTP route or browser credential bypass. */
  async resumeAfterSourceGap(
    source: Readonly<{ cameraId: string; generationId: string; streamSessionId: string }>,
    gapStillCurrent: () => Promise<boolean>,
  ): Promise<SourceConfigurationResumeResult> {
    const cameraId = uuid(source.cameraId),
      owner = {
        generationId: uuid(source.generationId),
        streamSessionId: uuid(source.streamSessionId),
      };
    const policy = this.config.get('AI_TRACKED_FRAME_RUNTIME_POLICY', { infer: true });
    const automatic = policy?.recovery.automaticResume;
    const enabled = () => {
      const current = this.config.get('AI_TRACKED_FRAME_RUNTIME_POLICY', { infer: true });
      return (
        this.config.get('AI_TRACKED_FRAME_RUNTIME_ENABLED', { infer: true }) === true &&
        this.config.get('SMARTSITE_AI_SOURCE_APPLY_ENABLED', { infer: true }) === true &&
        current?.recovery.automaticResume?.hostId === automatic?.hostId &&
        current?.recovery.automaticResume !== undefined &&
        current.profile.allowedCameraIds.includes(cameraId) &&
        (this.config.get('AI_CONFIGURATION_CAMERA_IDS', { infer: true }) ?? []).includes(cameraId)
      );
    };
    if (!automatic || !enabled() || !this.database) unavailable();
    const database = this.database!;
    const rows = await database.query<
      Array<{
        site_id: string;
        external_id: string;
        configuration_version: string;
        view_revision: string;
        bundle_sha256: string;
      }>
    >(
      `SELECT c.site_id,c.external_id,c.configuration_version,v.revision AS view_revision,b.bundle_sha256
       FROM camera c JOIN camera_worker_generation g ON g.camera_id=c.id AND g.site_id=c.site_id
       JOIN camera_view_revision v ON v.camera_id=c.id AND v.site_id=c.site_id AND v.is_current AND v.source_kind='LIVE'
       JOIN camera_configuration_bundle b ON b.camera_id=c.id AND b.site_id=c.site_id
         AND b.configuration_version=c.configuration_version AND b.view_revision=v.revision
       WHERE c.id=$1 AND c.status='ACTIVE' AND g.id=$2 AND g.stream_session_id=$3
         AND g.is_current AND g.revoked_at IS NULL AND g.superseded_at IS NULL
         AND g.expires_at>clock_timestamp() AND g.observation_route_mode='EPISODE_TRACKED'`,
      [cameraId, owner.generationId, owner.streamSessionId],
    );
    const snapshot = rows[0];
    if (rows.length !== 1 || !snapshot) conflict('Camera recovery source changed');
    const siteId = uuid(snapshot!.site_id),
      host = this.hosts(siteId).find((h) => h.id === automatic!.hostId);
    if (!host) unavailable();
    let renewed = false;
    const authorize = async () => {
      if (!enabled()) unavailable();
      const matches = await database.query(
        `SELECT 1 FROM camera c JOIN camera_worker_generation g ON g.camera_id=c.id AND g.site_id=c.site_id
         JOIN camera_view_revision v ON v.camera_id=c.id AND v.site_id=c.site_id AND v.is_current AND v.source_kind='LIVE'
         JOIN camera_configuration_bundle b ON b.camera_id=c.id AND b.site_id=c.site_id
           AND b.configuration_version=c.configuration_version AND b.view_revision=v.revision
         WHERE c.id=$1 AND c.site_id=$2 AND c.status='ACTIVE' AND c.configuration_version=$5
           AND c.external_id=$8 AND g.id=$3 AND g.stream_session_id=$4
           AND g.is_current AND g.revoked_at IS NULL AND g.superseded_at IS NULL
           AND g.expires_at>clock_timestamp()
           AND (g.observation_route_mode='EPISODE_TRACKED' OR ($9::boolean AND g.observation_route_mode IS NULL))
           AND v.revision=$6 AND b.bundle_sha256=$7`,
        [
          cameraId,
          siteId,
          owner.generationId,
          owner.streamSessionId,
          snapshot!.configuration_version,
          snapshot!.view_revision,
          snapshot!.bundle_sha256,
          snapshot!.external_id,
          renewed,
        ],
      );
      if (matches.length !== 1 || (!renewed && !(await gapStillCurrent())))
        conflict('Camera recovery source or configuration changed');
    };
    await authorize();
    let capabilities: ReturnType<typeof sourceCapabilitiesSchema.parse>;
    try {
      capabilities = sourceCapabilitiesSchema.parse(
        await this.call(
          host!.origin,
          `/v1/source-control/${siteId}/${encodeURIComponent(snapshot!.external_id)}/capabilities`,
          undefined,
          AbortSignal.timeout(5000),
        ),
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return unavailable();
    }
    if (
      capabilities.hostId !== automatic!.hostId ||
      capabilities.configurationResumeSupported !== true ||
      capabilities.sourceRevision === undefined
    )
      unavailable();
    return this.resumeWithAuthority(
      authorize,
      siteId,
      cameraId,
      automatic!.hostId,
      {
        commandId: randomUUID(),
        expectedRevision: capabilities.sourceRevision,
        expectedConfigurationVersion: Number(snapshot!.configuration_version),
      },
      owner,
      () => {
        renewed = true;
      },
    );
  }

  private async resumeWithAuthority(
    authorize: () => Promise<void>,
    siteValue: string,
    cameraValue: string,
    hostId: string,
    input: unknown,
    expectedSource?: { generationId: string; streamSessionId: string },
    onIssued?: () => void,
  ): Promise<SourceConfigurationResumeResult> {
    const siteId = uuid(siteValue),
      cameraId = uuid(cameraValue);
    await authorize();
    const command = sourceConfigurationResumeSchema.safeParse(input);
    if (!command.success) invalid('Invalid camera configuration resume');
    const camera = await this.monitoringCamera(siteId, cameraId),
      host = this.hosts(siteId).find((h) => h.id === hostId);
    const allowed = this.config.get('AI_CONFIGURATION_CAMERA_IDS', { infer: true }) ?? [];
    if (!host || camera.siteId !== siteId || !allowed.includes(cameraId)) missing();
    if (
      this.config.get('SMARTSITE_AI_SOURCE_APPLY_ENABLED', { infer: true }) !== true ||
      !this.database
    )
      unavailable();
    const database = this.database!,
      runner = database.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const [lock] = await runner.query(
        "SELECT pg_try_advisory_lock(hashtext(current_schema() || ':source-apply'),hashtext($1)) AS acquired",
        [cameraId],
      );
      locked = lock?.acquired === true;
      if (!locked)
        throw new PublicHttpException(409, {
          code: 'CONFLICT',
          message: 'Camera source operation in progress',
        });
      if (await hasActiveBrowserUplinkLease(runner, siteId, cameraId)) {
        conflict(
          'Camera has an active browser uplink session; stop it before resuming a physical source',
        );
      }
      const path = `/v1/source-control/${siteId}/${encodeURIComponent(camera.externalId)}`;
      const capabilities = sourceCapabilitiesSchema.parse(
        await this.call(host!.origin, path + '/capabilities', undefined, AbortSignal.timeout(5000)),
      );
      if (capabilities.hostId !== hostId || capabilities.configurationResumeSupported !== true)
        unavailable();
      if (capabilities.sourceRevision !== command.data.expectedRevision)
        throw new PublicHttpException(409, {
          code: 'CONFLICT',
          message: 'Camera source revision changed',
        });
      const { expected, policyBundle } = await database.transaction(
        'REPEATABLE READ',
        async (manager) => {
          const rows = await manager.query<
            Array<{
              configuration_version: string;
              view_revision: string;
              bundle_sha256: string;
              generation_id: string;
              stream_session_id: string;
              external_id: string;
            }>
          >(
            `SELECT c.configuration_version,v.revision AS view_revision,b.bundle_sha256,g.id AS generation_id,g.stream_session_id,c.external_id
             FROM camera c JOIN camera_worker_generation g ON g.camera_id=c.id AND g.site_id=c.site_id AND g.is_current AND g.revoked_at IS NULL AND g.superseded_at IS NULL
             JOIN camera_view_revision v ON v.camera_id=c.id AND v.site_id=c.site_id AND v.is_current AND v.source_kind='LIVE'
             JOIN camera_configuration_bundle b ON b.camera_id=c.id AND b.site_id=c.site_id AND b.configuration_version=c.configuration_version AND b.view_revision=v.revision
             WHERE c.id=$1 AND c.site_id=$2 AND c.status='ACTIVE'`,
            [cameraId, siteId],
          );
          const row = rows[0];
          if (
            rows.length !== 1 ||
            !row ||
            (expectedSource &&
              (row.generation_id !== expectedSource.generationId ||
                row.stream_session_id !== expectedSource.streamSessionId)) ||
            row.external_id !== camera.externalId ||
            Number(row.configuration_version) !== command.data.expectedConfigurationVersion ||
            !Number.isSafeInteger(Number(row.view_revision))
          )
            throw new PublicHttpException(409, {
              code: 'CONFLICT',
              message: 'Accepted camera configuration or source owner changed',
            });
          const policy = await readCurrentCameraPolicyBundle(manager, cameraId);
          if (
            policy.cameraId !== cameraId ||
            policy.cameraExternalId !== row.external_id ||
            policy.configurationVersion !== command.data.expectedConfigurationVersion ||
            policy.viewRevision !== Number(row.view_revision) ||
            policy.bundleSha256 !== row.bundle_sha256
          )
            conflict('Accepted camera configuration or source owner changed');
          return { expected: row, policyBundle: policy };
        },
      );
      const configuration = {
        configurationVersion: policyBundle.configurationVersion,
        viewRevision: policyBundle.viewRevision,
        bundleSha256: policyBundle.bundleSha256,
      };
      const known = await this.call(
        host!.origin,
        path + '/resume-status',
        { commandId: command.data.commandId },
        AbortSignal.timeout(5000),
        'resume',
      );
      if (known !== undefined) {
        const status = sourceResumeStatusSchema.parse(known);
        if (
          status.commandId !== command.data.commandId ||
          status.sourceRevision !== command.data.expectedRevision ||
          status.generationBinding.cameraId !== cameraId ||
          status.configuration.configurationVersion !== configuration.configurationVersion ||
          status.configuration.viewRevision !== configuration.viewRevision ||
          status.configuration.bundleSha256 !== configuration.bundleSha256
        )
          throw new PublicHttpException(409, {
            code: 'CONFLICT',
            message: 'Configuration resume command changed',
          });
        if (status.state === 'RUNNING') {
          const resumed = status.newGenerationBinding;
          if (
            !resumed ||
            resumed.workerGenerationId !== expected.generation_id ||
            resumed.streamSessionId !== expected.stream_session_id
          )
            throw new PublicHttpException(409, {
              code: 'CONFLICT',
              message: 'Configuration resume owner changed',
            });
          await authorize();
          return {
            state: 'STARTED',
            commandId: status.commandId,
            sourceRevision: status.sourceRevision,
            currentGenerationId: expected.generation_id,
            ...configuration,
          };
        }
        if (
          status.state !== 'PREPARED' ||
          status.generationBinding.workerGenerationId !== expected.generation_id ||
          status.generationBinding.streamSessionId !== expected.stream_session_id
        )
          throw new PublicHttpException(409, {
            code: 'CONFLICT',
            message: 'Configuration resume requires reconciliation',
          });
      }
      const remote = async (suffix: string, body: unknown) =>
        sourceActivationStateSchema.parse(
          await this.call(host!.origin, path + suffix, body, AbortSignal.timeout(45000)),
        );
      const running = await resumeAcceptedCameraSource(command.data, expected.generation_id, {
        authorize,
        prepare: () =>
          remote('/prepare-resume', {
            commandId: command.data.commandId,
            expectedRevision: command.data.expectedRevision,
            generationBinding: {
              cameraId,
              workerGenerationId: expected.generation_id,
              streamSessionId: expected.stream_session_id,
            },
            configuration,
          }),
        issue: async (owner, id) => {
          const issued = await renewCameraWorkerGeneration(
            database,
            cameraId,
            allowed,
            43200000,
            undefined,
            owner,
            id,
            {
              ...configuration,
              streamSessionId: expected.stream_session_id,
            },
          );
          if (expectedSource) {
            expectedSource.generationId = issued.workerGenerationId;
            expectedSource.streamSessionId = issued.streamSessionId;
          }
          onIssued?.();
          return issued;
        },
        commit: (commandId, generation) => remote('/commit-resume', { commandId, generation }),
      });
      return {
        state: 'STARTED',
        commandId: running.commandId,
        sourceRevision: running.sourceRevision,
        currentGenerationId: running.currentGenerationId,
        ...configuration,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return unavailable();
    } finally {
      try {
        if (locked)
          await runner.query(
            "SELECT pg_advisory_unlock(hashtext(current_schema() || ':source-apply'),hashtext($1))",
            [cameraId],
          );
      } finally {
        await runner.release();
      }
    }
  }

  async apply(
    token: string,
    siteValue: string,
    cameraValue: string,
    hostId: string,
    input: unknown,
  ) {
    const siteId = uuid(siteValue),
      cameraId = uuid(cameraValue);
    await this.authorize(token, siteId, true);
    const parsed = sourceActivationCommandSchema.safeParse(input);
    if (!parsed.success) invalid('Invalid source activation');
    const camera = await this.monitoringCamera(siteId, cameraId);
    const host = this.hosts(siteId).find((h) => h.id === hostId);
    const allowed = this.config.get('AI_CONFIGURATION_CAMERA_IDS', { infer: true }) ?? [];
    if (!host || camera.siteId !== siteId || !allowed.includes(cameraId)) missing();
    // Source activation is separately opt-in; connection testing alone grants no issuance.
    if (
      this.config.get('SMARTSITE_AI_SOURCE_APPLY_ENABLED', { infer: true }) !== true ||
      !this.database
    )
      unavailable();
    const runner = this.database!.createQueryRunner();
    await runner.connect();
    let locked = false;
    try {
      const [lock] = await runner.query(
        "SELECT pg_try_advisory_lock(hashtext(current_schema() || ':source-apply'),hashtext($1)) AS acquired",
        [cameraId],
      );
      locked = lock?.acquired === true;
      if (!locked)
        throw new PublicHttpException(409, {
          code: 'CONFLICT',
          message: 'Camera source operation in progress',
        });
      if (await hasActiveBrowserUplinkLease(runner, siteId, cameraId)) {
        conflict(
          'Camera has an active browser uplink session; stop it before applying a physical source',
        );
      }
      const path = `/v1/source-control/${siteId}/${encodeURIComponent(camera.externalId)}`;
      const remote = async (suffix: string, body: unknown) =>
        sourceActivationStateSchema.parse(
          await this.call(host!.origin, path + suffix, body, AbortSignal.timeout(45000)),
        );
      return await activateTestedCameraSource(parsed.data, {
        authorize: () => this.authorize(token, siteId, true),
        prepare: (command) => remote('/prepare', command),
        issue: async (expected, command) => {
          const generation =
            expected === null
              ? await bootstrapCameraWorkerGeneration(this.database!, cameraId, allowed, 43200000)
              : await renewCameraWorkerGeneration(
                  this.database!,
                  cameraId,
                  allowed,
                  43200000,
                  undefined,
                  expected,
                  command,
                );
          // The old process has stopped and no new process may start before old geometry is retired.
          await this.database!.transaction(async (manager) => {
            const rows = await manager.query(
              'SELECT id FROM camera WHERE id=$1 AND site_id=$2 FOR UPDATE',
              [cameraId, siteId],
            );
            if (rows.length !== 1) missing();
            await manager.query(
              'UPDATE camera_view_revision SET is_current=false,retired_at=clock_timestamp() WHERE camera_id=$1 AND site_id=$2 AND is_current=true',
              [cameraId, siteId],
            );
          });
          return generation;
        },
        commit: (commandId, generation) => remote('/commit', { commandId, generation }),
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return unavailable();
    } finally {
      try {
        if (locked)
          await runner.query(
            "SELECT pg_advisory_unlock(hashtext(current_schema() || ':source-apply'),hashtext($1))",
            [cameraId],
          );
      } finally {
        await runner.release();
      }
    }
  }
}
