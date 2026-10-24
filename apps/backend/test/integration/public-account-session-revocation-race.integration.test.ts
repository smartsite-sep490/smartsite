import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  IsNull,
  type DataSource,
  type EntityManager,
  type ObjectLiteral,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import {
  configurationCommandContext,
  passwordChangeCommandContext,
} from '../../src/modules/auth/configuration-command-context.js';
import { AdminGuard, UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import {
  AuthClientType,
  AuthSessionEntity,
} from '../../src/database/entities/auth-session.entity.js';
import { UserRoleAssignmentEntity } from '../../src/database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../src/database/entities/user.entity.js';

const isolatedDatabase = createIsolatedTestDatabase({ canonical: true });
const dataSource = isolatedDatabase.dataSource;
before(() => isolatedDatabase.initialize());
after(() => isolatedDatabase.dispose());

interface BoundedBarrier {
  signal(): void;
  wait(): Promise<void>;
}

function createBoundedBarrier(label: string, timeoutMs = 5_000): BoundedBarrier {
  let settled = false;
  let resolvePromise!: () => void;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Deterministic barrier timed out after ${timeoutMs}ms: ${label}`));
    }, timeoutMs);
    timer.unref?.();
  });
  return {
    signal() {
      resolvePromise();
    },
    wait() {
      return promise;
    },
  };
}

function createBearerRequest(accessToken: string, rawHeaders?: string[]): AuthenticatedRequest {
  return {
    headers: { authorization: `Bearer ${accessToken}` },
    ...(rawHeaders ? { rawHeaders } : {}),
  };
}

function createHttpExecutionContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

/**
 * Returns only the numeric HTTP status code (200 on resolved authentication, or error.status)
 * so test assertions never print bearer tokens, passwords, or resolved authentication objects.
 */
async function authenticateStatus(authService: AuthService, accessToken: string): Promise<number> {
  try {
    const result = await authService.authenticate(accessToken);
    return result.user.id ? 200 : 500;
  } catch (error) {
    return (error as { status?: number })?.status ?? 500;
  }
}

async function loginStatus(
  authService: AuthService,
  username: string,
  password: string,
  clientType: AuthClientType,
): Promise<number> {
  try {
    const result = await authService.login(username, password, clientType);
    return result.user.id ? 200 : 500;
  } catch (error) {
    return (error as { status?: number })?.status ?? 500;
  }
}

async function changePasswordStatus(
  authService: AuthService,
  userId: string,
  currentPassword: string,
  newPassword: string,
  context?: MainConfigurationCommandContext,
): Promise<number> {
  try {
    await authService.changePassword(userId, currentPassword, newPassword, context);
    return 204;
  } catch (error) {
    return (error as { status?: number })?.status ?? 500;
  }
}

/** Complete Feature's required bootstrap password change through its genuine self context. */
async function completeBootstrapPassword(
  auth: AuthService,
  userId: string,
  username: string,
  password: string,
): Promise<string> {
  const temporary = await auth.login(username, password, AuthClientType.WEB);
  const request = createBearerRequest(temporary.accessToken);
  const guard = new UserAuthGuard(auth);
  await guard.authenticateRequest(request);
  const readyPassword = password + '_Ready1!';
  await auth.changePassword(
    userId,
    password,
    readyPassword,
    passwordChangeCommandContext(request, guard),
  );
  assert.equal(await authenticateStatus(auth, temporary.accessToken), 401);
  return readyPassword;
}
interface LoginInsertBarrierHook {
  targetUserId: string;
  interceptOnce: boolean;
  onBeforeSessionInsert: BoundedBarrier;
  releaseSessionInsert: BoundedBarrier;
}

/**
 * Narrow DataSource proxy for AuthService.login:
 * Preserves all real transactions, row locks, password checks, and role queries,
 * intercepting solely `manager.getRepository(AuthSessionEntity).insert(...)` for `targetUserId`
 * after `AuthService.login` has acquired the `pessimistic_write` (FOR UPDATE) lock on `app_user`.
 */
function createLoginSessionInsertBarrierDataSource(
  base: DataSource,
  hook: LoginInsertBarrierHook,
): DataSource {
  const wrapSessionRepository = (
    repo: Repository<AuthSessionEntity>,
  ): Repository<AuthSessionEntity> =>
    new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'insert') {
          return async (entity: Parameters<Repository<AuthSessionEntity>['insert']>[0]) => {
            const candidate = Array.isArray(entity) ? entity[0] : entity;
            const userId = (candidate as { userId?: string } | undefined)?.userId;
            if (hook.interceptOnce && userId === hook.targetUserId) {
              hook.interceptOnce = false;
              hook.onBeforeSessionInsert.signal();
              await hook.releaseSessionInsert.wait();
            }
            return target.insert(entity);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  const wrapEntityManager = (manager: EntityManager): EntityManager =>
    new Proxy(manager, {
      get(target, prop, receiver) {
        if (prop === 'getRepository') {
          return <Entity extends ObjectLiteral>(
            entityTarget: Parameters<EntityManager['getRepository']>[0],
          ): Repository<Entity> => {
            const repo = target.getRepository(entityTarget);
            if (entityTarget === AuthSessionEntity) {
              return wrapSessionRepository(
                repo as unknown as Repository<AuthSessionEntity>,
              ) as unknown as Repository<Entity>;
            }
            return repo as unknown as Repository<Entity>;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          if (typeof args[0] === 'function') {
            const runInTransaction = args[0] as (manager: EntityManager) => Promise<unknown>;
            return target.transaction(async (manager) =>
              runInTransaction(wrapEntityManager(manager)),
            );
          }
          const isolationLevel = args[0] as Parameters<DataSource['transaction']>[0];
          const runInTransaction = args[1] as (manager: EntityManager) => Promise<unknown>;
          return target.transaction(isolationLevel, async (manager) =>
            runInTransaction(wrapEntityManager(manager)),
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

interface InternalResetRowLockHook {
  targetUserId: string;
  interceptOnce: boolean;
  onTargetRowLockRequested: BoundedBarrier;
}

/**
 * Narrow DataSource proxy for the internal READ COMMITTED reset control (`context === undefined`):
 * Anchors the barrier to the exact point where `UsersService.resetPassword` invokes
 * `manager.getRepository(UserEntity).createQueryBuilder('user').setLock('pessimistic_write').where(...).getOne()`
 * inside the real READ COMMITTED transaction.
 */
function createInternalResetRowLockBarrierDataSource(
  base: DataSource,
  hook: InternalResetRowLockHook,
): DataSource {
  const wrapUserQueryBuilder = (
    qb: SelectQueryBuilder<UserEntity>,
  ): SelectQueryBuilder<UserEntity> => {
    let lockedPessimisticWrite = false;
    let matchedTargetUser = false;
    const proxy: SelectQueryBuilder<UserEntity> = new Proxy(qb, {
      get(target, prop, receiver) {
        if (prop === 'setLock') {
          return (...args: Parameters<SelectQueryBuilder<UserEntity>['setLock']>) => {
            if (args[0] === 'pessimistic_write') lockedPessimisticWrite = true;
            target.setLock(...args);
            return proxy;
          };
        }
        if (prop === 'where') {
          return (...args: Parameters<SelectQueryBuilder<UserEntity>['where']>) => {
            const params = args[1] as { id?: string } | undefined;
            if (params?.id === hook.targetUserId) matchedTargetUser = true;
            target.where(...args);
            return proxy;
          };
        }
        if (prop === 'getOne') {
          return () => {
            const promise = target.getOne();
            if (hook.interceptOnce && lockedPessimisticWrite && matchedTargetUser) {
              hook.interceptOnce = false;
              hook.onTargetRowLockRequested.signal();
            }
            return promise;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return proxy;
  };

  const wrapUserRepository = (repo: Repository<UserEntity>): Repository<UserEntity> =>
    new Proxy(repo, {
      get(target, prop, receiver) {
        if (prop === 'createQueryBuilder') {
          return (...args: Parameters<Repository<UserEntity>['createQueryBuilder']>) =>
            wrapUserQueryBuilder(target.createQueryBuilder(...args));
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  const wrapEntityManager = (manager: EntityManager): EntityManager =>
    new Proxy(manager, {
      get(target, prop, receiver) {
        if (prop === 'getRepository') {
          return <Entity extends ObjectLiteral>(
            entityTarget: Parameters<EntityManager['getRepository']>[0],
          ): Repository<Entity> => {
            const repo = target.getRepository(entityTarget);
            if (entityTarget === UserEntity) {
              return wrapUserRepository(
                repo as unknown as Repository<UserEntity>,
              ) as unknown as Repository<Entity>;
            }
            return repo as unknown as Repository<Entity>;
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          if (typeof args[0] === 'function') {
            const runInTransaction = args[0] as (manager: EntityManager) => Promise<unknown>;
            return target.transaction(async (manager) =>
              runInTransaction(wrapEntityManager(manager)),
            );
          }
          const isolationLevel = args[0] as Parameters<DataSource['transaction']>[0];
          const runInTransaction = args[1] as (manager: EntityManager) => Promise<unknown>;
          return target.transaction(isolationLevel, async (manager) =>
            runInTransaction(wrapEntityManager(manager)),
          );
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

test('internal READ COMMITTED resetPassword control (no context) revokes concurrent login session after target row lock', async () => {
  assert.ok(dataSource.isInitialized);
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');

  const config = createTestConfig();
  const sites = new SiteConfigurationService(dataSource);
  const tokens = new AuthTokenService(new JwtService(), config);
  const suffix = randomUUID().slice(0, 8);

  const seedUsers = new UsersService(dataSource, sites);
  await seedUsers.bootstrap(
    `Admin.Internal.${suffix}`,
    'Internal Control Admin',
    'StrongPassword!123',
  );
  const site = await sites.create({ code: `SITE-INT-${suffix}`, name: 'Internal Control Site' });
  const initialPassword = 'WorkerInitialPassword!123';
  const nextPassword = 'WorkerInternalReset!123';
  const targetUser = await seedUsers.create({
    username: `worker.internal.${suffix}`,
    displayName: 'Internal Control Worker',
    temporaryPassword: initialPassword,
    roleAssignments: [{ role: UserRole.WORKER, siteId: site.id }],
  });

  const onBeforeSessionInsert = createBoundedBarrier('internal.login.beforeSessionInsert');
  const releaseSessionInsert = createBoundedBarrier('internal.login.releaseSessionInsert');
  const onTargetRowLockRequested = createBoundedBarrier('internal.reset.targetRowLockRequested');

  const authWithBarrier = new AuthService(
    createLoginSessionInsertBarrierDataSource(dataSource, {
      targetUserId: targetUser.id,
      interceptOnce: true,
      onBeforeSessionInsert,
      releaseSessionInsert,
    }),
    tokens,
  );
  const usersWithRowLockSignal = new UsersService(
    createInternalResetRowLockBarrierDataSource(dataSource, {
      targetUserId: targetUser.id,
      interceptOnce: true,
      onTargetRowLockRequested,
    }),
    sites,
  );

  let loginPromise: Promise<Awaited<ReturnType<typeof authWithBarrier.login>>> | undefined;
  let resetPromise: Promise<void> | undefined;
  try {
    loginPromise = authWithBarrier.login(
      targetUser.username,
      initialPassword,
      AuthClientType.MOBILE,
    );
    await onBeforeSessionInsert.wait();

    // Start internal READ COMMITTED reset (context omitted) while login holds FOR UPDATE on targetUser
    resetPromise = usersWithRowLockSignal.resetPassword(targetUser.id, {
      temporaryPassword: nextPassword,
    });
    await onTargetRowLockRequested.wait();

    // Release login to insert AuthSessionEntity and commit; READ COMMITTED reset then updates and revokes
    releaseSessionInsert.signal();
    const [loginOutcome] = await Promise.all([loginPromise, resetPromise]);

    const remainingActiveSessions = await dataSource
      .getRepository(AuthSessionEntity)
      .countBy({ userId: targetUser.id, revokedAt: IsNull() });
    assert.equal(remainingActiveSessions, 0);

    const postResetAuthStatus = await authenticateStatus(authWithBarrier, loginOutcome.accessToken);
    assert.equal(postResetAuthStatus, 401);
  } finally {
    onBeforeSessionInsert.signal();
    onTargetRowLockRequested.signal();
    releaseSessionInsert.signal();
    await Promise.allSettled([loginPromise, resetPromise].filter(Boolean));
  }
});

test('public resetPassword (USER_PASSWORD_RESET) with real configurationCommandContext revokes existing and concurrent login sessions', async () => {
  assert.ok(dataSource.isInitialized);
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');

  const config = createTestConfig();
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const tokens = new AuthTokenService(new JwtService(), config);
  const baseAuth = new AuthService(dataSource, tokens);
  const userAuthGuard = new UserAuthGuard(baseAuth);
  const adminGuard = new AdminGuard();

  const suffix = randomUUID().slice(0, 8);
  let adminPassword = 'StrongPassword!123';
  const admin = await users.bootstrap(`Admin.Reset.${suffix}`, 'Public Reset Admin', adminPassword);
  adminPassword = await completeBootstrapPassword(
    baseAuth,
    admin.id,
    admin.username,
    adminPassword,
  );
  const adminLogin = await baseAuth.login(admin.username, adminPassword, AuthClientType.WEB);
  const adminReq = createBearerRequest(adminLogin.accessToken, [
    'Authorization',
    `Bearer ${adminLogin.accessToken}`,
  ]);
  assert.equal(await userAuthGuard.canActivate(createHttpExecutionContext(adminReq)), true);
  assert.equal(adminGuard.canActivate(createHttpExecutionContext(adminReq)), true);

  const site = await sites.create(
    { code: `SITE-RST-${suffix}`, name: 'Public Reset Site' },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  const initialPassword = 'WorkerPublicInitial!123';
  const resetPasswordValue = 'WorkerPublicReset!123';
  const targetUser = await users.create(
    {
      username: `worker.reset.${suffix}`,
      displayName: 'Public Reset Worker',
      temporaryPassword: initialPassword,
      roleAssignments: [{ role: UserRole.WORKER, siteId: site.id }],
    },
    configurationCommandContext(adminReq, userAuthGuard),
  );

  const existingSession = await baseAuth.login(
    targetUser.username,
    initialPassword,
    AuthClientType.WEB,
  );
  assert.equal(await authenticateStatus(baseAuth, existingSession.accessToken), 200);

  const onBeforeSessionInsert = createBoundedBarrier('public.reset.login.beforeSessionInsert');
  const releaseSessionInsert = createBoundedBarrier('public.reset.login.releaseSessionInsert');
  const snapshotReached = createBoundedBarrier('public.reset.snapshotReachedAfterReauthorize');

  const authWithLoginBarrier = new AuthService(
    createLoginSessionInsertBarrierDataSource(dataSource, {
      targetUserId: targetUser.id,
      interceptOnce: true,
      onBeforeSessionInsert,
      releaseSessionInsert,
    }),
    tokens,
  );

  const realContext = configurationCommandContext(adminReq, userAuthGuard);
  const wrappedContext: MainConfigurationCommandContext = {
    actorUserId: realContext.actorUserId,
    reauthorize: async (manager) => {
      await realContext.reauthorize?.(manager);
      snapshotReached.signal();
    },
  };

  let loginPromise: Promise<Awaited<ReturnType<typeof authWithLoginBarrier.login>>> | undefined;
  let resetPromise: Promise<void> | undefined;
  try {
    // 1. Start target login and hold inside transaction after UserEntity FOR UPDATE + password + role checks, before AuthSessionEntity.insert
    loginPromise = authWithLoginBarrier.login(
      targetUser.username,
      initialPassword,
      AuthClientType.MOBILE,
    );
    await onBeforeSessionInsert.wait();

    // 2. Start public resetPassword with real configurationCommandContext
    resetPromise = users.resetPassword(
      targetUser.id,
      { temporaryPassword: resetPasswordValue },
      wrappedContext,
    );

    // 3. Wait until executeMainConfigurationCommand has entered its transaction and completed real actor/session/roles reauthorize
    await snapshotReached.wait();

    // 4. Release held login so AuthSessionEntity.insert + commit complete, then await both login and resetPassword
    releaseSessionInsert.signal();
    const [loginOutcome] = await Promise.all([loginPromise, resetPromise]);

    const resetWitnessRows = (await dataSource.query(
      `SELECT c.operation, c.actor_user_id
       FROM mf06_authority_command c
       JOIN mf06_authority_commit_witness w ON w.command_id = c.command_id
       WHERE c.operation = 'USER_PASSWORD_RESET' AND c.actor_user_id = $1`,
      [admin.id],
    )) as Array<{ operation: string; actor_user_id: string }>;
    assert.equal(resetWitnessRows.length, 1);

    // 5. Required invariant: completed password reset must leave 0 active sessions and reject both existing and concurrent login tokens with 401
    const remainingActiveSessions = await dataSource
      .getRepository(AuthSessionEntity)
      .countBy({ userId: targetUser.id, revokedAt: IsNull() });
    assert.equal(remainingActiveSessions, 0);

    assert.equal(await authenticateStatus(authWithLoginBarrier, existingSession.accessToken), 401);
    assert.equal(await authenticateStatus(authWithLoginBarrier, loginOutcome.accessToken), 401);
  } finally {
    onBeforeSessionInsert.signal();
    snapshotReached.signal();
    releaseSessionInsert.signal();
    await Promise.allSettled([loginPromise, resetPromise].filter(Boolean));
  }
});

test('public setStatus deactivation (USER_ACCOUNT_STATUS) with real configurationCommandContext revokes existing and concurrent login sessions', async () => {
  assert.ok(dataSource.isInitialized);
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');

  const config = createTestConfig();
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const tokens = new AuthTokenService(new JwtService(), config);
  const baseAuth = new AuthService(dataSource, tokens);
  const userAuthGuard = new UserAuthGuard(baseAuth);
  const adminGuard = new AdminGuard();

  const suffix = randomUUID().slice(0, 8);
  let adminPassword = 'StrongPassword!123';
  const admin = await users.bootstrap(
    `Admin.Status.${suffix}`,
    'Public Status Admin',
    adminPassword,
  );
  adminPassword = await completeBootstrapPassword(
    baseAuth,
    admin.id,
    admin.username,
    adminPassword,
  );
  const adminLogin = await baseAuth.login(admin.username, adminPassword, AuthClientType.WEB);
  const adminReq = createBearerRequest(adminLogin.accessToken, [
    'Authorization',
    `Bearer ${adminLogin.accessToken}`,
  ]);
  assert.equal(await userAuthGuard.canActivate(createHttpExecutionContext(adminReq)), true);
  assert.equal(adminGuard.canActivate(createHttpExecutionContext(adminReq)), true);

  const site = await sites.create(
    { code: `SITE-STS-${suffix}`, name: 'Public Status Site' },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  const initialPassword = 'WorkerStatusInitial!123';
  const targetUser = await users.create(
    {
      username: `worker.status.${suffix}`,
      displayName: 'Public Status Worker',
      temporaryPassword: initialPassword,
      roleAssignments: [{ role: UserRole.WORKER, siteId: site.id }],
    },
    configurationCommandContext(adminReq, userAuthGuard),
  );

  const existingSession = await baseAuth.login(
    targetUser.username,
    initialPassword,
    AuthClientType.WEB,
  );
  assert.equal(await authenticateStatus(baseAuth, existingSession.accessToken), 200);

  const onBeforeSessionInsert = createBoundedBarrier('public.status.login.beforeSessionInsert');
  const releaseSessionInsert = createBoundedBarrier('public.status.login.releaseSessionInsert');
  const snapshotReached = createBoundedBarrier('public.status.snapshotReachedAfterReauthorize');

  const authWithLoginBarrier = new AuthService(
    createLoginSessionInsertBarrierDataSource(dataSource, {
      targetUserId: targetUser.id,
      interceptOnce: true,
      onBeforeSessionInsert,
      releaseSessionInsert,
    }),
    tokens,
  );

  const realContext = configurationCommandContext(adminReq, userAuthGuard);
  const wrappedContext: MainConfigurationCommandContext = {
    actorUserId: realContext.actorUserId,
    reauthorize: async (manager) => {
      await realContext.reauthorize?.(manager);
      snapshotReached.signal();
    },
  };

  let loginPromise: Promise<Awaited<ReturnType<typeof authWithLoginBarrier.login>>> | undefined;
  let statusPromise: Promise<Awaited<ReturnType<typeof users.setStatus>>> | undefined;
  try {
    // 1. Start target login and hold inside transaction after UserEntity FOR UPDATE + isActive/password/role checks, before AuthSessionEntity.insert
    loginPromise = authWithLoginBarrier.login(
      targetUser.username,
      initialPassword,
      AuthClientType.MOBILE,
    );
    await onBeforeSessionInsert.wait();

    // 2. Start public setStatus deactivation with real configurationCommandContext
    statusPromise = users.setStatus(admin.id, targetUser.id, { isActive: false }, wrappedContext);

    // 3. Wait until executeMainConfigurationCommand has entered its transaction and completed real actor/session/roles reauthorize
    await snapshotReached.wait();

    // 4. Release held login so AuthSessionEntity.insert + commit complete, then await both login and setStatus
    releaseSessionInsert.signal();
    const [loginOutcome, updatedUser] = await Promise.all([loginPromise, statusPromise]);
    assert.equal(updatedUser.isActive, false);

    const statusWitnessRows = (await dataSource.query(
      `SELECT c.operation, c.actor_user_id
       FROM mf06_authority_command c
       JOIN mf06_authority_commit_witness w ON w.command_id = c.command_id
       WHERE c.operation = 'USER_ACCOUNT_STATUS' AND c.actor_user_id = $1`,
      [admin.id],
    )) as Array<{ operation: string; actor_user_id: string }>;
    assert.equal(statusWitnessRows.length, 1);

    const persistedTarget = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ id: targetUser.id });
    assert.equal(persistedTarget.isActive, false);

    // 5. Required invariant: completed account deactivation must leave 0 active sessions and reject both existing and concurrent login tokens with 401
    const remainingActiveSessions = await dataSource
      .getRepository(AuthSessionEntity)
      .countBy({ userId: targetUser.id, revokedAt: IsNull() });
    assert.equal(remainingActiveSessions, 0);

    assert.equal(await authenticateStatus(authWithLoginBarrier, existingSession.accessToken), 401);
    assert.equal(await authenticateStatus(authWithLoginBarrier, loginOutcome.accessToken), 401);
  } finally {
    onBeforeSessionInsert.signal();
    snapshotReached.signal();
    releaseSessionInsert.signal();
    await Promise.allSettled([loginPromise, statusPromise].filter(Boolean));
  }
});

test('public replaceRoleAssignments (USER_ROLE_REPLACE) with real configurationCommandContext revokes existing and concurrent login sessions', async () => {
  assert.ok(dataSource.isInitialized);
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');

  const config = createTestConfig();
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const tokens = new AuthTokenService(new JwtService(), config);
  const baseAuth = new AuthService(dataSource, tokens);
  const userAuthGuard = new UserAuthGuard(baseAuth);
  const adminGuard = new AdminGuard();

  const suffix = randomUUID().slice(0, 8);
  let adminPassword = 'StrongPassword!123';
  const admin = await users.bootstrap(`Admin.Roles.${suffix}`, 'Public Roles Admin', adminPassword);
  adminPassword = await completeBootstrapPassword(
    baseAuth,
    admin.id,
    admin.username,
    adminPassword,
  );
  const adminLogin = await baseAuth.login(admin.username, adminPassword, AuthClientType.WEB);
  const adminReq = createBearerRequest(adminLogin.accessToken, [
    'Authorization',
    `Bearer ${adminLogin.accessToken}`,
  ]);
  assert.equal(await userAuthGuard.canActivate(createHttpExecutionContext(adminReq)), true);
  assert.equal(adminGuard.canActivate(createHttpExecutionContext(adminReq)), true);

  const site = await sites.create(
    { code: `SITE-ROL-${suffix}`, name: 'Public Roles Site' },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  const initialPassword = 'WorkerRolesInitial!123';
  const targetUser = await users.create(
    {
      username: `worker.roles.${suffix}`,
      displayName: 'Public Roles Worker',
      temporaryPassword: initialPassword,
      roleAssignments: [{ role: UserRole.WORKER, siteId: site.id }],
    },
    configurationCommandContext(adminReq, userAuthGuard),
  );

  const existingSession = await baseAuth.login(
    targetUser.username,
    initialPassword,
    AuthClientType.WEB,
  );
  assert.equal(await authenticateStatus(baseAuth, existingSession.accessToken), 200);

  const onBeforeSessionInsert = createBoundedBarrier('public.roles.login.beforeSessionInsert');
  const releaseSessionInsert = createBoundedBarrier('public.roles.login.releaseSessionInsert');
  const snapshotReached = createBoundedBarrier('public.roles.snapshotReachedAfterReauthorize');

  const authWithLoginBarrier = new AuthService(
    createLoginSessionInsertBarrierDataSource(dataSource, {
      targetUserId: targetUser.id,
      interceptOnce: true,
      onBeforeSessionInsert,
      releaseSessionInsert,
    }),
    tokens,
  );

  const realContext = configurationCommandContext(adminReq, userAuthGuard);
  const wrappedContext: MainConfigurationCommandContext = {
    actorUserId: realContext.actorUserId,
    reauthorize: async (manager) => {
      await realContext.reauthorize?.(manager);
      snapshotReached.signal();
    },
  };

  let loginPromise: Promise<Awaited<ReturnType<typeof authWithLoginBarrier.login>>> | undefined;
  let replaceRolesPromise:
    Promise<Awaited<ReturnType<typeof users.replaceRoleAssignments>>> | undefined;
  try {
    // 1. Start target login and hold inside transaction after UserEntity FOR UPDATE + password + role checks, before AuthSessionEntity.insert
    loginPromise = authWithLoginBarrier.login(
      targetUser.username,
      initialPassword,
      AuthClientType.MOBILE,
    );
    await onBeforeSessionInsert.wait();

    // 2. Start public replaceRoleAssignments on the same active site (WORKER -> SECURITY_OFFICER) with real configurationCommandContext
    replaceRolesPromise = users.replaceRoleAssignments(
      targetUser.id,
      { roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: site.id }] },
      wrappedContext,
    );

    // 3. Wait until executeMainConfigurationCommand has entered its transaction and completed real actor/session/roles reauthorize
    await snapshotReached.wait();

    // 4. Release held login so AuthSessionEntity.insert + commit complete, then await both login and replaceRoleAssignments
    releaseSessionInsert.signal();
    const [loginOutcome, updatedUser] = await Promise.all([loginPromise, replaceRolesPromise]);
    assert.deepEqual(
      updatedUser.roleAssignments.map((assignment) => ({
        role: assignment.role,
        siteId: assignment.siteId,
      })),
      [{ role: UserRole.SECURITY_OFFICER, siteId: site.id }],
    );

    const roleReplaceWitnessRows = (await dataSource.query(
      `SELECT c.operation, c.actor_user_id
       FROM mf06_authority_command c
       JOIN mf06_authority_commit_witness w ON w.command_id = c.command_id
       WHERE c.operation = 'USER_ROLE_REPLACE' AND c.actor_user_id = $1`,
      [admin.id],
    )) as Array<{ operation: string; actor_user_id: string }>;
    assert.equal(roleReplaceWitnessRows.length, 1);

    const persistedAssignments = await dataSource
      .getRepository(UserRoleAssignmentEntity)
      .findBy({ userId: targetUser.id });
    assert.deepEqual(
      persistedAssignments.map((assignment) => ({
        role: assignment.role,
        siteId: assignment.siteId,
      })),
      [{ role: UserRole.SECURITY_OFFICER, siteId: site.id }],
    );

    // 5. Required invariant: completed role replacement must leave 0 active sessions and reject both existing and concurrent login tokens with 401
    const remainingActiveSessions = await dataSource
      .getRepository(AuthSessionEntity)
      .countBy({ userId: targetUser.id, revokedAt: IsNull() });
    assert.equal(remainingActiveSessions, 0);

    assert.equal(await authenticateStatus(authWithLoginBarrier, existingSession.accessToken), 401);
    assert.equal(await authenticateStatus(authWithLoginBarrier, loginOutcome.accessToken), 401);
  } finally {
    onBeforeSessionInsert.signal();
    snapshotReached.signal();
    releaseSessionInsert.signal();
    await Promise.allSettled([loginPromise, replaceRolesPromise].filter(Boolean));
  }
});

test('public changePassword (USER_PASSWORD_CHANGE) with real passwordChangeCommandContext revokes existing and concurrent login sessions', async () => {
  assert.ok(dataSource.isInitialized);
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');

  const config = createTestConfig();
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const tokens = new AuthTokenService(new JwtService(), config);
  const baseAuth = new AuthService(dataSource, tokens);
  const userAuthGuard = new UserAuthGuard(baseAuth);
  const adminGuard = new AdminGuard();

  const suffix = randomUUID().slice(0, 8);
  let adminPassword = 'StrongPassword!123';
  const admin = await users.bootstrap(
    `Admin.PwdChange.${suffix}`,
    'Public Password Change Admin',
    adminPassword,
  );
  adminPassword = await completeBootstrapPassword(
    baseAuth,
    admin.id,
    admin.username,
    adminPassword,
  );
  const adminLogin = await baseAuth.login(admin.username, adminPassword, AuthClientType.WEB);
  const adminReq = createBearerRequest(adminLogin.accessToken, [
    'Authorization',
    `Bearer ${adminLogin.accessToken}`,
  ]);
  assert.equal(await userAuthGuard.canActivate(createHttpExecutionContext(adminReq)), true);
  assert.equal(adminGuard.canActivate(createHttpExecutionContext(adminReq)), true);

  const site = await sites.create(
    { code: `SITE-CHG-${suffix}`, name: 'Public Password Change Site' },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  const initialPassword = 'WorkerSelfInitial!123';
  const nextPassword = 'WorkerSelfChanged!123';
  const targetUser = await users.create(
    {
      username: `worker.selfchange.${suffix}`,
      displayName: 'Public Password Change Worker',
      temporaryPassword: initialPassword,
      roleAssignments: [{ role: UserRole.WORKER, siteId: site.id }],
    },
    configurationCommandContext(adminReq, userAuthGuard),
  );

  // Establish targetUser's existing active session for real passwordChangeCommandContext
  const targetExistingSession = await baseAuth.login(
    targetUser.username,
    initialPassword,
    AuthClientType.WEB,
  );
  const targetExistingReq = createBearerRequest(targetExistingSession.accessToken, [
    'Authorization',
    `Bearer ${targetExistingSession.accessToken}`,
  ]);
  assert.equal(
    await userAuthGuard.canActivate(createHttpExecutionContext(targetExistingReq)),
    true,
  );

  // Enforce self-actor binding (mismatched actor context is rejected with 401) and old-password check
  const mismatchedAdminSelfContext = passwordChangeCommandContext(adminReq, userAuthGuard);
  assert.equal(
    await changePasswordStatus(
      baseAuth,
      targetUser.id,
      initialPassword,
      nextPassword,
      mismatchedAdminSelfContext,
    ),
    401,
  );
  assert.equal(
    await changePasswordStatus(
      baseAuth,
      targetUser.id,
      'WrongCurrentPassword!123',
      nextPassword,
      passwordChangeCommandContext(targetExistingReq, userAuthGuard),
    ),
    401,
  );
  assert.equal(await authenticateStatus(baseAuth, targetExistingSession.accessToken), 200);

  const onBeforeSessionInsert = createBoundedBarrier(
    'public.changePassword.login.beforeSessionInsert',
  );
  const releaseSessionInsert = createBoundedBarrier(
    'public.changePassword.login.releaseSessionInsert',
  );
  const coordinatorEnteredReauthorize = createBoundedBarrier(
    'public.changePassword.coordinatorEnteredReauthorize',
  );

  const authWithLoginBarrier = new AuthService(
    createLoginSessionInsertBarrierDataSource(dataSource, {
      targetUserId: targetUser.id,
      interceptOnce: true,
      onBeforeSessionInsert,
      releaseSessionInsert,
    }),
    tokens,
  );

  const realSelfContext = passwordChangeCommandContext(targetExistingReq, userAuthGuard);
  /**
   * In `USER_PASSWORD_CHANGE`, `targetUser` is both the self-actor and the target of the held login.
   * `executeMainConfigurationCommand` opens its transaction and executes `SELECT pg_advisory_xact_lock(48484, 1)`
   * (establishing the transaction snapshot) BEFORE calling `context.reauthorize(manager)`.
   * Inside `realSelfContext.reauthorize(manager)`, `auth.authenticate(token, manager)` requests `FOR SHARE`
   * on `targetUser` in `app_user`, which waits behind the held login's `FOR UPDATE` lock on `targetUser`.
   * Signaling `coordinatorEnteredReauthorize` immediately upon entering `reauthorize(manager)` guarantees
   * the coordinator transaction and advisory lock are active before releasing the held login to insert + commit.
   */
  const wrappedSelfContext: MainConfigurationCommandContext = {
    actorUserId: realSelfContext.actorUserId,
    reauthorize: async (manager) => {
      coordinatorEnteredReauthorize.signal();
      await realSelfContext.reauthorize?.(manager);
    },
  };

  let loginPromise: Promise<Awaited<ReturnType<typeof authWithLoginBarrier.login>>> | undefined;
  let changePasswordPromise: Promise<void> | undefined;
  try {
    // 1. Start concurrent target login and hold after UserEntity FOR UPDATE + password + role checks, before AuthSessionEntity.insert
    loginPromise = authWithLoginBarrier.login(
      targetUser.username,
      initialPassword,
      AuthClientType.MOBILE,
    );
    await onBeforeSessionInsert.wait();

    // 2. Start public changePassword with real passwordChangeCommandContext backed by targetExistingSession
    changePasswordPromise = authWithLoginBarrier.changePassword(
      targetUser.id,
      initialPassword,
      nextPassword,
      wrappedSelfContext,
    );

    // 3. Wait until executeMainConfigurationCommand has taken pg_advisory_xact_lock(48484, 1) and entered reauthorize(manager)
    await coordinatorEnteredReauthorize.wait();

    // 4. Release held login so AuthSessionEntity.insert + commit complete, unblocking FOR SHARE in reauthorize and FOR UPDATE in changePassword
    releaseSessionInsert.signal();
    const [loginOutcome] = await Promise.all([loginPromise, changePasswordPromise]);

    const changeWitnessRows = (await dataSource.query(
      `SELECT c.operation, c.actor_user_id
       FROM mf06_authority_command c
       JOIN mf06_authority_commit_witness w ON w.command_id = c.command_id
       WHERE c.operation = 'USER_PASSWORD_CHANGE' AND c.actor_user_id = $1`,
      [targetUser.id],
    )) as Array<{ operation: string; actor_user_id: string }>;
    assert.equal(changeWitnessRows.length, 1);

    // 5. Required invariant: completed own-password change must leave 0 active sessions and reject both existing and concurrent login tokens with 401
    const remainingActiveSessions = await dataSource
      .getRepository(AuthSessionEntity)
      .countBy({ userId: targetUser.id, revokedAt: IsNull() });
    assert.equal(remainingActiveSessions, 0);

    assert.equal(
      await authenticateStatus(authWithLoginBarrier, targetExistingSession.accessToken),
      401,
    );
    assert.equal(await authenticateStatus(authWithLoginBarrier, loginOutcome.accessToken), 401);

    // 6. Verify old password no longer logs in (401) and new password succeeds (200)
    assert.equal(
      await loginStatus(baseAuth, targetUser.username, initialPassword, AuthClientType.WEB),
      401,
    );
    assert.equal(
      await loginStatus(baseAuth, targetUser.username, nextPassword, AuthClientType.WEB),
      200,
    );
  } finally {
    onBeforeSessionInsert.signal();
    coordinatorEnteredReauthorize.signal();
    releaseSessionInsert.signal();
    await Promise.allSettled([loginPromise, changePasswordPromise].filter(Boolean));
  }
});
