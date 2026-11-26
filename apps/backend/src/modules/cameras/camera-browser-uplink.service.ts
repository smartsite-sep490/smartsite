import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH,
  BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
  BROWSER_CAMERA_UPLINK_SLIDING_LEASE_TTL_MS,
  BROWSER_CAMERA_UPLINK_START_LEASE_TTL_MS,
  isFreshBrowserUplinkTimestamp,
  isJpegPayload,
  parseBrowserCameraUplinkFrameMetadata,
  parseBrowserCameraUplinkStartCommand,
  parseBrowserCameraUplinkStopCommand,
  type BrowserCameraUplinkFrameReceipt,
  type BrowserCameraUplinkStartResponse,
  type BrowserCameraUplinkStatusResponse,
  type BrowserCameraUplinkStopResponse,
} from '@smartsite/contracts/browser-camera-uplink';
import { decodeConfigurationJpeg } from '@smartsite/contracts/camera-configuration-image';
import type { BackendEnvironment } from '../../config/environment.js';
import { conflict, invalid, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { AuthService } from '../auth/auth.service.js';
import { CameraConfigurationService } from './camera-configuration.service.js';

export const CAMERA_BROWSER_UPLINK_CLOCK = Symbol('CAMERA_BROWSER_UPLINK_CLOCK');

export interface BrowserUplinkRawFrameHeaders {
  contentType?: string;
  leaseId?: string;
  sequence?: string;
  capturedAt?: string;
  width?: string;
  height?: string;
}

export interface FreshBrowserUplinkFrame {
  leaseId: string;
  sequence: number;
  capturedAt: string;
  width: number;
  height: number;
  jpegBytes: Buffer;
}

interface UplinkRow {
  camera_id: string;
  site_id: string;
  lease_id: string;
  owner_user_id: string;
  state: 'ACTIVE' | 'STOPPED';
  sequence: string | number;
  width: number | null;
  height: number | null;
  byte_length: number | null;
  captured_at: Date | string | null;
  lease_expires_at: Date | string;
  stopped_at: Date | string | null;
  jpeg_bytes: Buffer | null;
}

function unsupportedCapability(): never {
  throw new PublicHttpException(HttpStatus.NOT_IMPLEMENTED, {
    code: 'UNSUPPORTED_CAPABILITY',
    message: 'Browser camera uplink is not enabled',
  });
}

function leaseHeld(): never {
  throw new PublicHttpException(HttpStatus.CONFLICT, {
    code: 'LEASE_HELD',
    message: 'Camera browser uplink is currently held by another active session',
  });
}

function leaseExpired(): never {
  throw new PublicHttpException(HttpStatus.CONFLICT, {
    code: 'LEASE_EXPIRED',
    message: 'Camera browser uplink lease has expired or stopped',
  });
}

function leaseNotFound(): never {
  throw new PublicHttpException(HttpStatus.NOT_FOUND, {
    code: 'LEASE_NOT_FOUND',
    message: 'Camera browser uplink lease was not found',
  });
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toMs(value: Date | string | null | undefined): number {
  if (!value) return Number.NaN;
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

/** TypeORM Postgres UPDATE ... RETURNING yields [rows, affectedCount]; unwrap safely. */
function returnedRows<T>(rawResult: unknown): T[] {
  if (!Array.isArray(rawResult)) return [];
  if (rawResult.length === 2 && Array.isArray(rawResult[0]) && typeof rawResult[1] === 'number') {
    return rawResult[0] as T[];
  }
  return rawResult as T[];
}

/** Validate actual JPEG SOI/SOF/EOI markers and exact SOF dimensions via canonical contracts helper. */
function isValidBoundedJpegWithDimensions(
  jpegBytes: Buffer,
  width: number,
  height: number,
): boolean {
  if (
    !isJpegPayload(jpegBytes) ||
    jpegBytes.byteLength > BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES ||
    width > BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH ||
    height > BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT
  ) {
    return false;
  }
  try {
    decodeConfigurationJpeg({
      imageDataUrl: `data:image/jpeg;base64,${jpegBytes.toString('base64')}`,
      width,
      height,
    });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class CameraBrowserUplinkService {
  constructor(
    private readonly config: ConfigService<BackendEnvironment, true>,
    private readonly auth: AuthService,
    private readonly cameras: CameraConfigurationService,
    private readonly database: DataSource,
    @Optional()
    @Inject(CAMERA_BROWSER_UPLINK_CLOCK)
    private readonly clock: () => number = Date.now,
  ) {}

  isEnabled(): boolean {
    return this.config.get('BROWSER_CAMERA_UPLINK_ENABLED', { infer: true }) === true;
  }

  private async authorize(token: string, siteId: string, write: boolean): Promise<string> {
    const { user } = await this.auth.authenticate(token);
    if (user.mustChangePassword) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required',
      });
    }
    const allowed =
      user.isActive &&
      user.roleAssignments.some(
        (assignment) =>
          assignment.siteId !== null &&
          assignment.siteId.toLowerCase() === siteId &&
          (assignment.role === UserRole.SITE_MANAGER ||
            (!write && assignment.role === UserRole.SAFETY_OFFICER)),
      );
    if (!allowed) {
      throw new PublicHttpException(HttpStatus.FORBIDDEN, {
        code: 'FORBIDDEN',
        message: 'Forbidden',
      });
    }
    return user.id.toLowerCase();
  }

  private async requireScopedCamera(siteId: string, cameraId: string, requireActive: boolean) {
    const camera = await this.cameras.get(siteId, cameraId);
    if (camera.siteId.toLowerCase() !== siteId || camera.id.toLowerCase() !== cameraId) missing();
    if ('type' in camera && camera.type === 'GATE') {
      conflict('Gate Cameras cannot accept browser monitoring uplink');
    }
    if (requireActive && camera.status !== CameraStatus.ACTIVE) {
      throw new PublicHttpException(HttpStatus.CONFLICT, {
        code: 'CAMERA_INACTIVE',
        message: 'Camera must be active before starting browser camera uplink',
      });
    }
    return camera;
  }

  async status(
    token: string,
    requestedSite: string,
    requestedCamera: string,
  ): Promise<BrowserCameraUplinkStatusResponse> {
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    const userId = await this.authorize(token, siteId, false);
    await this.requireScopedCamera(siteId, cameraId, false);

    if (!this.isEnabled()) {
      return {
        schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
        supported: false,
        siteId,
        cameraId,
        state: 'IDLE',
        activeLeaseId: null,
        ownedByCurrentUser: false,
        lastSequence: null,
        lastFrameCapturedAt: null,
        leaseExpiresAt: null,
        width: null,
        height: null,
      };
    }

    const rows = (await this.database.query(
      `SELECT camera_id, site_id, lease_id, owner_user_id, state, sequence,
              width, height, byte_length, captured_at, lease_expires_at, stopped_at
       FROM camera_browser_uplink_frame
       WHERE camera_id = $1 AND site_id = $2`,
      [cameraId, siteId],
    )) as UplinkRow[];

    const row = rows[0];
    if (!row) {
      return {
        schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
        supported: true,
        siteId,
        cameraId,
        state: 'IDLE',
        activeLeaseId: null,
        ownedByCurrentUser: false,
        lastSequence: null,
        lastFrameCapturedAt: null,
        leaseExpiresAt: null,
        width: null,
        height: null,
      };
    }

    const nowMs = this.clock();
    const leaseExpiresMs = toMs(row.lease_expires_at);
    const active =
      row.state === 'ACTIVE' && Number.isFinite(leaseExpiresMs) && leaseExpiresMs > nowMs;
    const effectiveState = active ? 'ACTIVE' : row.state === 'ACTIVE' ? 'EXPIRED' : 'STOPPED';
    const ownedByCurrentUser = active && row.owner_user_id.toLowerCase() === userId;

    return {
      schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
      supported: true,
      siteId,
      cameraId,
      state: effectiveState,
      activeLeaseId: ownedByCurrentUser ? row.lease_id : null,
      ownedByCurrentUser,
      lastSequence: active ? Number(row.sequence) : null,
      lastFrameCapturedAt: active ? toIso(row.captured_at) : null,
      leaseExpiresAt: active ? toIso(row.lease_expires_at) : null,
      width: active ? row.width : null,
      height: active ? row.height : null,
    };
  }

  async start(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    rawCommand: unknown,
  ): Promise<BrowserCameraUplinkStartResponse> {
    if (!this.isEnabled()) unsupportedCapability();
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    let command;
    try {
      command = parseBrowserCameraUplinkStartCommand(rawCommand);
    } catch {
      invalid('Invalid browser camera uplink start command');
    }

    const userId = await this.authorize(token, siteId, true);
    await this.requireScopedCamera(siteId, cameraId, true);

    const nowMs = this.clock();
    const nowDate = new Date(nowMs);
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(nowMs + BROWSER_CAMERA_UPLINK_START_LEASE_TTL_MS);

    // Atomic single-owner acquisition: rejects concurrent or existing unexpired ACTIVE leases.
    const rows = (await this.database.query(
      `INSERT INTO camera_browser_uplink_frame (
         camera_id, site_id, lease_id, owner_user_id, client_session_id,
         device_label, state, sequence, width, height, byte_length,
         captured_at, lease_expires_at, stopped_at, updated_at, jpeg_bytes
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', 0, NULL, NULL, NULL, NULL, $7, NULL, $8, NULL)
       ON CONFLICT (camera_id) DO UPDATE SET
         site_id = EXCLUDED.site_id,
         lease_id = EXCLUDED.lease_id,
         owner_user_id = EXCLUDED.owner_user_id,
         client_session_id = EXCLUDED.client_session_id,
         device_label = EXCLUDED.device_label,
         state = 'ACTIVE',
         sequence = 0,
         width = NULL,
         height = NULL,
         byte_length = NULL,
         captured_at = NULL,
         lease_expires_at = EXCLUDED.lease_expires_at,
         stopped_at = NULL,
         updated_at = EXCLUDED.updated_at,
         jpeg_bytes = NULL
       WHERE camera_browser_uplink_frame.state <> 'ACTIVE'
          OR camera_browser_uplink_frame.lease_expires_at <= $8
       RETURNING lease_id`,
      [
        cameraId,
        siteId,
        leaseId,
        userId,
        command.clientSessionId,
        command.deviceLabel ?? null,
        leaseExpiresAt,
        nowDate,
      ],
    )) as { lease_id: string }[];

    if (rows.length !== 1) {
      leaseHeld();
    }

    return {
      schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
      leaseId,
      siteId,
      cameraId,
      state: 'ACTIVE',
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      maxFrameBytes: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES,
      maxWidth: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH,
      maxHeight: BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT,
      recommendedIntervalMs: BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
    };
  }

  async uploadFrame(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    rawHeaders: BrowserUplinkRawFrameHeaders,
    jpegBytes: Buffer,
  ): Promise<BrowserCameraUplinkFrameReceipt> {
    if (!this.isEnabled()) unsupportedCapability();
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();

    const contentType = rawHeaders.contentType?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'image/jpeg') {
      throw new PublicHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
        code: 'INVALID_MEDIA_TYPE',
        message: 'Browser uplink frames must use Content-Type: image/jpeg',
      });
    }
    if (jpegBytes.byteLength > BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES) {
      throw new PublicHttpException(HttpStatus.PAYLOAD_TOO_LARGE, {
        code: 'FRAME_TOO_LARGE',
        message: 'Browser uplink frame exceeds maximum size limit',
      });
    }
    if (!isJpegPayload(jpegBytes)) {
      throw new PublicHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
        code: 'INVALID_MEDIA_TYPE',
        message: 'Browser uplink frame payload must be a valid JPEG image',
      });
    }

    const parsedSeq = rawHeaders.sequence ? Number(rawHeaders.sequence) : Number.NaN;
    const parsedW = rawHeaders.width ? Number(rawHeaders.width) : Number.NaN;
    const parsedH = rawHeaders.height ? Number(rawHeaders.height) : Number.NaN;
    let metadata;
    try {
      metadata = parseBrowserCameraUplinkFrameMetadata({
        leaseId: rawHeaders.leaseId,
        sequence: parsedSeq,
        capturedAt: rawHeaders.capturedAt,
        width: parsedW,
        height: parsedH,
        byteLength: jpegBytes.byteLength,
      });
    } catch {
      invalid('Invalid browser camera uplink frame headers');
    }
    if (
      metadata.width > BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH ||
      metadata.height > BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT
    ) {
      invalid('Browser uplink frame dimensions exceed server limits');
    }
    if (!isValidBoundedJpegWithDimensions(jpegBytes, metadata.width, metadata.height)) {
      throw new PublicHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, {
        code: 'INVALID_MEDIA_TYPE',
        message: 'Browser uplink JPEG markers or dimensions do not match declared bounds',
      });
    }

    const nowMs = this.clock();
    if (!isFreshBrowserUplinkTimestamp(metadata.capturedAt, nowMs)) {
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'FRAME_STALE',
        message: 'Browser uplink frame timestamp is stale or out of range',
      });
    }

    const userId = await this.authorize(token, siteId, true);
    await this.requireScopedCamera(siteId, cameraId, true);

    const nowDate = new Date(nowMs);
    const nextLeaseExpiresAt = new Date(nowMs + BROWSER_CAMERA_UPLINK_SLIDING_LEASE_TTL_MS);
    const updated = returnedRows<{ sequence: string | number }>(
      await this.database.query(
        `UPDATE camera_browser_uplink_frame
         SET sequence = $4,
             width = $5,
             height = $6,
             byte_length = $7,
             captured_at = $8,
             lease_expires_at = $9,
             updated_at = $10,
             jpeg_bytes = $11
         WHERE camera_id = $1
           AND site_id = $2
           AND lease_id = $3
           AND owner_user_id = $12
           AND state = 'ACTIVE'
           AND lease_expires_at > $10
           AND sequence < $4
         RETURNING sequence`,
        [
          cameraId,
          siteId,
          metadata.leaseId,
          metadata.sequence,
          metadata.width,
          metadata.height,
          metadata.byteLength,
          new Date(metadata.capturedAt),
          nextLeaseExpiresAt,
          nowDate,
          jpegBytes,
          userId,
        ],
      ),
    );

    if (updated.length !== 1) {
      const existingRows = (await this.database.query(
        `SELECT lease_id, owner_user_id, state, sequence, lease_expires_at
         FROM camera_browser_uplink_frame
         WHERE camera_id = $1 AND site_id = $2`,
        [cameraId, siteId],
      )) as Pick<
        UplinkRow,
        'lease_id' | 'owner_user_id' | 'state' | 'sequence' | 'lease_expires_at'
      >[];
      const row = existingRows[0];
      if (!row) leaseNotFound();
      const unexpired = row.state === 'ACTIVE' && toMs(row.lease_expires_at) > nowMs;
      if (
        unexpired &&
        (row.lease_id.toLowerCase() !== metadata.leaseId.toLowerCase() ||
          row.owner_user_id.toLowerCase() !== userId)
      ) {
        leaseHeld();
      }
      if (!unexpired) leaseExpired();
      conflict('Browser uplink frame sequence must strictly increase');
    }

    return {
      schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
      leaseId: metadata.leaseId,
      sequence: metadata.sequence,
      acceptedAt: nowDate.toISOString(),
      leaseExpiresAt: nextLeaseExpiresAt.toISOString(),
      width: metadata.width,
      height: metadata.height,
      byteLength: metadata.byteLength,
    };
  }

  async stop(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    rawCommand: unknown,
  ): Promise<BrowserCameraUplinkStopResponse> {
    if (!this.isEnabled()) unsupportedCapability();
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    let command;
    try {
      command = parseBrowserCameraUplinkStopCommand(rawCommand);
    } catch {
      invalid('Invalid browser camera uplink stop command');
    }

    const userId = await this.authorize(token, siteId, true);
    await this.requireScopedCamera(siteId, cameraId, false);

    const nowDate = new Date(this.clock());
    const updated = returnedRows<{ lease_id: string; stopped_at: Date | string }>(
      await this.database.query(
        `UPDATE camera_browser_uplink_frame
         SET state = 'STOPPED',
             width = NULL,
             height = NULL,
             byte_length = NULL,
             captured_at = NULL,
             jpeg_bytes = NULL,
             lease_expires_at = $4,
             stopped_at = $4,
             updated_at = $4
         WHERE camera_id = $1
           AND site_id = $2
           AND lease_id = $3
           AND owner_user_id = $5
         RETURNING lease_id, stopped_at`,
        [cameraId, siteId, command.leaseId, nowDate, userId],
      ),
    );

    if (updated.length !== 1) {
      const existingRows = (await this.database.query(
        `SELECT lease_id, owner_user_id, state, lease_expires_at
         FROM camera_browser_uplink_frame
         WHERE camera_id = $1 AND site_id = $2`,
        [cameraId, siteId],
      )) as Pick<UplinkRow, 'lease_id' | 'owner_user_id' | 'state' | 'lease_expires_at'>[];
      const row = existingRows[0];
      if (!row) leaseNotFound();
      const unexpired = row.state === 'ACTIVE' && toMs(row.lease_expires_at) > nowDate.getTime();
      if (
        unexpired &&
        (row.lease_id.toLowerCase() !== command.leaseId.toLowerCase() ||
          row.owner_user_id.toLowerCase() !== userId)
      ) {
        leaseHeld();
      }
      leaseNotFound();
    }

    return {
      schemaVersion: BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
      leaseId: command.leaseId,
      state: 'STOPPED',
      stoppedAt: toIso(updated[0]!.stopped_at) ?? nowDate.toISOString(),
    };
  }

  /**
   * Read latest frame ONLY when capability is enabled, lease is ACTIVE & unexpired,
   * pixels exist, and capturedAt passes the strict <2000ms past / <=1000ms future gate.
   * Never returns stale or stopped frames as LIVE.
   */
  async readFreshFrame(siteId: string, cameraId: string): Promise<FreshBrowserUplinkFrame | null> {
    if (!this.isEnabled()) return null;
    const nowMs = this.clock();
    const nowDate = new Date(nowMs);
    const rows = (await this.database.query(
      `SELECT lease_id, sequence, width, height, captured_at, jpeg_bytes
       FROM camera_browser_uplink_frame
       WHERE camera_id = $1
         AND site_id = $2
         AND state = 'ACTIVE'
         AND lease_expires_at > $3
         AND jpeg_bytes IS NOT NULL
         AND captured_at IS NOT NULL`,
      [cameraId, siteId, nowDate],
    )) as Pick<
      UplinkRow,
      'lease_id' | 'sequence' | 'width' | 'height' | 'captured_at' | 'jpeg_bytes'
    >[];

    const row = rows[0];
    if (!row || !row.jpeg_bytes || !row.captured_at || row.width === null || row.height === null) {
      return null;
    }
    const capturedAtIso = toIso(row.captured_at);
    if (!capturedAtIso || !isFreshBrowserUplinkTimestamp(capturedAtIso, nowMs)) {
      return null;
    }
    const jpegBytes = Buffer.isBuffer(row.jpeg_bytes)
      ? row.jpeg_bytes
      : Buffer.from(row.jpeg_bytes);
    if (!isValidBoundedJpegWithDimensions(jpegBytes, row.width, row.height)) {
      return null;
    }
    return {
      leaseId: row.lease_id,
      sequence: Number(row.sequence),
      capturedAt: capturedAtIso,
      width: row.width,
      height: row.height,
      jpegBytes,
    };
  }
}
