import type { EntityManager } from 'typeorm';
import { GateEntity } from '../../database/entities/gate.entity.js';
import { CameraEntity } from '../../database/entities/camera.entity.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { conflict, missing, uuid } from '../../common/configuration/commands.js';

export async function requireActiveGate(manager: EntityManager, siteId: string, gateId: string) {
  const gate = await manager.getRepository(GateEntity).findOne({
    where: { id: uuid(gateId).toLowerCase(), siteId: uuid(siteId).toLowerCase() },
    ...(manager.queryRunner?.isTransactionActive
      ? { lock: { mode: 'pessimistic_read' as const } }
      : {}),
  });
  if (!gate) missing();
  if (gate.status !== 'ACTIVE') conflict('Gate is inactive');
  return gate;
}

export async function requireFaceSource(
  manager: EntityManager,
  siteId: string,
  gateId: string,
  sourceCameraId: string,
) {
  const gate = await requireActiveGate(manager, siteId, gateId);
  const camera = await manager.getRepository(CameraEntity).findOne({
    where: {
      id: uuid(sourceCameraId).toLowerCase(),
      siteId: gate.siteId,
      gateId: gate.id,
      type: 'GATE',
      status: CameraStatus.ACTIVE,
    },
    ...(manager.queryRunner?.isTransactionActive
      ? { lock: { mode: 'pessimistic_read' as const } }
      : {}),
  });
  if (!camera) conflict('An active registered Camera for this Gate is required');
  return { gate, camera };
}
