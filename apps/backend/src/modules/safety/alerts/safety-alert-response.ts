import type { SafetyAlertEntity } from '../../../database/entities/safety-alert.entity.js';
export function alertResponse(alert: SafetyAlertEntity) {
  return {
    id: alert.id,
    siteId: alert.siteId,
    zoneId: alert.zoneId,
    incidentId: alert.incidentId,
    candidateWorkerId: alert.candidateWorkerId,
    alertType: alert.alertType,
    candidateSubtype: alert.candidateSubtype,
    status: alert.status,
    firstDetectedAt: alert.firstDetectedAt,
    lastDetectedAt: alert.lastDetectedAt,
    detectionCount: alert.detectionCount,
    revision: alert.revision,
    createdAt: alert.createdAt,
    updatedAt: alert.updatedAt,
  };
}
