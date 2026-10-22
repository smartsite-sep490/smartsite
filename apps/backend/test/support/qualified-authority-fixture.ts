import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from './isolated-test-database.js';
import { createTestConfig } from './config.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthorizationHistoryCutover1793232000000 } from '../../src/database/migrations/1793232000000-AuthorizationHistoryCutover.js';
import { MainAuthorityCutoverService } from '../../src/modules/zones/main-authority-cutover.service.js';
import {
  MAIN_AUTHORITY_CUTOVER_RELEASE_FILES,
  MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES,
} from '../../src/modules/zones/main-authority-cutover-release.js';
import { MainQualifiedAuthorityReader } from '../../src/modules/zones/main-qualified-authority.reader.js';
const sha256 = (body: Buffer | string) => createHash('sha256').update(body).digest('hex');

/** One owned canonical schema and explicitly synthetic release; never an operational manifest. */
export async function createQualifiedAuthorityFixture() {
  const owned = createIsolatedTestDatabase({ preAuthorityCutover72: true }),
    db = owned.dataSource;
  const schema = (db.options as { schema: string }).schema;
  console.log('ownedQualifiedAuthorityReaderSchema=' + schema);
  try {
    await owned.initialize();

    const runner = db.createQueryRunner();
    try {
      await runner.startTransaction();
      await new AuthorizationHistoryCutover1793232000000().up(runner);
      await runner.commitTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    const actor = randomUUID();
    const subject = randomUUID();
    const siteId = randomUUID();
    const zoneId = randomUUID();
    const password = 'Synthetic-Qualified-Reader-123!';
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,'SYNTHETIC-READER-SITE','Synthetic Reader Site')",
      [siteId],
    );
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Reader Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
      [zoneId, siteId],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin',$2,false)",
      [actor, await hashPassword(password)],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL),($3,$2,'SAFETY_OFFICER',$4)",
      [randomUUID(), actor, randomUUID(), siteId],
    );
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic history subject','synthetic-unusable-hash',false)",
      [subject],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
    const guard = new UserAuthGuard(auth);
    const login = await auth.login(actor, password, AuthClientType.WEB);
    const request = { headers: { authorization: `Bearer ${login.accessToken}` } };
    await guard.authenticateRequest(request);

    const fixturePath = await mkdtemp('D:/Ky9-FPT/SmartSiteData/runs/qualified-reader-synthetic-');
    const sourceRoot = process.env.CUTOVER_TEST_SOURCE_ROOT;
    assert(sourceRoot, 'Explicit current source root is required');
    const files = [];
    for (const path of MAIN_AUTHORITY_CUTOVER_RELEASE_FILES) {
      const target = resolve(fixturePath, path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(sourceRoot, path), target);
      files.push({ path, sha256: sha256(await readFile(target)) });
    }
    const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
    const runtimeFiles = [];
    for (const path of MAIN_AUTHORITY_CUTOVER_RUNTIME_FILES) {
      runtimeFiles.push({ path, sha256: sha256(await readFile(resolve(runtimeRoot, path))) });
    }
    const [registry] = await db.query(
      `SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(s) ORDER BY s.source_kind COLLATE "C")::text,'UTF8')),'hex') AS hash FROM authorization_history_source s`,
    );
    const manifest = {
      version: 'MF06_REVIEWED_CUTOVER_RELEASE_V1',
      releaseCommit: 'a'.repeat(40),
      captureProfile: 'NAMED_V2_CONTROLLED_CUTOVER_V1',
      provenance: 'SYNTHETIC_TEST',
      sourceRegistryHash: registry.hash,
      files,
      runtimeFiles,
      writerReview: {
        protocol: 'PINNED_AUTHORITY_SOURCE_REVIEW_RECONCILIATION_V1',
        sourceIndexSha256: 'b'.repeat(64),
        methods: 1,
        files: 1,
        exactQuotesAndSourcePinsVerified: true,
        missingOrDuplicateMethods: false,
        completeWriterClosureEstablished: true,
        rows: [
          {
            file: 'modules/auth/auth.service.ts',
            method: 'syntheticFixtureOnly',
            fileSha256: files.find((file) => file.path.endsWith('/auth.service.ts'))!.sha256,
            methodBodySha256: 'c'.repeat(64),
            classification: 'MASKED_COMMAND',
          },
        ],
      },
    };
    const manifestPath = join(fixturePath, 'SYNTHETIC-NOT-OPERATIONAL-manifest.json');
    const bytes = JSON.stringify(manifest);
    await writeFile(manifestPath, bytes, { flag: 'wx' });
    const config = {
      manifestPath,
      reviewedManifestSha256: sha256(bytes),
      releaseRoot: fixturePath,
      releaseCommit: 'a'.repeat(40),
    };
    const cutover = new MainAuthorityCutoverService(db, guard, config, createTestConfig());
    const reader = new MainQualifiedAuthorityReader(db, config, createTestConfig());
    return {
      db,
      schema,
      actor,
      subject,
      siteId,
      zoneId,
      request,
      guard,
      config,
      cutover,
      reader,
      manifest,
      fixturePath,
      dispose: owned.dispose,
    };
  } catch (error) {
    await owned.dispose();
    throw error;
  }
}
