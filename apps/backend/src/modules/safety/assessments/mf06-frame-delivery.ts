import type { Mf06AssessmentResponse } from '@smartsite/contracts';
import type { EntityManager } from 'typeorm';
import { In } from 'typeorm';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { readConsistentMf06RawEvent } from './mf06-observation-event.js';

type Delivery = NonNullable<Mf06AssessmentResponse['frameDelivery']>;

/** Runs inside the caller's scoped read snapshot. Counts persisted parts, never alerts or jobs. */
export async function readMf06FrameDeliveries(
  manager: EntityManager,
  records: readonly Mf06AssessmentResponse[],
): Promise<Map<string, Delivery>> {
  const result = new Map<string, Delivery>();
  if (!records.length) return result;
  const repository = manager.getRepository(AiObservationEventEntity);
  const roots = await repository.findBy({ eventId: In(records.map((record) => record.eventId)) });
  const byId = new Map(roots.map((event) => [event.eventId, event]));
  const cache = new Map<string, Delivery>();
  for (const record of records) {
    const event = byId.get(record.eventId);
    if (!event) continue; // Historical legacy assessments may outlive their raw event.
    if ((event.rawPayload as { schemaVersion?: unknown } | null)?.schemaVersion !== '1.4.0')
      continue;
    const raw = readConsistentMf06RawEvent(event);
    if (!raw || event.resolvedCameraId !== record.cameraId)
      throw new Error('Invalid frame binding');
    const part = raw.framePartition as {
      frameId: string;
      sequenceNumber: string;
      partCount: number;
    };
    const key = `${record.cameraId}:${event.streamSessionId}:${part.frameId}`;
    let delivery = cache.get(key);
    if (!delivery) {
      // Bound each frame independently rather than loading up to 100*1024 full payloads at once.
      const siblings = await repository
        .createQueryBuilder('event')
        .where('event.resolved_camera_id=:cameraId AND event.stream_session_id=:sessionId', {
          cameraId: record.cameraId,
          sessionId: event.streamSessionId,
        })
        .andWhere("event.raw_payload->>'schemaVersion'='1.4.0'")
        .andWhere("event.raw_payload#>>'{framePartition,frameId}'=:frameId", {
          frameId: part.frameId,
        })
        .take(1025)
        .getMany();
      if (!siblings.length || siblings.length > part.partCount)
        throw new Error('Invalid frame parts');
      const indices = new Set<number>();
      for (const sibling of siblings) {
        const siblingRaw = readConsistentMf06RawEvent(sibling);
        const siblingPart = siblingRaw?.framePartition as
          (typeof part & { partIndex: number }) | undefined;
        if (
          !siblingRaw ||
          !siblingPart ||
          siblingPart.frameId !== part.frameId ||
          siblingPart.sequenceNumber !== part.sequenceNumber ||
          siblingPart.partCount !== part.partCount ||
          siblingRaw.capturedAt !== raw.capturedAt ||
          (siblingRaw.frameDimensions as { width: number }).width !==
            (raw.frameDimensions as { width: number }).width ||
          (siblingRaw.frameDimensions as { height: number }).height !==
            (raw.frameDimensions as { height: number }).height ||
          indices.has(siblingPart.partIndex)
        )
          throw new Error('Invalid frame parts');
        indices.add(siblingPart.partIndex);
      }
      delivery = {
        frameId: part.frameId,
        sequenceNumber: part.sequenceNumber,
        partCount: part.partCount,
        receivedParts: indices.size,
        status: indices.size === part.partCount ? 'COMPLETE' : 'PARTIAL',
      };
      cache.set(key, delivery);
    }
    result.set(record.eventId, delivery);
  }
  return result;
}
