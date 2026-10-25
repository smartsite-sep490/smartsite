import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  resolveEventLocalEpisodeSubject,
  type SafetyObservationFindingsResponse,
} from '@smartsite/contracts';
import { missing, page, uuid } from '../../../common/configuration/commands.js';
import { AiObservationEventEntity } from '../../../database/entities/ai-observation-event.entity.js';
import { AlertDetectionMappingEntity } from '../../../database/entities/alert-detection-mapping.entity.js';
import { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
import { EventProcessingStatus } from '../../../database/entities/enums.js';
import { reviewRawEventIsConsistent } from '../identity/observation-identity-event.js';

@Injectable()
export class SafetyObservationFindingsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    siteId: string,
    alertId: string,
    eventId: string,
    offset = 0,
    limit = 20,
  ): Promise<SafetyObservationFindingsResponse> {
    const scope = uuid(siteId),
      alert = uuid(alertId),
      event = uuid(eventId);
    const bounds = page(offset, limit);
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      if (!(await manager.getRepository(SafetyAlertEntity).existsBy({ id: alert, siteId: scope })))
        return missing();
      const mappings = manager.getRepository(AlertDetectionMappingEntity);
      const anchor = await mappings.findOneBy({ alertId: alert, eventId: event });
      if (!anchor) return missing();
      const unresolved: SafetyObservationFindingsResponse = { subject: null, items: [], total: 0 };
      if (anchor.personObservationIndex === null) return unresolved;
      const observation = await manager
        .getRepository(AiObservationEventEntity)
        .findOneBy({ eventId: event });
      if (!observation) return missing();
      if (
        observation.processingStatus !== EventProcessingStatus.PROCESSED ||
        !reviewRawEventIsConsistent(observation)
      )
        return unresolved;
      const payload = observation.rawPayload as {
        observations: { type: string; trackId: number }[];
      };
      const subject = resolveEventLocalEpisodeSubject(
        event,
        payload.observations,
        anchor.personObservationIndex,
      );
      if (!subject) return unresolved;
      // Historical Site comes from mappings; today's Camera Site may have changed.
      if (
        await mappings
          .createQueryBuilder('m')
          .innerJoin(SafetyAlertEntity, 'a', 'a.id = m.alertId')
          .where('m.eventId = :event', { event })
          .andWhere('a.siteId <> :scope', { scope })
          .getExists()
      )
        return unresolved;
      const query = manager
        .getRepository(SafetyAlertEntity)
        .createQueryBuilder('a')
        .innerJoin(AlertDetectionMappingEntity, 'm', 'm.alertId = a.id')
        .where('a.siteId = :scope', { scope })
        .andWhere('m.eventId = :event', { event })
        .andWhere('m.personObservationIndex = :index', { index: subject.personObservationIndex });
      const total = await query.getCount();
      const rows = await query
        .orderBy('a.id', 'ASC')
        .skip(bounds.offset)
        .take(bounds.limit)
        .getMany();
      const items = rows.map(({ id, alertType, candidateSubtype, zoneId, status, revision }) => ({
        id,
        alertType,
        candidateSubtype,
        zoneId,
        status,
        revision,
      }));
      return { subject, items, total };
    });
  }
}
