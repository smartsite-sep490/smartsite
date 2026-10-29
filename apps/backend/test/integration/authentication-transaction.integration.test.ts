import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('transactional authentication holds account/session locks until commit and rejects later revocation', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const schema = (db.options as { schema: string }).schema;
    assert.match(schema, /^isolated_test_[0-9a-f]{32}$/);
    const userId = randomUUID();
    const sessionId = randomUUID();
    await db.query(
      `INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password)
       VALUES($1,$1::uuid::text,'Synthetic transaction actor','synthetic-unusable-hash',true,false)`,
      [userId],
    );
    await db.query(
      `INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)`,
      [randomUUID(), userId],
    );
    await db.query(
      `INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at,revoked_at)
       VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes',NULL)`,
      [sessionId, userId, 'a'.repeat(64)],
    );
    const tokens = new AuthTokenService(new JwtService(), createTestConfig());
    const issued = await tokens.issueAccessToken(userId, sessionId);
    const auth = new AuthService(db, tokens);
    const reader = db.createQueryRunner();
    const writer = db.createQueryRunner();
    try {
      await reader.connect();
      await writer.connect();
      await reader.startTransaction();
      const account = await auth.authenticate(issued.accessToken, reader.manager);
      assert.equal(account.user.id, userId);
      assert.equal(account.sessionId, sessionId);
      for (const [sql, id] of [
        [`UPDATE "${schema}".app_user SET is_active=false WHERE id=$1`, userId],
        [`UPDATE "${schema}".auth_session SET revoked_at=clock_timestamp() WHERE id=$1`, sessionId],
      ]) {
        await writer.startTransaction();
        try {
          await writer.query("SET LOCAL lock_timeout='100ms'");
          await assert.rejects(
            writer.query(sql!, [id]),
            (error: unknown) =>
              (error as { driverError?: { code?: string } }).driverError?.code === '55P03',
          );
        } finally {
          if (writer.isTransactionActive) await writer.rollbackTransaction();
        }
      }
      await reader.commitTransaction();
      await writer.query(
        `UPDATE "${schema}".auth_session SET revoked_at=clock_timestamp() WHERE id=$1`,
        [sessionId],
      );
      await assert.rejects(auth.authenticate(issued.accessToken), UnauthorizedException);
    } finally {
      if (reader.isTransactionActive) await reader.rollbackTransaction();
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await reader.release();
      await writer.release();
    }
  } finally {
    await owned.dispose();
  }
});
