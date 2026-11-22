import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../../src/config/environment.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import {
  AuthClientType,
  AuthSessionEntity,
} from '../../src/database/entities/auth-session.entity.js';
import { UserEntity } from '../../src/database/entities/user.entity.js';
import { decryptAccountEmail, emailCodeHash } from '../../src/modules/auth/account-email-crypto.js';
import { AccountEmailService } from '../../src/modules/auth/account-email.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
  type MainAuthorityCutoverReleaseConfig,
} from '../../src/modules/zones/main-authority-cutover-release.js';
import { MainAuthorityCutoverService } from '../../src/modules/zones/main-authority-cutover.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function createSyntheticCutoverRelease(sourceRegistryHash: string): Promise<{
  release: MainAuthorityCutoverReleaseConfig;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'mf06-email-reset-authority-'));
  const releaseRoot = join(root, 'release');
  const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
  const files = [];
  for (const path of MAIN_AUTHORITY_CUTOVER_RELEASE_FILES) {
    const target = resolve(releaseRoot, path);
    await mkdir(dirname(target), { recursive: true });
    // Synthetic test pin only; never represents operational source/writer review.
    const bytes = Buffer.from(`// SYNTHETIC_TEST pin ${path}\n`);
    await writeFile(target, bytes, { flag: 'wx' });
    files.push({ path, sha256: sha256(bytes) });
  }
  const runtimeFiles = await Promise.all(
    MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES.map(async (path) => ({
      path,
      sha256: sha256(await readFile(resolve(runtimeRoot, path))),
    })),
  );
  const manifestPath = join(root, 'SYNTHETIC-TEST-MANIFEST.json');
  const releaseCommit = 'b'.repeat(40);
  const manifestBytes = Buffer.from(
    JSON.stringify({
      version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1',
      releaseCommit,
      captureProfile: 'NAMED_V2_CONTROLLED_CUTOVER_V1',
      provenance: 'SYNTHETIC_TEST',
      sourceRegistryHash,
      files,
      runtimeFiles,
      writerReview: {
        protocol: 'PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1',
        sourceIndexSha256: 'c'.repeat(64),
        methods: 1,
        files: 1,
        exactQuotesAndSourcePinsVerified: true,
        missingOrDuplicateMethods: false,
        completeWriterClosureEstablished: true,
        rows: [
          {
            file: 'modules/auth/auth.service.ts',
            method: 'syntheticFixtureOnly',
            fileSha256: files.find((item) => item.path.endsWith('/auth.service.ts'))!.sha256,
            methodBodySha256: 'd'.repeat(64),
            classification: 'MASKED_COMMAND',
          },
        ],
      },
    }),
  );
  await writeFile(manifestPath, manifestBytes, { flag: 'wx' });
  return {
    release: {
      manifestPath,
      reviewedManifestSha256: sha256(manifestBytes),
      releaseRoot,
      releaseCommit,
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

async function setupReadyAuthorityFixture(
  users: ReadonlyArray<{
    email: string;
    mustChangePassword: boolean;
  }>,
) {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  let authoritySource: DataSource | undefined;
  let cleanupRelease: (() => Promise<void>) | undefined;
  const secret = 'synthetic-email-reset-authority-secret-32b';
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: secret,
    RESEND_API_KEY: 're_synthetic_never_called',
    RESEND_FROM_EMAIL: 'sender@example.test',
  });

  try {
    await owned.initialize();
    authoritySource = new DataSource(
      buildMigrationOptions(
        { DATABASE_URL: resolveTestDatabaseUrl() },
        { profile: 'tracked-v17-identification-ppe-authority', schema: db.driver.schema },
      ),
    );
    await authoritySource.initialize();
    await authoritySource.runMigrations();

    const adminPassword = 'SyntheticAdminPass9!';
    const initialPassword = 'SyntheticInitialPass9!';
    const admin = await db.getRepository(UserEntity).save({
      id: randomUUID(),
      username: `admin-${randomUUID().slice(0, 8)}`,
      displayName: 'Synthetic Authority Admin',
      passwordHash: await hashPassword(adminPassword),
      email: 'admin-authority@example.test',
      emailVerifiedAt: new Date(),
      isActive: true,
      mustChangePassword: false,
    });
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,NULL,'ADMIN')",
      [randomUUID(), admin.id],
    );

    const createdUsers: UserEntity[] = [];
    for (const spec of users) {
      createdUsers.push(
        await db.getRepository(UserEntity).save({
          id: randomUUID(),
          username: `user-${randomUUID().slice(0, 8)}`,
          displayName: 'Synthetic Reset User',
          passwordHash: await hashPassword(initialPassword),
          email: spec.email,
          emailVerifiedAt: new Date(),
          isActive: true,
          mustChangePassword: spec.mustChangePassword,
        }),
      );
    }

    const [registry] = await db.query<Array<{ hash: string }>>(
      `SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind COLLATE "C")::text,'UTF8')),'hex') AS hash
         FROM authorization_history_source s`,
    );
    assert.ok(registry?.hash);
    const synthetic = await createSyntheticCutoverRelease(registry.hash);
    cleanupRelease = synthetic.cleanup;

    const auth = new AuthService(db, new AuthTokenService(new JwtService(), config));
    const guard = new UserAuthGuard(auth);
    const adminLogin = await auth.login(admin.username, adminPassword, AuthClientType.WEB);
    const adminRequest: AuthenticatedRequest = {
      headers: { authorization: `Bearer ${adminLogin.accessToken}` },
    };
    await guard.authenticateRequest(adminRequest);

    const cutover = await new MainAuthorityCutoverService(
      db,
      guard,
      synthetic.release,
      config,
    ).activate(adminRequest, null);
    assert.equal(cutover.commitStatus, 'COMMITTED');
    assert.equal(cutover.witnessConfirmed, true);

    return {
      db,
      config,
      secret,
      epochId: cutover.epochId,
      users: createdUsers,
      service: new AccountEmailService(db, config),
      async assertEpochReady(label: string) {
        const [epoch] = await db.query<Array<{ state: string; gapped_at: Date | null }>>(
          'SELECT state, gapped_at FROM authorization_history_epoch WHERE epoch_id=$1',
          [cutover.epochId],
        );
        assert.equal(epoch?.state, 'READY', `${label}: epoch must remain READY`);
        assert.equal(epoch?.gapped_at, null, `${label}: gapped_at must remain null`);
        const [gaps] = await db.query<Array<{ count: number }>>(
          'SELECT count(*)::int AS count FROM authorization_history_gap WHERE epoch_id=$1',
          [cutover.epochId],
        );
        assert.equal(gaps?.count, 0, `${label}: epoch must have zero authority gaps`);
      },
      async createActiveSession(userId: string) {
        return db.getRepository(AuthSessionEntity).save({
          id: randomUUID(),
          userId,
          clientType: AuthClientType.MOBILE,
          refreshTokenHash: randomUUID().replaceAll('-', '').repeat(2),
          lastRefreshedAt: new Date(),
          expiresAt: new Date(Date.now() + 3_600_000),
          revokedAt: null,
        });
      },
      async readLatestResetCode(userId: string) {
        const [mail] = await db.query<Array<{ payload_ciphertext: string }>>(
          `SELECT o.payload_ciphertext
             FROM account_email_outbox o
             JOIN account_email_challenge c ON c.id=o.challenge_id
            WHERE c.user_id=$1 AND c.purpose='RESET' AND c.consumed_at IS NULL
            ORDER BY c.created_at DESC, c.id DESC
            LIMIT 1`,
          [userId],
        );
        assert.ok(mail, 'Expected queued RESET outbox row');
        const text = (decryptAccountEmail(mail.payload_ciphertext, secret) as { text: string })
          .text;
        const code = /: (\d{6})\n/.exec(text)?.[1];
        assert.ok(code, 'Expected 6-digit RESET code in encrypted outbox payload');
        return code;
      },
      async dispose() {
        await cleanupRelease?.();
        if (authoritySource?.isInitialized) await authoritySource.destroy();
        await owned.dispose();
      },
    };
  } catch (error) {
    await cleanupRelease?.();
    if (authoritySource?.isInitialized) await authoritySource.destroy();
    await owned.dispose();
    throw error;
  }
}

for (const mustChangePassword of [true, false]) {
  test(`valid AccountEmailService.confirmReset (mustChangePassword=${mustChangePassword}) retains READY epoch with witnessed USER_PASSWORD_CHANGE and blocks replay`, async (t) => {
    let fetchCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      fetchCalls += 1;
      throw new Error('Unexpected outbound network/email call');
    });
    const fixture = await setupReadyAuthorityFixture([
      { email: `reset-${mustChangePassword}@example.test`, mustChangePassword },
    ]);
    try {
      const user = fixture.users[0]!;
      const session = await fixture.createActiveSession(user.id);
      await fixture.service.requestReset(user.email!);
      const code = await fixture.readLatestResetCode(user.id);
      const nextPassword = 'ValidReplacementPass9!';

      assert.deepEqual(
        await fixture.service.confirmReset(
          mustChangePassword ? user.username : user.email!,
          code,
          nextPassword,
        ),
        { accepted: true },
      );

      const updated = await fixture.db.getRepository(UserEntity).findOneByOrFail({ id: user.id });
      assert.equal(updated.mustChangePassword, false);
      assert.equal(await verifyPassword(nextPassword, updated.passwordHash), true);
      assert.ok(
        (await fixture.db.getRepository(AuthSessionEntity).findOneByOrFail({ id: session.id }))
          .revokedAt,
        'active sessions must be revoked atomically',
      );

      await fixture.assertEpochReady(`after mustChangePassword=${mustChangePassword} valid reset`);

      const commands = await fixture.db.query<
        Array<{ command_id: string; operation: string; request_hash: string; witnessed: boolean }>
      >(
        `SELECT c.command_id, c.operation, c.request_hash,
                EXISTS(
                  SELECT 1 FROM authorization_history_commit_receipt w
                   WHERE w.command_id=c.command_id AND w.transaction_id=c.transaction_id
                ) AS witnessed
           FROM authorization_history_command c
          WHERE c.actor_user_id=$1 AND c.operation='USER_PASSWORD_CHANGE'`,
        [user.id],
      );
      assert.equal(commands.length, 1, 'valid reset must record canonical USER_PASSWORD_CHANGE');
      assert.equal(commands[0]!.witnessed, true, 'canonical command must have commit receipt');

      const revisions = await fixture.db.query<
        Array<{
          command_id: string | null;
          before_payload: Record<string, unknown>;
          after_payload: Record<string, unknown>;
        }>
      >(
        `SELECT command_id, before_payload, after_payload
           FROM authorization_history_revision
          WHERE source_kind='USER_ACCOUNT' AND source_id=$1 AND epoch_id=$2`,
        [user.id, fixture.epochId],
      );
      assert.equal(revisions.length, 1);
      assert.equal(revisions[0]!.command_id, commands[0]!.command_id);
      assert.equal(revisions[0]!.before_payload.must_change_password, mustChangePassword);
      assert.equal(revisions[0]!.after_payload.must_change_password, false);
      const serialized = JSON.stringify(revisions[0]);
      assert.equal(serialized.includes(code), false, 'OTP code must not appear in history');
      assert.equal(serialized.includes(nextPassword), false, 'password must not appear in history');
      assert.equal(
        serialized.includes(updated.passwordHash),
        false,
        'password hash must not appear in history',
      );

      // Replay of the consumed code must fail closed with zero additional authority writes.
      await assert.rejects(
        fixture.service.confirmReset(user.username, code, 'ReplayShouldFail9!'),
        (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 400,
      );
      const [afterReplay] = await fixture.db.query<Array<{ count: number }>>(
        `SELECT count(*)::int AS count
           FROM authorization_history_command
          WHERE actor_user_id=$1 AND operation='USER_PASSWORD_CHANGE'`,
        [user.id],
      );
      assert.equal(afterReplay?.count, 1);
      assert.equal(
        (await fixture.db.getRepository(UserEntity).findOneByOrFail({ id: user.id })).passwordHash,
        updated.passwordHash,
      );
      await fixture.assertEpochReady(`after mustChangePassword=${mustChangePassword} replay`);
      assert.equal(fetchCalls, 0);
    } finally {
      await fixture.dispose();
    }
  });
}

test('wrong, expired, and already-consumed reset codes commit attempt increments without authority command, gap, password, or session change', async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    throw new Error('Unexpected outbound network/email call');
  });
  const fixture = await setupReadyAuthorityFixture([
    { email: 'wrong-code@example.test', mustChangePassword: true },
    { email: 'expired-code@example.test', mustChangePassword: false },
    { email: 'consumed-code@example.test', mustChangePassword: false },
  ]);
  try {
    const [wrongUser, expiredUser, consumedUser] = fixture.users;
    assert.ok(wrongUser && expiredUser && consumedUser);

    // Wrong code: attempt increment commits while password, session, and authority state remain untouched.
    await fixture.service.requestReset(wrongUser.email!);
    const validCode = await fixture.readLatestResetCode(wrongUser.id);
    const wrongCode = validCode === '999999' ? '888888' : '999999';
    const wrongSession = await fixture.createActiveSession(wrongUser.id);
    const wrongHashBefore = wrongUser.passwordHash;

    await assert.rejects(
      fixture.service.confirmReset(wrongUser.username, wrongCode, 'WrongCodeShouldFail9!'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 400,
    );
    const [attemptRow] = await fixture.db.query<
      Array<{ attempts: number; consumed_at: Date | null }>
    >(
      `SELECT attempts, consumed_at
         FROM account_email_challenge
        WHERE user_id=$1 AND purpose='RESET'
        ORDER BY created_at DESC, id DESC LIMIT 1`,
      [wrongUser.id],
    );
    assert.equal(attemptRow?.attempts, 1, 'wrong code must commit attempts increment');
    assert.equal(attemptRow?.consumed_at, null);
    assert.equal(
      (await fixture.db.getRepository(UserEntity).findOneByOrFail({ id: wrongUser.id }))
        .passwordHash,
      wrongHashBefore,
    );
    assert.equal(
      (await fixture.db.getRepository(AuthSessionEntity).findOneByOrFail({ id: wrongSession.id }))
        .revokedAt,
      null,
    );

    // Expired challenge: rejected with no write.
    const expiredCode = '654321';
    await fixture.db.query(
      `INSERT INTO account_email_challenge(id,user_id,email,purpose,token_hash,expires_at)
       VALUES($1,$2,$3,'RESET',$4,now()-interval '1 minute')`,
      [
        randomUUID(),
        expiredUser.id,
        expiredUser.email,
        emailCodeHash(fixture.secret, expiredUser.id, 'RESET', expiredCode),
      ],
    );
    const expiredSession = await fixture.createActiveSession(expiredUser.id);
    const expiredHashBefore = expiredUser.passwordHash;

    await assert.rejects(
      fixture.service.confirmReset(expiredUser.username, expiredCode, 'ExpiredShouldFail9!'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 400,
    );
    assert.equal(
      (await fixture.db.getRepository(UserEntity).findOneByOrFail({ id: expiredUser.id }))
        .passwordHash,
      expiredHashBefore,
    );
    assert.equal(
      (await fixture.db.getRepository(AuthSessionEntity).findOneByOrFail({ id: expiredSession.id }))
        .revokedAt,
      null,
    );

    // Already-consumed challenge replay: rejected with no write.
    const consumedCode = '123456';
    await fixture.db.query(
      `INSERT INTO account_email_challenge(id,user_id,email,purpose,token_hash,expires_at,consumed_at)
       VALUES($1,$2,$3,'RESET',$4,now()+interval '10 minutes',now())`,
      [
        randomUUID(),
        consumedUser.id,
        consumedUser.email,
        emailCodeHash(fixture.secret, consumedUser.id, 'RESET', consumedCode),
      ],
    );
    const consumedSession = await fixture.createActiveSession(consumedUser.id);
    const consumedHashBefore = consumedUser.passwordHash;

    await assert.rejects(
      fixture.service.confirmReset(consumedUser.username, consumedCode, 'ConsumedShouldFail9!'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 400,
    );
    assert.equal(
      (await fixture.db.getRepository(UserEntity).findOneByOrFail({ id: consumedUser.id }))
        .passwordHash,
      consumedHashBefore,
    );
    assert.equal(
      (
        await fixture.db
          .getRepository(AuthSessionEntity)
          .findOneByOrFail({ id: consumedSession.id })
      ).revokedAt,
      null,
    );

    const [commands] = await fixture.db.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count
         FROM authorization_history_command
        WHERE operation='USER_PASSWORD_CHANGE'`,
    );
    assert.equal(commands?.count, 0, 'invalid codes must never record USER_PASSWORD_CHANGE');
    const [revisions] = await fixture.db.query<Array<{ count: number }>>(
      `SELECT count(*)::int AS count
         FROM authorization_history_revision
        WHERE epoch_id=$1`,
      [fixture.epochId],
    );
    assert.equal(revisions?.count, 0, 'invalid codes must never emit authority revisions');
    await fixture.assertEpochReady('after wrong/expired/consumed reset codes');
    assert.equal(fetchCalls, 0);
  } finally {
    await fixture.dispose();
  }
});

test('concurrent confirmReset replay commits exactly one witnessed USER_PASSWORD_CHANGE and keeps READY epoch', async (t) => {
  let fetchCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    fetchCalls += 1;
    throw new Error('Unexpected outbound network/email call');
  });
  const fixture = await setupReadyAuthorityFixture([
    { email: 'concurrent-reset@example.test', mustChangePassword: true },
  ]);
  try {
    const user = fixture.users[0]!;
    const session = await fixture.createActiveSession(user.id);
    await fixture.service.requestReset(user.email!);
    const code = await fixture.readLatestResetCode(user.id);

    const passwordA = 'ConcurrentWinnerA9!';
    const passwordB = 'ConcurrentWinnerB9!';
    const outcomes = await Promise.allSettled([
      fixture.service.confirmReset(user.username, code, passwordA),
      fixture.service.confirmReset(user.email!, code, passwordB),
    ]);

    const fulfilled = outcomes.filter((item) => item.status === 'fulfilled');
    const rejected = outcomes.filter((item) => item.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'exactly one concurrent confirmReset must succeed');
    assert.equal(rejected.length, 1, 'second concurrent confirmReset must fail closed');
    assert.equal((rejected[0]!.reason as { getStatus?: () => number }).getStatus?.(), 400);

    const updated = await fixture.db.getRepository(UserEntity).findOneByOrFail({ id: user.id });
    assert.equal(updated.mustChangePassword, false);
    const winningPassword = outcomes[0]!.status === 'fulfilled' ? passwordA : passwordB;
    const losingPassword = outcomes[0]!.status === 'fulfilled' ? passwordB : passwordA;
    assert.equal(await verifyPassword(winningPassword, updated.passwordHash), true);
    assert.equal(await verifyPassword(losingPassword, updated.passwordHash), false);
    assert.ok(
      (await fixture.db.getRepository(AuthSessionEntity).findOneByOrFail({ id: session.id }))
        .revokedAt,
    );

    const commands = await fixture.db.query<Array<{ command_id: string; witnessed: boolean }>>(
      `SELECT c.command_id,
              EXISTS(
                SELECT 1 FROM authorization_history_commit_receipt w
                 WHERE w.command_id=c.command_id AND w.transaction_id=c.transaction_id
              ) AS witnessed
         FROM authorization_history_command c
        WHERE c.actor_user_id=$1 AND c.operation='USER_PASSWORD_CHANGE'`,
      [user.id],
    );
    assert.equal(commands.length, 1, 'concurrent replay must emit exactly one canonical command');
    assert.equal(commands[0]!.witnessed, true);

    const revisions = await fixture.db.query<Array<{ command_id: string | null }>>(
      `SELECT command_id
         FROM authorization_history_revision
        WHERE source_kind='USER_ACCOUNT' AND source_id=$1 AND epoch_id=$2`,
      [user.id, fixture.epochId],
    );
    assert.equal(revisions.length, 1);
    assert.equal(revisions[0]!.command_id, commands[0]!.command_id);

    await fixture.assertEpochReady('after concurrent confirmReset replay');
    assert.equal(fetchCalls, 0);
  } finally {
    await fixture.dispose();
  }
});
