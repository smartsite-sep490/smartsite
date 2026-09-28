import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../src/database/typeorm.options.js';
import { UserRoleAssignmentEntity } from '../src/database/entities/user-role-assignment.entity.js';
import { AuthSessionEntity } from '../src/database/entities/auth-session.entity.js';
import { UserEntity, UserRole } from '../src/database/entities/user.entity.js';

class MetadataDataSource extends DataSource {
  async prepareMetadata() {
    await this.buildMetadatas();
  }
}

test('user role catalog uses the six canonical persisted identifiers', () => {
  assert.deepEqual(Object.values(UserRole), [
    'ADMIN',
    'SITE_MANAGER',
    'CONTRACTOR_REPRESENTATIVE',
    'SAFETY_OFFICER',
    'SECURITY_OFFICER',
    'WORKER',
  ]);
});

test('authentication metadata maps role assignments as a separate scoped entity', async () => {
  const source = new MetadataDataSource(
    buildTypeOrmOptions({
      DATABASE_URL: 'postgresql://smartsite_test:test_only@127.0.0.1:5433/smartsite_test',
    }),
  );
  await source.prepareMetadata();

  const assignment = source.getMetadata(UserRoleAssignmentEntity);
  assert.equal(assignment.tableName, 'user_role_assignment');
  assert.deepEqual(assignment.columns.map((column) => column.databaseName).sort(), [
    'created_at',
    'id',
    'role',
    'site_id',
    'user_id',
  ]);
  assert.equal(source.getMetadata(UserEntity).findColumnWithPropertyName('role'), undefined);
  assert.deepEqual(
    source
      .getMetadata(AuthSessionEntity)
      .columns.map((column) => column.databaseName)
      .sort(),
    [
      'client_type',
      'created_at',
      'expires_at',
      'id',
      'last_refreshed_at',
      'refresh_token_hash',
      'revoked_at',
      'user_id',
    ],
  );
});
