import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { DataSource, In, type EntityManager } from 'typeorm';
import { command, knownUnique, page, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { AuthSessionEntity } from '../../database/entities/auth-session.entity.js';
import { UserRoleAssignmentEntity } from '../../database/entities/user-role-assignment.entity.js';
import { UserEntity, UserRole } from '../../database/entities/user.entity.js';
import { hashPassword, validPassword } from '../auth/password.js';
import { publicUser } from '../auth/auth.service.js';
import { SiteConfigurationService } from '../sites/site-configuration.service.js';
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_POLICY_PATTERN,
} from '../../common/configuration/password-policy.js';

const username = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const displayName = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const PROVISIONABLE_USER_ROLES = [
  UserRole.ADMIN,
  UserRole.SITE_MANAGER,
  UserRole.CONTRACTOR_REPRESENTATIVE,
  UserRole.SAFETY_OFFICER,
  UserRole.SECURITY_OFFICER,
  UserRole.WORKER,
] as const;
type ProvisionableUserRole = (typeof PROVISIONABLE_USER_ROLES)[number];
const PROVISIONABLE_SITE_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.SITE_MANAGER,
  UserRole.CONTRACTOR_REPRESENTATIVE,
  UserRole.SAFETY_OFFICER,
  UserRole.SECURITY_OFFICER,
  UserRole.WORKER,
]);

export class RoleAssignmentDto {
  @ApiProperty({ enum: [...PROVISIONABLE_USER_ROLES] })
  @IsIn(PROVISIONABLE_USER_ROLES)
  role!: ProvisionableUserRole;

  @ApiProperty({ format: 'uuid', nullable: true })
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  siteId!: string | null;
}

export class ReplaceRoleAssignmentsDto {
  @ApiProperty({ type: () => [RoleAssignmentDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roleAssignments!: RoleAssignmentDto[];
}

export class CreateUserDto extends ReplaceRoleAssignmentsDto {
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

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  temporaryPassword!: string;
}

export class SetUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_PATTERN, { message: PASSWORD_POLICY_MESSAGE })
  temporaryPassword!: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sites: SiteConfigurationService,
  ) {}

  /** Lock the account so disable/role replacement cannot race a workflow command. */
  async safetyActor(manager: EntityManager, id: string) {
    const user = await manager.getRepository(UserEntity).findOne({
      where: { id: uuid(id) },
      lock: { mode: 'pessimistic_read' },
    });
    if (!user?.isActive || user.mustChangePassword)
      throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
    const assignments = await manager
      .getRepository(UserRoleAssignmentEntity)
      .findBy({ userId: user.id });
    return publicUser(user, assignments);
  }
  async requireSafetyAssignee(manager: EntityManager, id: string, siteId: string, role: UserRole) {
    const user = await manager.getRepository(UserEntity).findOne({
      where: { id: uuid(id), isActive: true },
      lock: { mode: 'pessimistic_read' },
    });
    const assignment =
      user &&
      (await manager
        .getRepository(UserRoleAssignmentEntity)
        .findOneBy({ userId: user.id, siteId, role }));
    if (!assignment)
      throw new PublicHttpException(403, {
        code: 'FORBIDDEN',
        message: 'Assignee must be active with the required Site role',
      });
  }
  async listSafetyAssignees(siteId: string, role: UserRole, offset = 0, limit = 20) {
    const pagination = page(offset, limit);
    const query = this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .innerJoin(
        UserRoleAssignmentEntity,
        'role',
        'role.userId=user.id AND role.siteId=:siteId AND role.role=:role',
        { siteId: uuid(siteId), role },
      )
      .where('user.isActive=TRUE')
      .orderBy('user.displayName', 'ASC')
      .addOrderBy('user.id', 'ASC');
    const total = await query.getCount();
    const items = await query
      .select(['user.id', 'user.displayName'])
      .skip(pagination.offset)
      .take(pagination.limit)
      .getMany();
    return { items: items.map(({ id, displayName }) => ({ id, displayName })), total };
  }
  private invalidAssignments(): never {
    throw new PublicHttpException(HttpStatus.BAD_REQUEST, {
      code: 'VALIDATION_FAILED',
      message: 'Invalid role assignments',
    });
  }

  private async validateAssignments(assignments: RoleAssignmentDto[]) {
    const seen = new Set<string>();
    const siteIds = new Set<string>();
    for (const assignment of assignments) {
      const globalAdmin = assignment.role === UserRole.ADMIN && assignment.siteId === null;
      const scopedRole = PROVISIONABLE_SITE_ROLES.has(assignment.role) && !!assignment.siteId;
      if (!globalAdmin && !scopedRole) this.invalidAssignments();
      const key = `${assignment.role}:${assignment.siteId ?? ''}`;
      if (seen.has(key)) this.invalidAssignments();
      seen.add(key);
      if (assignment.siteId) siteIds.add(assignment.siteId);
    }
    await Promise.all([...siteIds].map((siteId) => this.sites.get(siteId)));
  }

  private async response(manager: EntityManager, user: UserEntity) {
    const assignments = await manager.getRepository(UserRoleAssignmentEntity).findBy({
      userId: user.id,
    });
    return publicUser(user, assignments);
  }

  private async revokeSessions(manager: EntityManager, userId: string) {
    await manager
      .getRepository(AuthSessionEntity)
      .createQueryBuilder()
      .update()
      .set({ revokedAt: new Date() })
      .where('user_id = :userId AND revoked_at IS NULL', { userId })
      .execute();
  }

  private async activeAdminCount(manager: EntityManager) {
    return manager
      .getRepository(UserEntity)
      .createQueryBuilder('user')
      .innerJoin(
        UserRoleAssignmentEntity,
        'assignment',
        "assignment.user_id = user.id AND assignment.role = 'ADMIN' AND assignment.site_id IS NULL",
      )
      .where('user.is_active = TRUE')
      .getCount();
  }

  async create(input: CreateUserDto) {
    const value = command(CreateUserDto, input);
    await this.validateAssignments(value.roleAssignments);
    const passwordHash = await hashPassword(value.temporaryPassword);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const user = await manager.getRepository(UserEntity).save({
          id: randomUUID(),
          username: value.username,
          displayName: value.displayName,
          passwordHash,
          isActive: true,
          mustChangePassword: true,
        });
        await manager.getRepository(UserRoleAssignmentEntity).insert(
          value.roleAssignments.map(({ role, siteId }) => ({
            id: randomUUID(),
            userId: user.id,
            role,
            siteId,
          })),
        );
        return this.response(manager, user);
      });
    } catch (error) {
      knownUnique(error, ['uq_app_user_username']);
    }
  }

  async bootstrap(usernameValue: string, displayNameValue: string, password: string) {
    if (!validPassword(password)) throw new Error(PASSWORD_POLICY_MESSAGE);
    const value = command(CreateUserDto, {
      username: usernameValue,
      displayName: displayNameValue,
      roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
      temporaryPassword: password,
    });
    const passwordHash = await hashPassword(value.temporaryPassword);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(48484, 1)');
      if ((await this.activeAdminCount(manager)) !== 0)
        throw new ConflictException('Initial Admin already exists');
      const user = await manager.getRepository(UserEntity).save({
        id: randomUUID(),
        username: value.username,
        displayName: value.displayName,
        passwordHash,
        isActive: true,
        mustChangePassword: true,
      });
      await manager.getRepository(UserRoleAssignmentEntity).insert({
        id: randomUUID(),
        userId: user.id,
        role: UserRole.ADMIN,
        siteId: null,
      });
      return this.response(manager, user);
    });
  }

  /** Labels for references already authorized by the consuming use case, including inactive accounts. */
  async displayNames(
    manager: EntityManager,
    ids: Array<string | null>,
  ): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return {};
    const rows = await manager
      .getRepository(UserEntity)
      .find({ where: { id: In(unique) }, select: { id: true, displayName: true } });
    return Object.fromEntries(rows.map((row) => [row.id, row.displayName]));
  }
  async get(id: string) {
    const user = await this.dataSource.getRepository(UserEntity).findOneBy({ id: uuid(id) });
    if (!user) throw new NotFoundException();
    return this.response(this.dataSource.manager, user);
  }

  async list(offset = 0, limit = 20) {
    const pagination = page(offset, limit);
    const [users, total] = await this.dataSource.getRepository(UserEntity).findAndCount({
      order: { username: 'ASC', id: 'ASC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    const assignments = users.length
      ? await this.dataSource
          .getRepository(UserRoleAssignmentEntity)
          .findBy({ userId: In(users.map(({ id }) => id)) })
      : [];
    return {
      items: users.map((user) =>
        publicUser(
          user,
          assignments.filter(({ userId }) => userId === user.id),
        ),
      ),
      total,
    };
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
      if (user.isActive === value.isActive) return this.response(manager, user);
      if (!value.isActive && actorId === id) throw new ForbiddenException();
      const assignments = await manager
        .getRepository(UserRoleAssignmentEntity)
        .findBy({ userId: id });
      if (value.isActive && assignments.length === 0) this.invalidAssignments();
      if (
        !value.isActive &&
        assignments.some(({ role, siteId }) => role === UserRole.ADMIN && siteId === null) &&
        (await this.activeAdminCount(manager)) <= 1
      )
        throw new ConflictException('At least one active Admin is required');
      user.isActive = value.isActive;
      await manager.getRepository(UserEntity).save(user);
      if (!value.isActive) await this.revokeSessions(manager, id);
      return publicUser(user, assignments);
    });
  }

  async replaceRoleAssignments(userId: string, input: ReplaceRoleAssignmentsDto) {
    const value = command(ReplaceRoleAssignmentsDto, input);
    await this.validateAssignments(value.roleAssignments);
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
      const current = await manager.getRepository(UserRoleAssignmentEntity).findBy({ userId: id });
      const removesAdmin =
        current.some(({ role, siteId }) => role === UserRole.ADMIN && siteId === null) &&
        !value.roleAssignments.some(
          ({ role, siteId }) => role === UserRole.ADMIN && siteId === null,
        );
      if (user.isActive && removesAdmin && (await this.activeAdminCount(manager)) <= 1)
        throw new ConflictException('At least one active Admin is required');
      await manager.getRepository(UserRoleAssignmentEntity).delete({ userId: id });
      await manager.getRepository(UserRoleAssignmentEntity).insert(
        value.roleAssignments.map(({ role, siteId }) => ({
          id: randomUUID(),
          userId: id,
          role,
          siteId,
        })),
      );
      await this.revokeSessions(manager, id);
      return this.response(manager, user);
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
      await manager
        .getRepository(UserEntity)
        .update({ id }, { passwordHash: replacement, mustChangePassword: true });
      await this.revokeSessions(manager, id);
    });
  }
}
