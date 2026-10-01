import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { constants } from 'node:fs';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { computeCanonicalPayloadHash, validateObservationEvent } from '@smartsite/contracts';
import type { BackendEnvironment } from '../../../config/environment.js';
import { invalid, missing, uuid } from '../../../common/configuration/commands.js';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../../database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';

const MAX_EVIDENCE_ITEMS = 256;
const MAX_LOCAL_JPEG_BYTES = 1_048_576;
const LOCAL_EVIDENCE_URI =
  /^local:\/\/evidence\/([0-9a-fA-F-]{36})\/(0|[1-9][0-9]*)\/([0-9a-fA-F-]{36})\.jpg$/;

export type SafetyAlertEvidenceKind = 'FRAME' | 'CROP' | 'SNAPSHOT';

export interface SafetyAlertEvidenceSummary {
  index: number;
  kind: SafetyAlertEvidenceKind;
  trackId?: number;
  available: boolean;
}

export interface SafetyAlertEvidenceContent {
  bytes: Buffer;
  fileName: string;
}

export interface SafetyAlertIdentityFrameContent extends SafetyAlertEvidenceContent {
  sha256: string;
}

interface ParsedEvidenceItem {
  kind: SafetyAlertEvidenceKind;
  uri: string;
  trackId?: number;
}

interface ParsedLocalEvidenceUri {
  streamSessionId: string;
  sequenceNumber: number;
  eventId: string;
}

function evidenceItems(rawPayload: unknown): unknown[] {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return [];
  const value = (rawPayload as { evidence?: unknown }).evidence;
  return Array.isArray(value) ? value.slice(0, MAX_EVIDENCE_ITEMS) : [];
}

function parseEvidenceItem(value: unknown): ParsedEvidenceItem | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as { kind?: unknown; uri?: unknown; trackId?: unknown };
  if (candidate.kind !== 'FRAME' && candidate.kind !== 'CROP' && candidate.kind !== 'SNAPSHOT')
    return undefined;
  if (typeof candidate.uri !== 'string' || candidate.uri.length === 0) return undefined;
  if (
    candidate.trackId !== undefined &&
    (!Number.isSafeInteger(candidate.trackId) || (candidate.trackId as number) < 0)
  )
    return undefined;
  return {
    kind: candidate.kind,
    uri: candidate.uri,
    ...(candidate.trackId === undefined ? {} : { trackId: candidate.trackId as number }),
  };
}

function parseLocalEvidenceUri(
  uri: string,
  expectedEventId: string,
): ParsedLocalEvidenceUri | undefined {
  const match = LOCAL_EVIDENCE_URI.exec(uri);
  if (!match) return undefined;
  const [, streamSessionId, sequence, eventId] = match;
  if (
    !streamSessionId ||
    !eventId ||
    !isUUID(streamSessionId) ||
    !isUUID(eventId) ||
    eventId.toLowerCase() !== expectedEventId.toLowerCase()
  )
    return undefined;
  const sequenceNumber = Number(sequence);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 0) return undefined;
  return { streamSessionId, sequenceNumber, eventId };
}

function evidenceIndex(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) return invalid();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed >= MAX_EVIDENCE_ITEMS) return invalid();
  return parsed;
}

function isJpeg(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

@Injectable()
export class SafetyAlertEvidenceService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<BackendEnvironment, true>,
  ) {}

  summarize(rawPayload: unknown, eventId: string): SafetyAlertEvidenceSummary[] {
    const configuredRoot = this.configService.get('EVIDENCE_LOCAL_ROOT', { infer: true });
    return evidenceItems(rawPayload).flatMap((value, index) => {
      const item = parseEvidenceItem(value);
      if (!item) return [];
      return [
        {
          index,
          kind: item.kind,
          ...(item.trackId === undefined ? {} : { trackId: item.trackId }),
          available:
            configuredRoot !== undefined && parseLocalEvidenceUri(item.uri, eventId) !== undefined,
        },
      ];
    });
  }

  async read(
    siteId: string,
    alertId: string,
    eventId: string,
    rawIndex: string,
  ): Promise<SafetyAlertEvidenceContent> {
    const event = uuid(eventId);
    const index = evidenceIndex(rawIndex);

    const { observationEvent } = await this.loadScopedEvent(siteId, alertId, event);
    const item = parseEvidenceItem(evidenceItems(observationEvent.rawPayload)[index]);
    if (!item) return missing();
    const local = parseLocalEvidenceUri(item.uri, event);
    if (!local) return missing();
    return this.readLocalJpeg(local);
  }

  /** New review commands require immutable full-frame evidence, not a track-scoped crop. */
  async readFrameForIdentityReview(
    siteId: string,
    alertId: string,
    eventId: string,
    rawIndex: string,
    expectedEventHash: string,
  ): Promise<SafetyAlertIdentityFrameContent> {
    const event = uuid(eventId);
    const index = evidenceIndex(rawIndex);
    const { observationEvent } = await this.loadScopedEvent(siteId, alertId, event);
    const raw = observationEvent.rawPayload;
    if (!validateObservationEvent(raw).isValid) return this.reviewConflict();
    const payload = raw as { eventId: string; streamSessionId: string; cameraExternalId: string };
    if (
      observationEvent.payloadHash !== expectedEventHash ||
      computeCanonicalPayloadHash(raw) !== observationEvent.payloadHash ||
      payload.eventId.toLowerCase() !== event.toLowerCase() ||
      payload.streamSessionId.toLowerCase() !== observationEvent.streamSessionId.toLowerCase() ||
      payload.cameraExternalId !== observationEvent.cameraExternalId ||
      observationEvent.resolvedCameraId === null
    )
      return this.reviewConflict();
    // Historical Site ownership comes from alert mappings, never today's Camera configuration.
    const conflictingSiteMapping = await this.dataSource
      .getRepository(AlertDetectionMappingEntity)
      .createQueryBuilder('mapping')
      .innerJoin(SafetyAlertEntity, 'mappedAlert', 'mappedAlert.id = mapping.alertId')
      .where('mapping.eventId = :eventId', { eventId: event })
      .andWhere('mappedAlert.siteId <> :siteId', { siteId: uuid(siteId) })
      .getExists();
    if (conflictingSiteMapping) return this.reviewConflict();
    const item = parseEvidenceItem(evidenceItems(raw)[index]);
    if (!item || item.kind !== 'FRAME') return missing();
    const local = parseLocalEvidenceUri(item.uri, event);
    if (!local || local.streamSessionId.toLowerCase() !== payload.streamSessionId.toLowerCase())
      return missing();
    const content = await this.readLocalJpeg(local);
    return { ...content, sha256: createHash('sha256').update(content.bytes).digest('hex') };
  }

  private reviewConflict(): never {
    throw new PublicHttpException(HttpStatus.CONFLICT, {
      code: 'CONFLICT',
      message: 'Observation identity evidence is inconsistent',
    });
  }

  private async loadScopedEvent(
    siteId: string,
    alertId: string,
    eventId: string,
  ): Promise<{
    alert: SafetyAlertEntity;
    observationEvent: AiObservationEventEntity;
  }> {
    const scope = uuid(siteId);
    const alertIdValue = uuid(alertId);
    const event = uuid(eventId);

    const alertExists = await this.dataSource
      .getRepository(SafetyAlertEntity)
      .findOneBy({ id: alertIdValue, siteId: scope });
    if (!alertExists) return missing();

    const mapping = await this.dataSource
      .getRepository(AlertDetectionMappingEntity)
      .findOneBy({ alertId: alertIdValue, eventId: event });
    if (!mapping) return missing();

    const observationEvent = await this.dataSource
      .getRepository(AiObservationEventEntity)
      .findOneBy({ eventId: event });
    if (!observationEvent) return missing();

    return { alert: alertExists, observationEvent };
  }

  private async readLocalJpeg(local: ParsedLocalEvidenceUri): Promise<SafetyAlertEvidenceContent> {
    const configuredRoot = this.configService.get('EVIDENCE_LOCAL_ROOT', { infer: true });
    if (!configuredRoot || !isAbsolute(configuredRoot)) return missing();
    const fileName = `${local.streamSessionId}_${local.sequenceNumber}_${local.eventId}.jpg`;

    try {
      const rootStats = await lstat(configuredRoot);
      if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return missing();
      const resolvedRoot = await realpath(configuredRoot);
      const candidate = join(resolvedRoot, fileName);
      if (dirname(candidate) !== resolvedRoot) return missing();
      const candidateStats = await lstat(candidate);
      if (
        !candidateStats.isFile() ||
        candidateStats.isSymbolicLink() ||
        candidateStats.size < 1 ||
        candidateStats.size > MAX_LOCAL_JPEG_BYTES
      )
        return missing();
      const resolvedCandidate = await realpath(candidate);
      if (dirname(resolvedCandidate) !== resolvedRoot) return missing();
      await access(resolvedCandidate, constants.R_OK);
      const bytes = await readFile(resolvedCandidate);
      if (bytes.length > MAX_LOCAL_JPEG_BYTES || !isJpeg(bytes)) return missing();
      return { bytes, fileName };
    } catch (error) {
      if (error instanceof PublicHttpException) throw error;
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP' || code === 'EACCES') {
        return missing();
      }
      throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Evidence is temporarily unavailable',
      });
    }
  }
}
