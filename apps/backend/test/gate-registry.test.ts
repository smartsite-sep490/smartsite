import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { GateReadGuard } from '../src/modules/gates/gates.controller.js';
import { command } from '../src/common/configuration/commands.js';
import { CreateGateDto, GatesService, UpdateGateDto } from '../src/modules/gates/gates.service.js';
import { CreateCameraCommand } from '../src/modules/cameras/camera-configuration.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';

test('Gate configuration permissions require role and exact Site; Admin observes', () => {
  const guard = new GateReadGuard();
  const site = '11111111-1111-4111-8111-111111111111';
  const context = (role: UserRole, method: string, siteId: string | null = site) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          params: { siteId: site },
          user: { mustChangePassword: false, roleAssignments: [{ role, siteId }] },
        }),
      }),
    }) as ExecutionContext;
  for (const role of [UserRole.SITE_MANAGER, UserRole.SAFETY_OFFICER, UserRole.SECURITY_OFFICER])
    assert.equal(guard.canActivate(context(role, 'GET')), true);
  assert.equal(guard.canActivate(context(UserRole.ADMIN, 'GET', null)), true);
  assert.equal(guard.canActivate(context(UserRole.SITE_MANAGER, 'POST')), true);
  for (const role of [
    UserRole.ADMIN,
    UserRole.SECURITY_OFFICER,
    UserRole.SAFETY_OFFICER,
    UserRole.WORKER,
    UserRole.CONTRACTOR_REPRESENTATIVE,
  ])
    assert.throws(() =>
      guard.canActivate(context(role, 'POST', role === UserRole.ADMIN ? null : site)),
    );
  assert.throws(() =>
    guard.canActivate(
      context(UserRole.SECURITY_OFFICER, 'GET', '22222222-2222-4222-8222-222222222222'),
    ),
  );
  assert.throws(() => guard.canActivate(context(UserRole.WORKER, 'GET')));
});
test('Gate input rejects mutable identifiers, malformed states and blank names', () => {
  const generated = command(CreateGateDto, { name: ' Main gate ' });
  assert.equal(generated.code, undefined);
  assert.equal(generated.name, 'Main gate');
  assert.equal(command(CreateGateDto, { code: 'G1', name: ' Main gate ' }).name, 'Main gate');
  for (const value of [
    { code: '', name: 'Gate' },
    { code: null, name: 'Gate' },
    { code: 'G1', name: ' ' },
    { code: 'G1', name: 'Gate', siteId: 'forged' },
  ])
    assert.throws(() => command(CreateGateDto, value));
  for (const value of [{ code: 'G2' }, { siteId: 'forged' }, { status: 'DELETED' }, { name: '' }])
    assert.throws(() => command(UpdateGateDto, value));
});
test('Camera creation requires an explicit purpose and Gate UUID for webcam sources', () => {
  assert.throws(() =>
    command(CreateCameraCommand, { code: 'C', name: 'Camera', externalId: 'synthetic' }),
  );
  assert.throws(() => command(CreateCameraCommand, { type: 'GATE', code: 'C', name: 'Camera' }));
  assert.equal(
    command(CreateCameraCommand, {
      type: 'GATE',
      gateId: '11111111-1111-4111-8111-111111111111',
      code: 'C',
      name: 'Camera',
    }).externalId,
    undefined,
  );
});

test('generated code collisions retry the authorized transaction; explicit code conflicts do not change the requested code', async () => {
  for (const explicit of [false, true]) {
    const saved: Array<{ code: string }> = [];
    let authorized = 0;
    const collision = new QueryFailedError(
      'synthetic insert',
      [],
      Object.assign(new Error('synthetic collision'), {
        code: '23505',
        constraint: 'uq_gate_site_code',
      }),
    );
    const manager = {
      query: async () => [{ id: 'synthetic-authorized-account' }],
      getRepository: () => ({
        save: async (value: { code: string }) => {
          saved.push(value);
          if (saved.length === 1) throw collision;
          return value;
        },
      }),
    };
    const source = {
      transaction: async (_isolation: string, work: (value: typeof manager) => Promise<unknown>) =>
        work(manager),
    } as unknown as DataSource;
    const service = new GatesService(source);
    const context = {
      actorUserId: '11111111-1111-4111-8111-111111111111',
      reauthorize: async () => {
        authorized++;
      },
    };
    const create = () =>
      service.create(
        '22222222-2222-4222-8222-222222222222',
        {
          name: 'Main gate',
          ...(explicit ? { code: 'MAIN' } : {}),
        },
        context,
      );
    if (explicit) {
      await assert.rejects(
        create(),
        (error) => (error as { getStatus(): number }).getStatus() === 409,
      );
      assert.deepEqual(
        saved.map((value) => value.code),
        ['MAIN'],
      );
      assert.equal(authorized, 1);
    } else {
      const created = await create();
      assert.equal(saved.length, 2);
      assert.notEqual(saved[0]!.code, saved[1]!.code);
      assert.equal(created.code, saved[1]!.code);
      assert.equal(authorized, 2);
    }
  }
});
