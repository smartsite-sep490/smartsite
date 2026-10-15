import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { MainConfigurationCommandContext } from '../src/common/configuration/main-configuration-authority.js';
import type { AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import type { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { ContractorOperationsController } from '../src/modules/workforce/directory/contractor-operations.controller.js';
import { ContractorsController } from '../src/modules/workforce/directory/contractors.controller.js';
import type { MainRepresentativeCommandService } from '../src/modules/workforce/main-representative-command.service.js';
import type { MainParticipationCommandService } from '../src/modules/zones/main-participation-command.service.js';
import type { MainWorkforceCreateService } from '../src/modules/workforce/main-workforce-create.service.js';
import type { WorkforceConfigurationService } from '../src/modules/workforce/workforce-configuration.service.js';

const actorUserId = '00000000-0000-4000-8000-000000000001';
const siteId = '00000000-0000-4000-8000-000000000002';
const contractorId = '00000000-0000-4000-8000-000000000003';
const targetUserId = '00000000-0000-4000-8000-000000000004';
const input = { userId: targetUserId };
const request = { user: { id: actorUserId } } as AuthenticatedRequest;

test('ContractorOperationsController.grantRepresentative forwards exact ids, input, actorUserId and reauthorizes with same manager', async () => {
  let capturedContractorId: string | undefined;
  let capturedInput: unknown;
  let capturedContext: MainConfigurationCommandContext | undefined;

  const representatives = {
    grant: async (cId: string, inp: unknown, context: MainConfigurationCommandContext) => {
      capturedContractorId = cId;
      capturedInput = inp;
      capturedContext = context;
      return { id: 'grant-01', contractorId: cId, userId: targetUserId };
    },
  } as unknown as MainRepresentativeCommandService;

  const manager = {} as EntityManager;
  let reauthorized = false;
  const guard = {
    authenticateRequest: async (receivedReq: AuthenticatedRequest, receivedMgr: EntityManager) => {
      assert.equal(receivedReq, request);
      assert.equal(receivedMgr, manager);
      reauthorized = true;
    },
  } as unknown as UserAuthGuard;

  const controller = new ContractorOperationsController(
    representatives,
    {} as MainParticipationCommandService,
    guard,
    {} as MainWorkforceCreateService,
  );

  const result = await controller.grantRepresentative(request, contractorId, input);

  assert.equal(capturedContractorId, contractorId);
  assert.deepEqual(capturedInput, input);
  assert.ok(capturedContext);
  assert.equal(capturedContext.actorUserId, actorUserId);
  assert.equal(typeof capturedContext.reauthorize, 'function');
  await capturedContext.reauthorize?.(manager);
  assert.equal(reauthorized, true);
  assert.equal(result.id, 'grant-01');
});

test('ContractorOperationsController.grantRepresentative reauthorize rejects changed request.user.id', async () => {
  let capturedContext: MainConfigurationCommandContext | undefined;

  const representatives = {
    grant: async (_cId: string, _inp: unknown, context: MainConfigurationCommandContext) => {
      capturedContext = context;
      return { id: 'grant-01', contractorId, userId: targetUserId };
    },
  } as unknown as MainRepresentativeCommandService;

  const req = { user: { id: actorUserId } } as AuthenticatedRequest;
  const manager = {} as EntityManager;
  const guard = {
    authenticateRequest: async (receivedReq: AuthenticatedRequest) => {
      // Identity swap / altered session detected during transaction re-auth
      receivedReq.user = { id: '00000000-0000-4000-8000-999999999999' } as NonNullable<
        AuthenticatedRequest['user']
      >;
    },
  } as unknown as UserAuthGuard;

  const controller = new ContractorOperationsController(
    representatives,
    {} as MainParticipationCommandService,
    guard,
    {} as MainWorkforceCreateService,
  );

  await controller.grantRepresentative(req, contractorId, input);
  assert.ok(capturedContext?.reauthorize);
  await assert.rejects(() => capturedContext!.reauthorize!(manager), UnauthorizedException);
});

test('ContractorOperationsController.grantRepresentative rejects missing request.user with UnauthorizedException', async () => {
  const unauthRequest = {} as AuthenticatedRequest;
  const controller = new ContractorOperationsController(
    {} as MainRepresentativeCommandService,
    {} as MainParticipationCommandService,
    {} as UserAuthGuard,
    {} as MainWorkforceCreateService,
  );

  await assert.rejects(
    () => controller.grantRepresentative(unauthRequest, contractorId, input),
    UnauthorizedException,
  );
});

test('ContractorsController.assignRepresentative forwards exact ids, input, actorUserId and reauthorizes with same manager', async () => {
  let capturedSiteId: string | undefined;
  let capturedContractorId: string | undefined;
  let capturedInput: unknown;
  let capturedContext: MainConfigurationCommandContext | undefined;

  const representatives = {
    assign: async (
      sId: string,
      cId: string,
      inp: unknown,
      context: MainConfigurationCommandContext,
    ) => {
      capturedSiteId = sId;
      capturedContractorId = cId;
      capturedInput = inp;
      capturedContext = context;
      return { id: 'assign-01', siteId: sId, contractorId: cId, userId: targetUserId };
    },
  } as unknown as MainRepresentativeCommandService;

  const manager = {} as EntityManager;
  let reauthorized = false;
  const guard = {
    authenticateRequest: async (receivedReq: AuthenticatedRequest, receivedMgr: EntityManager) => {
      assert.equal(receivedReq, request);
      assert.equal(receivedMgr, manager);
      reauthorized = true;
    },
  } as unknown as UserAuthGuard;

  const controller = new ContractorsController(
    {} as WorkforceConfigurationService,
    {} as MainWorkforceCreateService,
    guard,
    representatives,
  );

  const result = await controller.assignRepresentative(request, siteId, contractorId, input);

  assert.equal(capturedSiteId, siteId);
  assert.equal(capturedContractorId, contractorId);
  assert.deepEqual(capturedInput, input);
  assert.ok(capturedContext);
  assert.equal(capturedContext.actorUserId, actorUserId);
  assert.equal(typeof capturedContext.reauthorize, 'function');
  await capturedContext.reauthorize?.(manager);
  assert.equal(reauthorized, true);
  assert.equal(result.id, 'assign-01');
});

test('ContractorsController.assignRepresentative reauthorize rejects changed request.user.id', async () => {
  let capturedContext: MainConfigurationCommandContext | undefined;

  const representatives = {
    assign: async (
      _sId: string,
      _cId: string,
      _inp: unknown,
      context: MainConfigurationCommandContext,
    ) => {
      capturedContext = context;
      return { id: 'assign-01', siteId, contractorId, userId: targetUserId };
    },
  } as unknown as MainRepresentativeCommandService;

  const req = { user: { id: actorUserId } } as AuthenticatedRequest;
  const manager = {} as EntityManager;
  const guard = {
    authenticateRequest: async (receivedReq: AuthenticatedRequest) => {
      // Identity swap / altered session detected during transaction re-auth
      receivedReq.user = { id: '00000000-0000-4000-8000-999999999999' } as NonNullable<
        AuthenticatedRequest['user']
      >;
    },
  } as unknown as UserAuthGuard;

  const controller = new ContractorsController(
    {} as WorkforceConfigurationService,
    {} as MainWorkforceCreateService,
    guard,
    representatives,
  );

  await controller.assignRepresentative(req, siteId, contractorId, input);
  assert.ok(capturedContext?.reauthorize);
  await assert.rejects(() => capturedContext!.reauthorize!(manager), UnauthorizedException);
});

test('ContractorsController.assignRepresentative rejects missing request.user with UnauthorizedException', async () => {
  const unauthRequest = {} as AuthenticatedRequest;
  const controller = new ContractorsController(
    {} as WorkforceConfigurationService,
    {} as MainWorkforceCreateService,
    {} as UserAuthGuard,
    {} as MainRepresentativeCommandService,
  );

  await assert.rejects(
    () => controller.assignRepresentative(unauthRequest, siteId, contractorId, input),
    UnauthorizedException,
  );
});
