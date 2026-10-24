import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CONFIGURATION_REFERENCE_LIFETIME_MS,
  decodeConfigurationJpeg,
  parseCameraConfigurationSourceImage,
  type CameraConfigurationImageResponse,
} from '@smartsite/contracts/camera-configuration-image';
import type { BackendEnvironment } from '../../config/environment.js';
import { conflict, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { AuthService } from '../auth/auth.service.js';
import { CameraConfigurationService } from './camera-configuration.service.js';
import { fetchConfigurationImageJson } from './camera-configuration-image.transport.js';

export const CAMERA_CONFIGURATION_IMAGE_FETCH = Symbol('CAMERA_CONFIGURATION_IMAGE_FETCH');
export const CAMERA_CONFIGURATION_IMAGE_CLOCK = Symbol('CAMERA_CONFIGURATION_IMAGE_CLOCK');
const unavailable = (): never => {
  throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Camera configuration image is unavailable',
  });
};

/** Observes an already-owned source. Reading never starts capture or inference. */
@Injectable()
export class CameraConfigurationImageService implements OnModuleDestroy {
  private readonly reads = new Map<string, AbortController>();
  private shuttingDown = false;

  constructor(
    private readonly config: ConfigService<BackendEnvironment, true>,
    private readonly auth: AuthService,
    private readonly cameras: CameraConfigurationService,
    @Optional()
    @Inject(CAMERA_CONFIGURATION_IMAGE_FETCH)
    private readonly fetcher: typeof fetch = globalThis.fetch,
    @Optional()
    @Inject(CAMERA_CONFIGURATION_IMAGE_CLOCK)
    private readonly clock: () => number = Date.now,
  ) {}

  onModuleDestroy(): void {
    this.shuttingDown = true;
    for (const controller of this.reads.values()) controller.abort();
  }

  private async authorize(token: string, siteId: string): Promise<void> {
    const { user } = await this.auth.authenticate(token);
    if (user.mustChangePassword) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    }
    if (
      !user.isActive ||
      !user.roleAssignments.some(
        ({ role, siteId: assignedSite }) =>
          (role === UserRole.ADMIN && assignedSite === null) ||
          ((role === UserRole.SITE_MANAGER || role === UserRole.SAFETY_OFFICER) &&
            assignedSite !== null &&
            assignedSite.toLowerCase() === siteId),
      )
    ) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    }
    if (this.shuttingDown) unavailable();
  }

  private async camera(siteId: string, cameraId: string) {
    const camera = await this.cameras.get(siteId, cameraId);
    if (camera.siteId.toLowerCase() !== siteId || camera.id.toLowerCase() !== cameraId) missing();
    if (camera.status !== CameraStatus.ACTIVE) unavailable();
    return camera;
  }

  private origin(externalId: string): string {
    const sources = this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true });
    if (!Object.hasOwn(sources, externalId)) unavailable();
    return sources[externalId]!;
  }

  async read(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    signal?: AbortSignal,
  ): Promise<CameraConfigurationImageResponse> {
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    await this.authorize(token, siteId);
    const controller = new AbortController();
    const abort = () => controller.abort();
    let acquired = false;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const camera = await this.camera(siteId, cameraId);
      await this.authorize(token, siteId);
      const origin = this.origin(camera.externalId);
      if (this.reads.has(cameraId) || this.reads.size >= 4) {
        throw new PublicHttpException(HttpStatus.TOO_MANY_REQUESTS, {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Camera configuration image read limit reached',
        });
      }
      this.reads.set(cameraId, controller);
      acquired = true;
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      deadline = setTimeout(abort, 2000);
      const url = new URL('/v1/realtime/configuration-image', origin);
      url.searchParams.set('cameraExternalId', camera.externalId);
      let image;
      try {
        image = parseCameraConfigurationSourceImage(
          await fetchConfigurationImageJson(this.fetcher, url.href, {
            headers: {
              Authorization: `Bearer ${this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true })}`,
              Accept: 'application/json',
            },
            cache: 'no-store',
            redirect: 'error',
            signal: controller.signal,
          }),
        );
        const bytes = decodeConfigurationJpeg(image.frame);
        if (
          createHash('sha256').update(bytes).digest('hex') !== image.frame.imageSha256 ||
          image.frame.cameraExternalId !== camera.externalId
        )
          unavailable();
      } catch {
        return unavailable();
      }
      await this.authorize(token, siteId);
      if (controller.signal.aborted) unavailable();
      const current = await this.camera(siteId, cameraId);
      await this.authorize(token, siteId);
      if (controller.signal.aborted) unavailable();
      if (current.externalId !== camera.externalId || this.origin(current.externalId) !== origin)
        unavailable();
      if (current.configurationVersion !== camera.configurationVersion) conflict();
      const now = this.clock();
      const captured = Date.parse(image.frame.capturedAt);
      if (
        controller.signal.aborted ||
        !Number.isFinite(now) ||
        now - captured > 2000 ||
        captured - now > 1000
      )
        unavailable();
      return {
        ...image,
        siteId,
        cameraId,
        configurationVersion: camera.configurationVersion,
        referenceExpiresAt: new Date(
          Math.min(captured, now) + CONFIGURATION_REFERENCE_LIFETIME_MS,
        ).toISOString(),
      };
    } catch (error) {
      // Logout/role loss takes precedence even when the upstream or revision also failed.
      await this.authorize(token, siteId);
      if (controller.signal.aborted) return unavailable();
      if (error instanceof PublicHttpException) throw error;
      return unavailable();
    } finally {
      clearTimeout(deadline);
      signal?.removeEventListener('abort', abort);
      if (acquired && this.reads.get(cameraId) === controller) this.reads.delete(cameraId);
      controller.abort();
    }
  }
}
