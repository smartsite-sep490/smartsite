import { SiteEntity } from './site.entity.js';
import { CameraEntity } from './camera.entity.js';
import { ZoneEntity } from './zone.entity.js';
import { CameraObservationRegionEntity } from './camera-observation-region.entity.js';
import { AiObservationEventEntity } from './ai-observation-event.entity.js';
import { SafetyAlertEntity } from './safety-alert.entity.js';
import { AlertDetectionMappingEntity } from './alert-detection-mapping.entity.js';
import { UserEntity } from './user.entity.js';
import { AuthSessionEntity } from './auth-session.entity.js';

export * from './enums.js';
export * from './numeric.transformer.js';
export * from './site.entity.js';
export * from './camera.entity.js';
export * from './zone.entity.js';
export * from './camera-observation-region.entity.js';
export * from './ai-observation-event.entity.js';
export * from './safety-alert.entity.js';
export * from './alert-detection-mapping.entity.js';
export * from './user.entity.js';
export * from './auth-session.entity.js';

export const ENTITIES = [
  SiteEntity,
  CameraEntity,
  ZoneEntity,
  CameraObservationRegionEntity,
  AiObservationEventEntity,
  SafetyAlertEntity,
  AlertDetectionMappingEntity,
  UserEntity,
  AuthSessionEntity,
] as const;
