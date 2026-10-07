import type { AccountResponse, ContractorRepresentativeAssignmentResponse } from '@smartsite/api-client';

export function getAssignableRepresentatives(
  representatives: readonly AccountResponse[],
  assignments: readonly Pick<ContractorRepresentativeAssignmentResponse, 'userId' | 'contractorId'>[],
  contractorId: string,
) {
  const assignedUserIds = new Set(
    assignments
      .filter((assignment) => assignment.contractorId === contractorId)
      .map((assignment) => assignment.userId),
  );

  return representatives.filter(
    (representative) => representative.isActive && !assignedUserIds.has(representative.id),
  );
}

export function getContractorRepresentativeUserIds(
  assignments: readonly Pick<ContractorRepresentativeAssignmentResponse, 'userId' | 'contractorId'>[],
  contractorId: string,
) {
  return assignments
    .filter((assignment) => assignment.contractorId === contractorId)
    .map((assignment) => assignment.userId);
}

export function getSiteManagers(users: readonly AccountResponse[], siteId: string) {
  return users.filter((user) =>
    user.roleAssignments.some((assignment) => assignment.role === 'SITE_MANAGER' && assignment.siteId === siteId),
  );
}

export function getReadySiteManagers(users: readonly AccountResponse[], siteId: string) {
  return getSiteManagers(users, siteId).filter((user) => user.isActive && !user.mustChangePassword);
}

export function getAssignableSiteManagers(users: readonly AccountResponse[], siteId: string) {
  const assignedManagerIds = new Set(getSiteManagers(users, siteId).map((user) => user.id));
  return users.filter(
    (user) =>
      user.isActive &&
      user.roleAssignments.some((assignment) => assignment.role === 'SITE_MANAGER') &&
      !assignedManagerIds.has(user.id),
  );
}

export function addSiteManagerAssignment(
  roleAssignments: readonly AccountResponse['roleAssignments'][number][],
  siteId: string,
) {
  return [...roleAssignments.map(({ role, siteId: assignmentSiteId }) => ({
    role,
    siteId: assignmentSiteId,
  })), { role: 'SITE_MANAGER' as const, siteId }].filter(
    (assignment, index, allAssignments) =>
      allAssignments.findIndex(
        (candidate) => candidate.role === assignment.role && candidate.siteId === assignment.siteId,
      ) === index,
  );
}
