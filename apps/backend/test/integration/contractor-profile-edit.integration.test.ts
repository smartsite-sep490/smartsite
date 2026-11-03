import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import source from '../support/test-data-source.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteRepresentativesService } from '../../src/modules/users/site-representatives.controller.js';
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  UserEntity,
} from '../../src/database/entities/index.js';

after(async () => {
  if (source.isInitialized) await source.destroy();
});
test('combined registration rolls back duplicates and scoped names reject stale, cross-site and shared edits', async () => {
  if (!source.isInitialized) await source.initialize();
  const sites = new SiteConfigurationService(source);
  const workforce = new WorkforceConfigurationService(source);
  const reps = new SiteRepresentativesService(source, new UsersService(source, sites), workforce);
  const site = await sites.create({ code: randomUUID(), name: 'Synthetic profile site' });
  const other = await sites.create({ code: randomUUID(), name: 'Other profile site' });
  const input = {
    username: `rep-${randomUUID()}`,
    displayName: 'Representative',
    temporaryPassword: 'TempDemo2026!',
    contractorName: `Synthetic ${randomUUID()}`,
    validFrom: new Date(Date.now() - 60000).toISOString(),
    validUntil: null,
  };
  const account = await reps.createWithContractor(site.id, input);
  assert.ok(account);
  const contractor = await source
    .getRepository(ContractorEntity)
    .findOneByOrFail({ name: input.contractorName });
  assert.ok(
    await source
      .getRepository(ContractorSiteParticipationEntity)
      .existsBy({ siteId: site.id, contractorId: contractor.id }),
  );
  await assert.rejects(
    reps.createWithContractor(site.id, { ...input, contractorName: 'Must roll back' }),
  );
  assert.equal(
    await source.getRepository(ContractorEntity).existsBy({ name: 'Must roll back' }),
    false,
  );
  assert.ok(await source.getRepository(UserEntity).existsBy({ id: account.id }));
  await assert.rejects(
    workforce.renameContractor(other.id, contractor.id, {
      name: 'Denied',
      expectedName: contractor.name,
    }),
  );
  await workforce.renameContractor(site.id, contractor.id, {
    name: 'Corrected contractor',
    expectedName: contractor.name,
  });
  await assert.rejects(
    workforce.renameContractor(site.id, contractor.id, {
      name: 'Stale',
      expectedName: contractor.name,
    }),
  );
  await reps.rename(site.id, account.id, {
    name: 'Corrected representative',
    expectedName: input.displayName,
  });
  await assert.rejects(
    reps.rename(other.id, account.id, { name: 'Denied', expectedName: 'Corrected representative' }),
  );
  await assert.rejects(
    reps.rename(site.id, account.id, { name: 'Stale', expectedName: input.displayName }),
  );
  await source.getRepository(ContractorSiteParticipationEntity).save({
    id: randomUUID(),
    siteId: other.id,
    contractorId: contractor.id,
    validFrom: new Date(),
  });
  await assert.rejects(
    workforce.renameContractor(site.id, contractor.id, {
      name: 'Shared',
      expectedName: 'Corrected contractor',
    }),
    /Shared profiles/,
  );
  const { UserRoleAssignmentEntity, UserRole } =
    await import('../../src/database/entities/index.js');
  await source.getRepository(UserRoleAssignmentEntity).save({
    id: randomUUID(),
    userId: account.id,
    siteId: other.id,
    role: UserRole.CONTRACTOR_REPRESENTATIVE,
  });
  await assert.rejects(
    reps.rename(site.id, account.id, { name: 'Shared', expectedName: 'Corrected representative' }),
    /Shared profiles/,
  );
  await assert.rejects(
    reps.createWithContractor(site.id, {
      ...input,
      username: `rep-${randomUUID()}`,
      validFrom: new Date(Date.now() + 86400000).toISOString(),
    }),
    /currently active/,
  );
});
