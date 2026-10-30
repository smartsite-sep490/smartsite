import { HttpStatus } from '@nestjs/common';
import {
  computeCanonicalPayloadHash,
  validatePartitionedObservationEvent,
  type ObservationFramePartition,
} from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import type { AdmittedObservationFrame } from '../../modules/safety/alerts/durable-grouping.service.js';

interface PartEvent {
  eventId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  frameDimensions: { width: number; height: number };
  framePartition: ObservationFramePartition;
  observations: Array<Record<string, unknown> & { trackId: number; type: string }>;
  evidence: Array<{ kind: string; sha256: string }>;
}

function conflict(): never {
  throw new PublicHttpException(HttpStatus.CONFLICT, {
    code: 'CONFLICT',
    message: 'Frame part conflicts with an already admitted frame',
  });
}
function unavailable(): never {
  throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
    code: 'AI_INGESTION_UNAVAILABLE',
    message: 'AI ingestion is temporarily unavailable',
  });
}
function contexts(event: PartEvent): Map<number, string> {
  const byTrack = new Map<number, string[]>();
  for (const observation of event.observations) {
    if (observation.type !== 'PERSON' && observation.type !== 'IDENTITY_CANDIDATE') continue;
    const values = byTrack.get(observation.trackId) ?? [];
    values.push(computeCanonicalPayloadHash(observation));
    byTrack.set(observation.trackId, values);
  }
  return new Map(
    [...byTrack].map(([track, values]) => [track, computeCanonicalPayloadHash(values.sort())]),
  );
}

function regions(event: PartEvent): Set<string> {
  return new Set(
    event.observations
      .filter((observation) => observation.type === 'PPE' || observation.type === 'ZONE_ENTRY')
      .map(
        (observation) =>
          `${observation.trackId}:${String(observation.regionId).toLowerCase()}:${observation.geometryVersion}`,
      ),
  );
}

function frameDigest(event: PartEvent): string | undefined {
  const digests = new Set(
    event.evidence.filter((item) => item.kind === 'FRAME').map((item) => item.sha256),
  );
  if (digests.size > 1) conflict();
  return digests.values().next().value;
}

/** Only the active ingestion transaction can establish scoped frame correlation. */
export async function admitPartitionedFrame(
  manager: EntityManager,
  payload: unknown,
  cameraId: string,
): Promise<AdmittedObservationFrame | undefined> {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('schemaVersion' in payload) ||
    payload.schemaVersion !== '1.4.0'
  )
    return undefined;
  const validation = validatePartitionedObservationEvent(payload);
  if (!validation.isValid) {
    throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      issues: validation.issues,
    });
  }
  if (!manager.queryRunner?.isTransactionActive) unavailable();
  const event = payload as unknown as PartEvent;
  const scope = Object.freeze({
    cameraId,
    streamSessionId: event.streamSessionId.toLowerCase(),
    frameId: event.framePartition.frameId,
  });
  const lockKeys = [
    `ai-frame:${cameraId}:${scope.streamSessionId}:${scope.frameId}`,
    `ai-frame-sequence:${cameraId}:${scope.streamSessionId}:${event.framePartition.sequenceNumber}`,
  ].sort();
  for (const key of lockKeys)
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  const rows = await manager.query<
    Array<{ eventId: string; payloadHash: string; rawPayload: unknown }>
  >(
    `SELECT event_id AS "eventId",payload_hash AS "payloadHash",raw_payload AS "rawPayload"
     FROM ai_observation_event WHERE resolved_camera_id=$1 AND stream_session_id=$2
       AND raw_payload->>'schemaVersion'='1.4.0'
       AND (raw_payload#>>'{framePartition,frameId}'=$3
         OR raw_payload#>>'{framePartition,sequenceNumber}'=$4)
     ORDER BY event_id LIMIT 1025`,
    [cameraId, scope.streamSessionId, scope.frameId, event.framePartition.sequenceNumber],
  );
  if (rows.length > 1024) unavailable();
  const priorContexts = new Map<number, string>();
  const priorRegions = new Set<string>();
  const currentRegions = regions(event);
  const currentHash = computeCanonicalPayloadHash(event);
  const original = rows.find((row) => row.eventId.toLowerCase() === event.eventId.toLowerCase());
  if (original) {
    if (
      !validatePartitionedObservationEvent(original.rawPayload).isValid ||
      computeCanonicalPayloadHash(original.rawPayload) !== original.payloadHash
    )
      unavailable();
    if (original.payloadHash !== currentHash) {
      throw new PublicHttpException(HttpStatus.CONFLICT, {
        code: 'AI_EVENT_ID_CONFLICT',
        message: 'Event ID already exists with a different payload',
      });
    }
  }
  let imageDigest = frameDigest(event);
  for (const row of rows) {
    if (
      !validatePartitionedObservationEvent(row.rawPayload).isValid ||
      computeCanonicalPayloadHash(row.rawPayload) !== row.payloadHash
    )
      unavailable();
    const prior = row.rawPayload as PartEvent;
    const priorDigest = frameDigest(prior);
    if (imageDigest && priorDigest && imageDigest !== priorDigest) conflict();
    imageDigest ??= priorDigest;
    if (
      prior.eventId.toLowerCase() !== row.eventId.toLowerCase() ||
      prior.streamSessionId.toLowerCase() !== scope.streamSessionId
    )
      unavailable();
    if (
      prior.framePartition.frameId !== scope.frameId ||
      prior.cameraExternalId !== event.cameraExternalId ||
      prior.capturedAt !== event.capturedAt ||
      prior.frameDimensions.width !== event.frameDimensions.width ||
      prior.frameDimensions.height !== event.frameDimensions.height ||
      prior.framePartition.sequenceNumber !== event.framePartition.sequenceNumber ||
      prior.framePartition.partCount !== event.framePartition.partCount
    )
      conflict();
    if (
      prior.framePartition.partIndex === event.framePartition.partIndex &&
      (row.eventId.toLowerCase() !== event.eventId.toLowerCase() || row.payloadHash !== currentHash)
    )
      conflict();
    for (const [track, hash] of contexts(prior)) {
      if (priorContexts.has(track) && priorContexts.get(track) !== hash) unavailable();
      priorContexts.set(track, hash);
    }
    for (const key of regions(prior)) {
      if (priorRegions.has(key)) unavailable();
      priorRegions.add(key);
      if (
        prior.framePartition.partIndex !== event.framePartition.partIndex &&
        currentRegions.has(key)
      )
        conflict();
    }
  }
  for (const [track, hash] of contexts(event)) {
    if (priorContexts.has(track) && priorContexts.get(track) !== hash) conflict();
  }
  return scope;
}
