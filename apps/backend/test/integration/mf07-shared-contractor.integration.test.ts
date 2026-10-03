import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { ContractorRepresentativeGrantEntity } from '../../src/database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../../src/database/entities/contractor-site-participation.entity.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';
import { SiteEntity } from '../../src/database/entities/site.entity.js';
import { WorkerSiteZoneAssignmentEntity } from '../../src/database/entities/worker-site-zone-assignment.entity.js';
import { UserRoleAssignmentEntity } from '../../src/database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../src/database/entities/user.entity.js';
import { ZoneEntity } from '../../src/database/entities/zone.entity.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { ContractorOperationsService } from '../../src/modules/workforce/contractor-operations.service.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/schedule-configuration.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling-workflow.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/workforce-configuration.service.js';
import dataSource from '../support/test-data-source.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('MF07 Site setup reuses one Contractor across Sites and shares Representative grants with main', async () => {
  await dataSource.initialize();
  const suffix = randomUUID().slice(0, 8);
  const [siteA, siteB, siteC] = [randomUUID(), randomUUID(), randomUUID()];
  await dataSource.getRepository(SiteEntity).save([
    { id: siteA, code: `SA_${suffix}`, name: 'Site A', isActive: true },
    { id: siteB, code: `SB_${suffix}`, name: 'Site B', isActive: true },
    { id: siteC, code: `SC_${suffix}`, name: 'Site C', isActive: true },
  ]);
  const repId = randomUUID();
  await dataSource.getRepository(UserEntity).save({
    id: repId, username: `rep_${suffix}`, displayName: 'Representative',
    passwordHash: 'synthetic-test-only', isActive: true, mustChangePassword: false,
  });
  await dataSource.getRepository(UserRoleAssignmentEntity).save([
    { id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA },
    { id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteB },
    { id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteC },
  ]);
  const admin: AuthenticatedUser = {
    id: randomUUID(), username: 'admin', displayName: 'Admin', isActive: true,
    mustChangePassword: false, roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  const rep: AuthenticatedUser = {
    id: repId, username: `rep_${suffix}`, displayName: 'Representative', isActive: true,
    mustChangePassword: false,
    roleAssignments: [siteA, siteB, siteC].map(siteId => ({ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId })),
  };
  const workforce = new WorkforceConfigurationService(dataSource);
  const main = new ContractorOperationsService(dataSource);
  const input = { code: `C_${suffix}`, name: 'Shared Contractor' };
  const first = await workforce.createContractor(siteA, input);
  const second = await workforce.createContractor(siteB, input);
  assert.equal(first.id, second.id);
  assert.equal((await workforce.listContractors(admin, siteA)).total, 1);
  assert.equal((await workforce.listContractors(admin, siteB)).total, 1);
  assert.equal((await workforce.listContractors(admin, siteC)).total, 0);
  assert.equal(await dataSource.getRepository(ContractorSiteParticipationEntity).countBy({ contractorId: first.id }), 2);
  await assert.rejects(workforce.assignRepresentative(siteC, first.id, { userId: repId }));
  const assignmentA = await workforce.assignRepresentative(siteA, first.id, { userId: repId });
  const assignmentB = await workforce.assignRepresentative(siteB, first.id, { userId: repId });
  assert.notEqual(assignmentA.id, assignmentB.id);
  assert.equal((await workforce.listRepresentativeAssignments(siteA)).total, 1);
  assert.equal((await workforce.listRepresentativeAssignments(siteB)).total, 1);
  assert.equal(await dataSource.getRepository(ContractorRepresentativeGrantEntity).countBy({
    contractorId: first.id, userId: repId,
  }), 1);
  const worker = await main.createWorker(rep, first.id, {
    siteId: siteB, externalId: `W_${suffix}`, displayName: 'Site B Worker',
  });
  assert.equal(worker.siteId, siteB);
  const zoneId = randomUUID();
  await dataSource.getRepository(ZoneEntity).save({
    id: zoneId, siteId: siteA, code: `Z_${suffix}`, name: 'Site A Zone',
    type: ZoneType.STANDARD, restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    requiredPpe: [], configurationLocked: false,
  });
  await assert.rejects(main.requestAssignment(rep, worker.id, {
    siteId: siteA, zoneIds: [zoneId], validFrom: new Date().toISOString(), validUntil: null,
  }));
  assert.equal(await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).countBy({ workerId: worker.id }), 0);
  await assert.rejects(main.createWorker(rep, first.id, {
    siteId: siteC, externalId: `WC_${suffix}`, displayName: 'Denied Worker',
  }));
  await dataSource.getRepository(UserRoleAssignmentEntity).delete({
    userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteB,
  });
  const repWithoutSiteB = {
    ...rep,
    roleAssignments: rep.roleAssignments.filter(assignment => assignment.siteId !== siteB),
  };
  await assert.rejects(workforce.list(repWithoutSiteB, siteB));
  await assert.rejects(workforce.listContractors(repWithoutSiteB, siteB));
  await assert.rejects(new ScheduleConfigurationService(dataSource).listWorkerSchedules(repWithoutSiteB, siteB));
  await assert.rejects(new SchedulingWorkflowService(dataSource).listShiftChangeRequests(repWithoutSiteB, siteB));
  await dataSource.getRepository(UserRoleAssignmentEntity).save({
    id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteB,
  });
  await dataSource.getRepository(ContractorSiteParticipationEntity).update(
    { contractorId: first.id, siteId: siteB }, { isActive: false },
  );
  assert.equal((await workforce.listContractors(admin, siteB)).total, 0);
  await assert.rejects(workforce.list(rep, siteB));
  await assert.rejects(new ScheduleConfigurationService(dataSource).listWorkerSchedules(rep, siteB));
  await assert.rejects(new SchedulingWorkflowService(dataSource).listShiftChangeRequests(rep, siteB));
  await assert.rejects(main.createWorker(rep, first.id, {
    siteId: siteB, externalId: `WD_${suffix}`, displayName: 'Revoked Worker',
  }));
});
