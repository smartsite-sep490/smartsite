import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AccountResponse, ProvisionableRoleAssignment } from '../src/management-api.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

test('account responses represent every persisted role without widening role mutation inputs', () => {
  const account: AccountResponse = {
    id: '00000000-0000-4000-8000-000000000001',
    username: 'role-catalog',
    displayName: 'Role Catalog',
    roleAssignments: [
      { role: 'ADMIN', siteId: null },
      { role: 'SITE_MANAGER', siteId: '00000000-0000-4000-8000-000000000002' },
      {
        role: 'CONTRACTOR_REPRESENTATIVE',
        siteId: '00000000-0000-4000-8000-000000000002',
      },
      { role: 'SAFETY_OFFICER', siteId: '00000000-0000-4000-8000-000000000002' },
      { role: 'SECURITY_OFFICER', siteId: '00000000-0000-4000-8000-000000000002' },
      { role: 'WORKER', siteId: '00000000-0000-4000-8000-000000000002' },
    ],
    isActive: true,
    mustChangePassword: false,
  };
  const provisionableRolesStayRestricted: Equal<
    ProvisionableRoleAssignment['role'],
    'ADMIN' | 'SITE_MANAGER' | 'SAFETY_OFFICER' | 'SECURITY_OFFICER'
  > = true;

  assert.deepEqual(
    account.roleAssignments.map(({ role }) => role),
    [
      'ADMIN',
      'SITE_MANAGER',
      'CONTRACTOR_REPRESENTATIVE',
      'SAFETY_OFFICER',
      'SECURITY_OFFICER',
      'WORKER',
    ],
  );
  assert.equal(provisionableRolesStayRestricted, true);
});
