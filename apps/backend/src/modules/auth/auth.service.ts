import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  executeMainConfigurationCommand,
  type MainConfigurationCommandContext,
} from '../../common/configuration/main-configuration-authority.js';
import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { AuthClientType, AuthSessionEntity } from '../../database/entities/auth-session.entity.js';
import { UserEntity } from '../../database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { AuthTokenService, REFRESH_SESSION_MS } from './auth-token.service.js';
import { hashPassword, validPassword, verifyPassword } from './password.js';
import { PASSWORD_POLICY_MESSAGE } from '../../common/configuration/password-policy.js';

const DUMMY_PASSWORD_HASH = hashPassword('nonexistent-account-password');

export type AuthenticatedUser = Pick<
  UserEntity,
  'id' | 'username' | 'displayName' | 'isActive' | 'mustChangePassword'
> & {
  roleAssignments: Array<Pick<UserRoleAssignmentEntity, 'role' | 'siteId'>>;
};

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  user?: AuthenticatedUser;
  sessionId?: string;
  clientType?: AuthClientType;
}

export function publicUser(
  user: UserEntity,
  assignments: Array<Pick<UserRoleAssignmentEntity, 'role' | 'siteId'>>,
): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roleAssignments: assignments
      .map(({ role, siteId }) => ({ role, siteId }))
      .sort((left, right) =>
        `${left.role}:${left.siteId ?? ''}`.localeCompare(`${right.role}:${right.siteId ?? ''}`),
      ),
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

function hashesMatch(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tokens: AuthTokenService,
  ) {}

  private async userResponse(manager: EntityManager, user: UserEntity) {
    const assignments = await manager.getRepository(UserRoleAssignmentEntity).findBy({
      userId: user.id,
    });
    if (assignments.length === 0) throw new UnauthorizedException();
    return publicUser(user, assignments);
  }

  async login(
    username: string,
    password: string,
    clientType: AuthClientType = AuthClientType.MOBILE,
  ) {
    const normalized = username.trim().toLowerCase();
    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ username: normalized });
    const storedHash = user?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const passwordMatches = await verifyPassword(password, storedHash);
    if (!user || !user.isActive || !passwordMatches) throw new UnauthorizedException();

    const sessionId = randomUUID();
    const refresh = this.tokens.issueRefreshToken(sessionId);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_SESSION_MS);
    const access = await this.tokens.issueAccessToken(user.id, sessionId);
    const account = await this.dataSource.transaction(async (manager) => {
      const current = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id: user.id })
        .getOne();
      if (!current?.isActive || current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException();
      const currentAccount = await this.userResponse(manager, current);
      const now = new Date();
      await manager.getRepository(AuthSessionEntity).insert({
        id: sessionId,
        userId: user.id,
        clientType,
        refreshTokenHash: refresh.secretHash,
        lastRefreshedAt: now,
        expiresAt: refreshExpiresAt,
        revokedAt: null,
      });
      return currentAccount;
    });
    return {
      accessToken: access.accessToken,
      tokenType: 'Bearer' as const,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
      user: account,
    };
  }

  /** A supplied mutation manager pins account/session authority until that transaction ends. */
  async authenticate(token: string, mutationManager?: EntityManager) {
    if (mutationManager && !mutationManager.queryRunner?.isTransactionActive)
      throw new UnauthorizedException();
    const claims = await this.tokens.verifyAccessToken(token);
    const manager = mutationManager ?? this.dataSource.manager;
    // Account first matches status/role/password writers; logout locks the session only.
    const user = mutationManager
      ? await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .setLock('pessimistic_read')
          .where('user.id = :id', { id: claims.userId })
          .getOne()
      : await manager.getRepository(UserEntity).findOneBy({ id: claims.userId });
    if (!user?.isActive) throw new UnauthorizedException();
    const session = mutationManager
      ? await manager
          .getRepository(AuthSessionEntity)
          .createQueryBuilder('session')
          .setLock('pessimistic_read')
          .where('session.id = :id', { id: claims.sessionId })
          .andWhere('session.userId = :userId', { userId: claims.userId })
          .getOne()
      : await manager.getRepository(AuthSessionEntity).findOneBy({
          id: claims.sessionId,
          userId: claims.userId,
        });
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now() ||
      claims.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException();
    return {
      user: await this.userResponse(manager, user),
      sessionId: session.id,
      clientType: session.clientType,
    };
  }

  async refresh(refreshToken: string, clientType: AuthClientType) {
    const presented = this.tokens.parseRefreshToken(refreshToken);
    const outcome = await this.dataSource.transaction(async (manager) => {
      const session = await manager
        .getRepository(AuthSessionEntity)
        .createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.id = :id', { id: presented.sessionId })
        .getOne();
      if (
        !session ||
        session.clientType !== clientType ||
        session.revokedAt !== null ||
        session.expiresAt.getTime() <= Date.now()
      )
        return undefined;
      if (!hashesMatch(session.refreshTokenHash, presented.secretHash)) {
        session.revokedAt = new Date();
        await manager.getRepository(AuthSessionEntity).save(session);
        return undefined;
      }
      const user = await manager.getRepository(UserEntity).findOneBy({ id: session.userId });
      if (!user?.isActive) {
        session.revokedAt = new Date();
        await manager.getRepository(AuthSessionEntity).save(session);
        return undefined;
      }
      const account = await this.userResponse(manager, user);
      const rotated = this.tokens.issueRefreshToken(session.id);
      session.refreshTokenHash = rotated.secretHash;
      session.lastRefreshedAt = new Date();
      await manager.getRepository(AuthSessionEntity).save(session);
      return { session, user, account, refreshToken: rotated.refreshToken };
    });
    if (!outcome) throw new UnauthorizedException();
    const access = await this.tokens.issueAccessToken(outcome.user.id, outcome.session.id);
    return {
      accessToken: access.accessToken,
      tokenType: 'Bearer' as const,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: outcome.refreshToken,
      refreshTokenExpiresAt: outcome.session.expiresAt.toISOString(),
      user: outcome.account,
    };
  }

  async logout(
    refreshToken: string,
    clientType: AuthClientType = AuthClientType.MOBILE,
  ): Promise<void> {
    let presented: { sessionId: string; secretHash: string };
    try {
      presented = this.tokens.parseRefreshToken(refreshToken);
    } catch {
      return;
    }
    await this.dataSource.transaction(async (manager) => {
      const session = await manager
        .getRepository(AuthSessionEntity)
        .createQueryBuilder('session')
        .setLock('pessimistic_write')
        .where('session.id = :id', { id: presented.sessionId })
        .getOne();
      if (!session || !hashesMatch(session.refreshTokenHash, presented.secretHash)) return;
      if (session.clientType !== clientType) throw new UnauthorizedException();
      if (session.revokedAt !== null) return;
      session.revokedAt = new Date();
      await manager.getRepository(AuthSessionEntity).save(session);
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context?: MainConfigurationCommandContext,
  ): Promise<void> {
    if (!validPassword(newPassword))
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: PASSWORD_POLICY_MESSAGE,
      });
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: userId });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash)))
      throw new UnauthorizedException();
    const replacement = await hashPassword(newPassword);
    if (context && context.actorUserId !== userId) throw new UnauthorizedException();
    await executeMainConfigurationCommand(
      this.dataSource,
      context,
      'USER_PASSWORD_CHANGE',
      { userId },
      async (manager) => {
        const current = await manager
          .getRepository(UserEntity)
          .createQueryBuilder('user')
          .setLock('pessimistic_write')
          .where('user.id = :id', { id: userId })
          .getOne();
        if (!current?.isActive || current.passwordHash !== user.passwordHash)
          throw new UnauthorizedException();
        await manager.getRepository(UserEntity).update(
          { id: userId },
          {
            passwordHash: replacement,
            mustChangePassword: false,
          },
        );
        await manager
          .getRepository(AuthSessionEntity)
          .createQueryBuilder()
          .update()
          .set({ revokedAt: new Date() })
          .where('user_id = :userId AND revoked_at IS NULL', { userId })
          .execute();
      },
      // Self-target binding above plus transactional bearer/account checks replace
      // the management helper's default Admin requirement for this existing route.
      async () => {},
    );
  }
}
