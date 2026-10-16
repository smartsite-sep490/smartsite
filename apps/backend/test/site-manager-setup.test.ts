import { AdminGuard } from '../src/modules/auth/user-auth.guard.js';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { SiteManagerGuard } from '../src/modules/auth/site-manager.guard.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { ContractorsController } from '../src/modules/workforce/directory/contractors.controller.js';
import { ZonesController } from '../src/modules/zones/zones.controller.js';
import {
  SiteRepresentativesController,
  CreateSiteRepresentativeDto,
} from '../src/modules/users/site-representatives.controller.js';
import { command } from '../src/common/configuration/commands.js';

test('Site Manager setup requires matching scope and denies Admin, other roles, missing data and blocked accounts', () => {
  const guard = new SiteManagerGuard();
  for (const [role, assignedSite, blocked, expected] of [
    [UserRole.SITE_MANAGER, 'site-a', false, true],
    [UserRole.SITE_MANAGER, 'site-b', false, false],
    [UserRole.ADMIN, null, false, false],
    [UserRole.CONTRACTOR_REPRESENTATIVE, 'site-a', false, false],
    [UserRole.WORKER, 'site-a', false, false],
    [UserRole.SITE_MANAGER, null, false, false],
    [UserRole.SITE_MANAGER, 'site-a', true, false],
  ] as const) {
    const request = {
      params: { siteId: 'site-a' },
      user: { mustChangePassword: blocked, roleAssignments: [{ role, siteId: assignedSite }] },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    if (expected) assert.equal(guard.canActivate(context), true);
    else assert.throws(() => guard.canActivate(context), { status: 403 });
  }
  for (const request of [{ params: {} }, { params: { siteId: 'site-a' }, user: undefined }]) {
    assert.throws(
      () =>
        guard.canActivate({
          switchToHttp: () => ({ getRequest: () => request }),
        } as ExecutionContext),
      { status: 403 },
    );
  }
});

test('all setup provisioning HTTP routes use the scoped guard', () => {
  for (const method of ['create', 'rename', 'updatePolicy'] as const) {
    assert.ok(
      Reflect.getMetadata(GUARDS_METADATA, ZonesController.prototype[method]).includes(
        SiteManagerGuard,
      ),
    );
  }
  for (const controller of [SiteRepresentativesController]) {
    assert.ok(Reflect.getMetadata(GUARDS_METADATA, controller).includes(SiteManagerGuard));
  }
  assert.ok(
    Reflect.getMetadata(GUARDS_METADATA, ContractorsController.prototype.create).includes(
      AdminGuard,
    ),
  );
  for (const method of ['assignRepresentative', 'listRepresentativeAssignments'] as const) {
    assert.ok(
      Reflect.getMetadata(GUARDS_METADATA, ContractorsController.prototype[method]).includes(
        SiteManagerGuard,
      ),
    );
  }
});

test('representative account input rejects arbitrary roles and scopes', () => {
  const input = {
    username: 'representative',
    displayName: 'Representative',
    temporaryPassword: 'TempDemo2026!',
  };
  assert.doesNotThrow(() => command(CreateSiteRepresentativeDto, input));
  for (const extra of [
    { roleAssignments: [{ role: 'ADMIN', siteId: null }] },
    { siteId: 'other-site' },
    { isActive: true },
  ]) {
    assert.throws(() => command(CreateSiteRepresentativeDto, { ...input, ...extra }), {
      status: 400,
    });
  }
});
