import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { DataSource } from 'typeorm';
import { command, knownUnique, page, uuid } from '../../common/configuration/commands.js';
import { AuthSessionEntity } from '../../database/entities/auth-session.entity.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { hashPassword, validPassword } from '../auth/password.js';
import { publicUser } from '../auth/auth.service.js';

const username = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const displayName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateUserDto {
  @Transform(username)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{2,63}$/)
  username!: string;

  @Transform(displayName)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Matches(/^[^\p{Cc}\p{Cs}]+$/u)
  displayName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsString()
  @MinLength(15)
  @MaxLength(128)
  temporaryPassword!: string;
}

export class SetUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(15)
  @MaxLength(128)
  temporaryPassword!: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(input: CreateUserDto) {
    const value = command(CreateUserDto, input);
    const passwordHash = await hashPassword(value.temporaryPassword);
    try {
      const user = await this.dataSource.getRepository(UserEntity).save({
        id: randomUUID(),
        username: value.username,
        displayName: value.displayName,
        role: value.role,
        passwordHash,
        isActive: true,
        mustChangePassword: true,
      });
      return publicUser(user);
    } catch (error) {
      knownUnique(error, ['uq_app_user_username']);
    }
  }

  async bootstrap(usernameValue: string, displayNameValue: string, password: string) {
    if (!validPassword(password)) throw new Error('Password must be 15–128 characters');
    const value = command(CreateUserDto, {
      username: usernameValue,
      displayName: displayNameValue,
      role: UserRole.ADMIN,
      temporaryPassword: password,
    });
    const passwordHash = await hashPassword(value.temporaryPassword);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(48484, 1)');
      if ((await manager.getRepository(UserEntity).count()) !== 0)
        throw new ConflictException('Initial Admin already exists');
      const user = await manager.getRepository(UserEntity).save({
        id: randomUUID(),
        username: value.username,
        displayName: value.displayName,
        passwordHash,
        role: UserRole.ADMIN,
        isActive: true,
        mustChangePassword: true,
      });
      return publicUser(user);
    });
  }

  async get(id: string) {
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: uuid(id) });
    if (!user) throw new NotFoundException();
    return publicUser(user);
  }

  async list(offset = 0, limit = 20) {
    const pagination = page(offset, limit);
    const [items, total] = await this.dataSource.getRepository(UserEntity).findAndCount({
      order: { username: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items: items.map(publicUser), total };
  }

  async setStatus(actorId: string, userId: string, input: SetUserStatusDto) {
    const value = command(SetUserStatusDto, input);
    const id = uuid(userId);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(48484, 1)');
      const user = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id })
        .getOne();
      if (!user) throw new NotFoundException();
      if (user.isActive === value.isActive) return publicUser(user);
      if (!value.isActive && actorId === id) throw new ForbiddenException();
      if (!value.isActive && user.role === UserRole.ADMIN) {
        const activeAdmins = await manager.getRepository(UserEntity).countBy({
          role: UserRole.ADMIN,
          isActive: true,
        });
        if (activeAdmins <= 1) throw new ConflictException('At least one active Admin is required');
      }
      user.isActive = value.isActive;
      await manager.getRepository(UserEntity).save(user);
      if (!value.isActive) await manager.getRepository(AuthSessionEntity).delete({ userId: id });
      return publicUser(user);
    });
  }

  async resetPassword(userId: string, input: ResetPasswordDto) {
    const value = command(ResetPasswordDto, input);
    const id = uuid(userId);
    const replacement = await hashPassword(value.temporaryPassword);
    await this.dataSource.transaction(async (manager) => {
      const user = await manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .setLock('pessimistic_write')
        .where('user.id = :id', { id })
        .getOne();
      if (!user) throw new NotFoundException();
      await manager.getRepository(UserEntity).update(
        { id },
        {
          passwordHash: replacement,
          mustChangePassword: true,
        },
      );
      await manager.getRepository(AuthSessionEntity).delete({ userId: id });
    });
  }
}
