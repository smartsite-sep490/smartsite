import { participateContractor } from '../support/contractor-participation.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ContractorRepresentativeGrantEntity } from '../../src/database/entities/contractor-representative-grant.entity.js';
import { ContractorSiteParticipationEntity } from '../../src/database/entities/contractor-site-participation.entity.js';
import { ZoneRestrictionPolicy, ZoneType } from '../../src/database/entities/enums.js';
import { SiteEntity } from '../../src/database/entities/site.entity.js';
import { WorkerSiteZoneAssignmentEntity } from '../../src/database/entities/worker-site-zone-assignment.entity.js';
import { UserRoleAssignmentEntity } from '../../src/database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../src/database/entities/user.entity.js';
import { ZoneEntity } from '../../src/database/entities/zone.entity.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { MainWorkforceCreateService } from '../../src/modules/workforce/main-workforce-create.service.js';
import { MainRepresentativeCommandService } from '../../src/modules/workforce/main-representative-command.service.js';
import { MainAssignmentCommandService } from '../../src/modules/zones/main-assignment-command.service.js';
import { ScheduleConfigurationService } from '../../src/modules/workforce/scheduling/schedule-configuration.service.js';
import { SchedulingWorkflowService } from '../../src/modules/workforce/scheduling/scheduling-workflow.service.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true });
const dataSource = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());

test('MF07 Site setup reuses one Contractor across Sites and shares Representative grants with main', async () => {
  const suffix = randomUUID().slice(0, 8);
  const [siteA, siteB, siteC] = [randomUUID(), randomUUID(), randomUUID()];
  await dataSource.getRepository(SiteEntity).save([
    { id: siteA, code: `SA_${suffix}`, name: 'Site A', isActive: true },
    { id: siteB, code: `SB_${suffix}`, name: 'Site B', isActive: true },
    { id: siteC, code: `SC_${suffix}`, name: 'Site C', isActive: true },
  ]);
  const repId = randomUUID();
  await dataSource.getRepository(UserEntity).save({
    id: repId,
    username: `rep_${suffix}`,
    displayName: 'Representative',
    passwordHash: 'synthetic-test-only',
    isActive: true,
    mustChangePassword: false,
  });
  await dataSource.getRepository(UserRoleAssignmentEntity).save([
    { id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA },
    { id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteB },
    { id: randomUUID(), userId: repId, role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteC },
  ]);
  const admin: AuthenticatedUser = {
    id: randomUUID(),
    username: 'admin',
    displayName: 'Admin',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  const rep: AuthenticatedUser = {
    id: repId,
    username: `rep_${suffix}`,
    displayName: 'Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [siteA, siteB, siteC].map((siteId) => ({
      role: UserRole.CONTRACTOR_REPRESENTATIVE,
      siteId,
    })),
  };
  const workforce = new WorkforceConfigurationService(dataSource);
  await dataSource.getRepository(UserEntity).save({
    id: admin.id,
    username: `manager_${suffix}`,
    displayName: 'Synthetic setup Manager',
    passwordHash: 'synthetic-test-only',
    isActive: true,
    mustChangePassword: false,
  });
  await dataSource.getRepository(UserRoleAssignmentEntity).save(
    [siteA, siteB, siteC].map((siteId) => ({
      id: randomUUID(),
      userId: admin.id,
      role: UserRole.SITE_MANAGER,
      siteId,
    })),
  );
  await dataSource.getRepository(UserRoleAssignmentEntity).save({
    id: randomUUID(),
    userId: admin.id,
    role: UserRole.ADMIN,
    siteId: null,
  });
  const main = new MainWorkforceCreateService(dataSource);
  const representatives = new MainRepresentativeCommandService(dataSource);
  const assignments = new MainAssignmentCommandService(dataSource);
  const context = { actorUserId: admin.id };
  const representativeContext = { actorUserId: repId };
  const input = { code: `C_${suffix}`, name: 'Shared Contractor' };
  const first = await main.createSiteContractor(siteA, input, context);
  const second = await main.createSiteContractor(siteB, input, context);
  assert.equal(first.id, second.id);
  await participateContractor(dataSource, siteA, first.id);
  await participateContractor(dataSource, siteB, first.id);
  assert.equal((await workforce.listContractors(admin, siteA)).total, 1);
  assert.equal((await workforce.listContractors(admin, siteB)).total, 1);
  assert.equal((await workforce.listContractors(admin, siteC)).total, 0);
  assert.equal(
    await dataSource
      .getRepository(ContractorSiteParticipationEntity)
      .countBy({ contractorId: first.id }),
    2,
  );
  await assert.rejects(representatives.assign(siteC, first.id, { userId: repId }, context));
  const assignmentA = await representatives.assign(siteA, first.id, { userId: repId }, context);
  const assignmentB = await representatives.assign(siteB, first.id, { userId: repId }, context);
  assert.notEqual(assignmentA.id, assignmentB.id);
  assert.equal((await workforce.listRepresentativeAssignments(siteA)).total, 1);
  assert.equal((await workforce.listRepresentativeAssignments(siteB)).total, 1);
  assert.equal(
    await dataSource.getRepository(ContractorRepresentativeGrantEntity).countBy({
      contractorId: first.id,
      userId: repId,
    }),
    1,
  );
  const worker = await main.createWorker(
    first.id,
    {
      siteId: siteB,
      externalId: `W_${suffix}`,
      displayName: 'Site B Worker',
    },
    representativeContext,
  );
  assert.equal(worker.siteId, siteB);
  const zoneId = randomUUID();
  await dataSource.getRepository(ZoneEntity).save({
    id: zoneId,
    siteId: siteA,
    code: `Z_${suffix}`,
    name: 'Site A Zone',
    type: ZoneType.STANDARD,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    requiredPpe: [],
    configurationLocked: false,
  });
  await assert.rejects(
    assignments.publicRequest(
      worker.id,
      {
        siteId: siteA,
        zoneIds: [zoneId],
        validFrom: new Date().toISOString(),
        validUntil: null,
      },
      representativeContext,
    ),
  );
  assert.equal(
    await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).countBy({ workerId: worker.id }),
    0,
  );
  await assert.rejects(
    main.createWorker(
      first.id,
      {
        siteId: siteC,
        externalId: `WC_${suffix}`,
        displayName: 'Denied Worker',
      },
      representativeContext,
    ),
  );
  await dataSource.getRepository(UserRoleAssignmentEntity).delete({
    userId: repId,
    role: UserRole.CONTRACTOR_REPRESENTATIVE,
    siteId: siteB,
  });
  const repWithoutSiteB = {
    ...rep,
    roleAssignments: rep.roleAssignments.filter((assignment) => assignment.siteId !== siteB),
  };
  await assert.rejects(workforce.list(repWithoutSiteB, siteB));
  await assert.rejects(workforce.listContractors(repWithoutSiteB, siteB));
  await assert.rejects(
    new ScheduleConfigurationService(dataSource).listWorkerSchedules(repWithoutSiteB, siteB),
  );
  await assert.rejects(
    new SchedulingWorkflowService(dataSource).listShiftChangeRequests(repWithoutSiteB, siteB),
  );
  await dataSource.getRepository(UserRoleAssignmentEntity).save({
    id: randomUUID(),
    userId: repId,
    role: UserRole.CONTRACTOR_REPRESENTATIVE,
    siteId: siteB,
  });
  await dataSource
    .getRepository(ContractorSiteParticipationEntity)
    .update({ contractorId: first.id, siteId: siteB }, { isActive: false });
  assert.equal((await workforce.listContractors(admin, siteB)).total, 0);
  await assert.rejects(workforce.list(rep, siteB));
  await assert.rejects(
    new ScheduleConfigurationService(dataSource).listWorkerSchedules(rep, siteB),
  );
  await assert.rejects(
    new SchedulingWorkflowService(dataSource).listShiftChangeRequests(rep, siteB),
  );
  await assert.rejects(
    main.createWorker(
      first.id,
      {
        siteId: siteB,
        externalId: `WD_${suffix}`,
        displayName: 'Revoked Worker',
      },
      representativeContext,
    ),
  );
});
