import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { AuthSessionEntity } from '../../database/entities/auth-session.entity.js';
import { UserEntity } from '../../database/entities/user.entity.js';
import { hashPassword, validPassword, verifyPassword } from './password.js';

const SESSION_MS = 8 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DUMMY_PASSWORD_HASH = hashPassword('nonexistent-account-password');

export type AuthenticatedUser = Pick<
  UserEntity,
  'id' | 'username' | 'displayName' | 'role' | 'isActive' | 'mustChangePassword'
>;

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  rawHeaders?: string[];
  user?: AuthenticatedUser;
  tokenHash?: string;
}

export function publicUser(user: UserEntity): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

@Injectable()
export class AuthService {
  constructor(private readonly dataSource: DataSource) {}

  async login(username: string, password: string) {
    const normalized = username.trim().toLowerCase();
    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ username: normalized });
    // Keep the expensive password check even for an unknown account.
    const storedHash = user?.passwordHash ?? (await DUMMY_PASSWORD_HASH);
    const passwordMatches = await verifyPassword(password, storedHash);
    if (!user || !user.isActive || !passwordMatches) throw new UnauthorizedException();

    const accessToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_MS);
    await this.dataSource.transaction(async (manager) => {
      const current = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id: user.id })
        .getOne();
      if (!current?.isActive || current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException();
      await manager.getRepository(AuthSessionEntity).insert({
        tokenHash: tokenHash(accessToken),
        userId: user.id,
        expiresAt,
      });
    });
    return {
      accessToken,
      tokenType: 'Bearer' as const,
      expiresAt: expiresAt.toISOString(),
      user: publicUser(user),
    };
  }

  async authenticate(token: string): Promise<{ user: AuthenticatedUser; tokenHash: string }> {
    if (!TOKEN_PATTERN.test(token)) throw new UnauthorizedException();
    const hash = tokenHash(token);
    const session = await this.dataSource
      .getRepository(AuthSessionEntity)
      .findOneBy({ tokenHash: hash });
    if (!session || session.expiresAt.getTime() <= Date.now()) throw new UnauthorizedException();
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: session.userId });
    if (!user?.isActive) throw new UnauthorizedException();
    return { user: publicUser(user), tokenHash: hash };
  }

  async logout(hash: string): Promise<void> {
    await this.dataSource.getRepository(AuthSessionEntity).delete({ tokenHash: hash });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (!validPassword(newPassword))
      throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
        code: 'VALIDATION_FAILED',
        message: 'Invalid password length',
      });
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: userId });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash)))
      throw new UnauthorizedException();
    const replacement = await hashPassword(newPassword);
    await this.dataSource.transaction(async (manager) => {
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
      await manager.getRepository(AuthSessionEntity).delete({ userId });
    });
  }
}
