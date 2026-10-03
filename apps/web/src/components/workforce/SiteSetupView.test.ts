import { describe, expect, it } from 'vitest';
import type { AccountResponse, ContractorRepresentativeAssignmentResponse } from '@smartsite/api-client';
import {
  addSiteManagerAssignment,
  getAssignableRepresentatives,
  getAssignableSiteManagers,
  getContractorRepresentativeUserIds,
  getSiteManagers,
} from './site-setup-helpers';

const representative = (id: string, isActive = true) =>
  ({
    id,
    username: id,
    displayName: id,
    isActive,
    mustChangePassword: false,
    roleAssignments: [],
  }) as AccountResponse;

const account = (
  id: string,
  roleAssignments: AccountResponse['roleAssignments'] = [],
  isActive = true,
) =>
  ({
    id,
    username: id,
    displayName: id,
    isActive,
    mustChangePassword: false,
    roleAssignments,
  }) as AccountResponse;

const assignment = (userId: string, contractorId: string) =>
  ({ userId, contractorId }) as Pick<ContractorRepresentativeAssignmentResponse, 'userId' | 'contractorId'>;

describe('SiteSetupView representative assignment options', () => {
  it('keeps active site representatives that are not linked to the selected contractor', () => {
    const options = getAssignableRepresentatives(
      [representative('chanh'), representative('already-linked'), representative('inactive', false)],
      [assignment('already-linked', 'contractor-a'), assignment('chanh', 'contractor-b')],
      'contractor-a',
    );

    expect(options.map((user) => user.id)).toEqual(['chanh']);
  });

  it('does not offer a representative that is already linked to the selected contractor', () => {
    const options = getAssignableRepresentatives(
      [representative('chanh')],
      [assignment('chanh', 'contractor-a')],
      'contractor-a',
    );

    expect(options).toEqual([]);
  });

  it('returns the assigned representatives for a contractor so the table can render them', () => {
    const userIds = getContractorRepresentativeUserIds(
      [assignment('chanh', 'contractor-a'), assignment('other-rep', 'contractor-b')],
      'contractor-a',
    );

    expect(userIds).toEqual(['chanh']);
  });
});

describe('SiteSetupView Site Manager assignment options', () => {
  it('shows managers assigned to the selected site and excludes inactive or already assigned accounts', () => {
    const users = [
      account('manager-a', [{ role: 'SITE_MANAGER', siteId: 'site-a' }]),
      account('manager-b', [{ role: 'SITE_MANAGER', siteId: 'site-b' }]),
      account('worker', [{ role: 'WORKER', siteId: 'site-a' }]),
      account('representative', [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }]),
      account('inactive', [], false),
    ];

    expect(getSiteManagers(users, 'site-a').map((user) => user.id)).toEqual(['manager-a']);
    expect(getAssignableSiteManagers(users, 'site-a').map((user) => user.id)).toEqual(['manager-b']);
  });

  it('preserves existing role assignments and deduplicates the Site Manager assignment', () => {
    const existingAssignments = [
      { role: 'CONTRACTOR_REPRESENTATIVE' as const, siteId: 'site-a' },
      { role: 'SITE_MANAGER' as const, siteId: 'site-a' },
    ];

    expect(addSiteManagerAssignment(existingAssignments, 'site-a')).toEqual(existingAssignments);
  });
});
