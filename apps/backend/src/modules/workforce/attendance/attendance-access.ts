import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../../common/http/public-http-exception.js';
import {
  ContractorRepresentativeAssignmentEntity,
  UserEntity,
  UserRoleAssignmentEntity,
  UserRole,
  WorkerEntity,
} from '../../../database/entities/index.js';
import { hasActiveContractorParticipation } from '../shared/contractor-participation.js';
import type { WorkforceActor } from '../directory/contractor-operations.service.js';

export async function attendanceAccess(
  manager: EntityManager,
  actor: WorkforceActor,
  worker: WorkerEntity,
  review = false,
) {
  const user = await manager
    .getRepository(UserEntity)
    .findOneBy({ id: actor.id, isActive: true, mustChangePassword: false });
  if (!user || !worker.isActive)
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'Attendance is unavailable for this account',
    });
  const roles = await manager.getRepository(UserRoleAssignmentEntity).findBy({ userId: actor.id });
  const representative =
    roles.some(
      (r) => r.siteId === worker.siteId && r.role === UserRole.CONTRACTOR_REPRESENTATIVE,
    ) &&
    worker.contractorId &&
    (await manager
      .getRepository(ContractorRepresentativeAssignmentEntity)
      .existsBy({ siteId: worker.siteId, contractorId: worker.contractorId, userId: actor.id }));
  const participation = worker.contractorId
    ? await hasActiveContractorParticipation(manager, worker.contractorId, worker.siteId)
    : false;
  if (
    !review &&
    participation &&
    worker.userId === actor.id &&
    roles.some((r) => r.siteId === worker.siteId && r.role === UserRole.WORKER)
  )
    return 'SELF' as const;
  if (representative && participation) return 'REPRESENTATIVE' as const;
  if (
    !review &&
    roles.some(
      (r) =>
        (r.role === UserRole.ADMIN && r.siteId === null) ||
        (r.siteId === worker.siteId &&
          [UserRole.SITE_MANAGER, UserRole.SECURITY_OFFICER].includes(r.role)),
    )
  )
    return 'STAFF' as const;
  throw new PublicHttpException(403, {
    code: 'FORBIDDEN',
    message: 'Attendance is outside your scope',
  });
}
