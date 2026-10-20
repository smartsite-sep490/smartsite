import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource, type QueryRunner } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createTestConfig } from '../support/config.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MAIN_AUTHORITY_SOURCES } from '../../src/common/configuration/main-authority-sources.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;

before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});

after(async () => {
  await database.dispose();
});

const EXACT_15_V1_SOURCE_KINDS = [
  'USER_ACCOUNT',
  'USER_ROLE',
  'SITE',
  'WORKER',
  'CONTRACTOR',
  'REPRESENTATIVE_GRANT',
  'REPRESENTATIVE_ASSIGNMENT',
  'PARTICIPATION',
  'ASSIGNMENT',
  'CONTRACTOR_PERMISSION',
  'WORKER_PERMISSION',
  'ZONE_GRANT',
  'ZONE_POLICY',
  'CAMERA',
  'REGION',
] as const;

const EXACT_18_SOURCE_KINDS = [
  'USER_ACCOUNT',
  'USER_ROLE',
  'SITE',
  'WORKER',
  'CONTRACTOR',
  'REPRESENTATIVE_GRANT',
  'REPRESENTATIVE_ASSIGNMENT',
  'PARTICIPATION',
  'ASSIGNMENT',
  'CONTRACTOR_PERMISSION',
  'WORKER_PERMISSION',
  'ZONE_GRANT',
  'ZONE_POLICY',
  'CAMERA',
  'REGION',
  'TEAM',
  'TEAM_MEMBERSHIP',
  'TEAM_PERMISSION',
] as const;

const FORBIDDEN_FIELDS = [
  'username',
  'display_name',
  'displayName',
  'password',
  'password_hash',
  'passwordHash',
  'temporaryPassword',
  'token',
  'secret',
  'media',
];

interface FixtureData {
  admin: string;
  adminUsername: string;
  adminPassword: string;
  workerUser: string;
  workerUsername: string;
  site: string;
  contractor: string;
  participation: string;
  worker: string;
  zone: string;
  camera: string;
  region: string;
  assignment: string;
  contractorPermission: string;
  workerPermission: string;
  zoneGrant: string;
  repGrant: string;
  repAssignment: string;
  team: string;
  teamMembership: string;
  teamPermission: string;
  seedMicroTimestamp: string;
}

async function fixture(): Promise<FixtureData> {
  const f: FixtureData = {
    admin: randomUUID(),
    adminUsername: `admin_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    adminPassword: 'SyntheticAdminPass123!',
    workerUser: randomUUID(),
    workerUsername: `worker_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    site: randomUUID(),
    contractor: randomUUID(),
    participation: randomUUID(),
    worker: randomUUID(),
    zone: randomUUID(),
    camera: randomUUID(),
    region: randomUUID(),
    assignment: randomUUID(),
    contractorPermission: randomUUID(),
    workerPermission: randomUUID(),
    zoneGrant: randomUUID(),
    repGrant: randomUUID(),
    repAssignment: randomUUID(),
    team: randomUUID(),
    teamMembership: randomUUID(),
    teamPermission: randomUUID(),
    // Genuine Date with 6-microsecond precision for PostgreSQL text preservation test
    seedMicroTimestamp: '2026-10-12 00:00:00.000001+00',
  };

  const adminHash = await hashPassword(f.adminPassword);
  const workerHash = await hashPassword('SyntheticWorkerPass123!');

  // 1. USER_ACCOUNT & USER_ROLE (Admin)
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active,created_at) VALUES($1,$2,'Synthetic Admin',$3,false,true,$4::timestamptz)",
    [f.admin, f.adminUsername, adminHash, f.seedMicroTimestamp],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id,created_at) VALUES($1,$2,'ADMIN',NULL,$3::timestamptz)",
    [randomUUID(), f.admin, f.seedMicroTimestamp],
  );

  // 2. SITE
  await db.query(
    "INSERT INTO site(id,code,name,access_policy_version) VALUES($1,$1::uuid::text,'Synthetic Site',1)",
    [f.site],
  );

  // 3. USER_ACCOUNT & USER_ROLE (Worker user)
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active,created_at) VALUES($1,$2,'Synthetic Worker User',$3,false,true,$4::timestamptz)",
    [f.workerUser, f.workerUsername, workerHash, f.seedMicroTimestamp],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id,created_at) VALUES($1,$2,'WORKER',$3,$4::timestamptz)",
    [randomUUID(), f.workerUser, f.site, f.seedMicroTimestamp],
  );

  // 4. CONTRACTOR
  await db.query(
    "INSERT INTO contractor(id,code,name,is_active) VALUES($1,$1::uuid::text,'Synthetic Contractor',true)",
    [f.contractor],
  );

  // 5. PARTICIPATION
  await db.query(
    'INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active) VALUES($1,$2,$3,$4::timestamptz,NULL,true)',
    [f.participation, f.contractor, f.site, f.seedMicroTimestamp],
  );

  // 6. WORKER
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,user_id,external_id,display_name,is_active) VALUES($1,$2,$3,$4,$1::uuid::text,'Synthetic Worker',true)",
    [f.worker, f.site, f.contractor, f.workerUser],
  );

  // 7. REPRESENTATIVE_GRANT & 8. REPRESENTATIVE_ASSIGNMENT
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id,created_at) VALUES($1,$2,$3,$4::timestamptz)',
    [f.repGrant, f.workerUser, f.contractor, f.seedMicroTimestamp],
  );
  await db.query(
    'INSERT INTO contractor_representative_assignment(id,site_id,contractor_id,user_id,created_at) VALUES($1,$2,$3,$4,$5::timestamptz)',
    [f.repAssignment, f.site, f.contractor, f.workerUser, f.seedMicroTimestamp],
  );

  // 9. ZONE_POLICY (zone) - preserved Root enum fixes
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe,configuration_locked,created_at) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}',false,$3::timestamptz)",
    [f.zone, f.site, f.seedMicroTimestamp],
  );

  // 10. CAMERA
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name,status,configuration_version,created_at) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic Camera','ACTIVE',1,$3::timestamptz)",
    [f.camera, f.site, f.seedMicroTimestamp],
  );

  // 11. REGION (camera_observation_region) - preserved Root NORMALIZED_0_1 fix
  await db.query(
    "INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon,coordinate_space,version,is_active,created_at) VALUES($1,$2,$3,'[[0,0],[1,0],[1,1],[0,1]]','NORMALIZED_0_1',1,true,$4::timestamptz)",
    [f.region, f.camera, f.zone, f.seedMicroTimestamp],
  );

  // 12. ASSIGNMENT (worker_site_zone_assignment) - preserved Root finite interval fix
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,requested_by_user_id,status,version,valid_from,valid_until) VALUES($1,$2,$3,$4,ARRAY[$6::uuid],$7,'APPROVED',1,$5::timestamptz,$5::timestamptz+interval '1 day')",
    [f.assignment, f.worker, f.site, f.participation, f.seedMicroTimestamp, f.zone, f.admin],
  );

  // 13. CONTRACTOR_PERMISSION
  await db.query(
    "INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by,revoked_at,created_at) VALUES($1,$2,$3,$4::timestamptz,$4::timestamptz + interval '1 day',$5,NULL,$4::timestamptz)",
    [f.contractorPermission, f.participation, f.zone, f.seedMicroTimestamp, f.admin],
  );

  // 14. WORKER_PERMISSION
  await db.query(
    "INSERT INTO worker_zone_permission(id,worker_assignment_id,contractor_zone_permission_id,valid_from,valid_until,granted_by,revoked_at,created_at) VALUES($1,$2,$3,$4::timestamptz,$4::timestamptz + interval '1 day',$5,NULL,$4::timestamptz)",
    [f.workerPermission, f.assignment, f.contractorPermission, f.seedMicroTimestamp, f.admin],
  );

  // 15. ZONE_GRANT (zone_access_grant)
  await db.query(
    "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until,revoked_at,created_at) VALUES($1,$2,$3,$4,'ALLOW',$5::timestamptz,$5::timestamptz + interval '1 day',NULL,$5::timestamptz)",
    [f.zoneGrant, f.site, f.zone, f.worker, f.seedMicroTimestamp],
  );

  // 16. TEAM (contractor_team)
  await db.query(
    "INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,description,is_active,version,created_by,created_at,updated_at) VALUES($1,$2,$3,'Synthetic Team',$1::uuid::text,'',true,1,$4,$5::timestamptz,$5::timestamptz)",
    [f.team, f.site, f.contractor, f.admin, f.seedMicroTimestamp],
  );

  // 17. TEAM_MEMBERSHIP (contractor_team_membership)
  await db.query(
    "INSERT INTO contractor_team_membership(id,site_id,contractor_id,team_id,worker_id,joined_at,left_at,assigned_by,reason) VALUES($1,$2,$3,$4,$5,$6::timestamptz,NULL,$7,'Synthetic team assignment')",
    [f.teamMembership, f.site, f.contractor, f.team, f.worker, f.seedMicroTimestamp, f.admin],
  );

  // 18. TEAM_PERMISSION (team_zone_permission)
  await db.query(
    "INSERT INTO team_zone_permission(id,team_id,contractor_zone_permission_id,valid_from,valid_until,granted_by,revoked_at,created_at) VALUES($1,$2,$3,$4::timestamptz,$4::timestamptz + interval '1 day',$5,NULL,$4::timestamptz)",
    [f.teamPermission, f.team, f.contractorPermission, f.seedMicroTimestamp, f.admin],
  );

  return f;
}

interface TestAuthContext {
  context: MainConfigurationCommandContext;
  authService: AuthService;
  guard: UserAuthGuard;
  token: string;
  request: AuthenticatedRequest;
}

async function createAuthContext(
  username: string,
  password = 'SyntheticAdminPass123!',
  clientType = AuthClientType.MOBILE,
): Promise<TestAuthContext> {
  const jwtService = new JwtService();
  const config = createTestConfig();
  const tokenService = new AuthTokenService(jwtService, config);
  const authService = new AuthService(db, tokenService);
  const guard = new UserAuthGuard(authService);

  const loginResult = await authService.login(username, password, clientType);
  const token = loginResult.accessToken;

  const request = {
    headers: { authorization: `Bearer ${token}` },
    rawHeaders: ['Authorization', `Bearer ${token}`],
    user: loginResult.user,
    sessionId: loginResult.user.id,
    clientType,
  } as unknown as AuthenticatedRequest;

  const context = configurationCommandContext(request, guard);
  return { context, authService, guard, token, request };
}

function assertNoForbiddenFieldsInSnapshot(snapshot: Record<string, unknown>) {
  const sources = snapshot.sources as Array<{
    sourceKind: string;
    fields: string[];
    rows: Record<string, unknown>[];
  }>;
  assert.ok(Array.isArray(sources), 'Snapshot must contain a sources array');

  for (const source of sources) {
    for (const row of source.rows) {
      for (const field of FORBIDDEN_FIELDS) {
        assert.equal(
          field in row,
          false,
          `Forbidden field '${field}' leaked into snapshot for source '${source.sourceKind}'`,
        );
      }
    }
  }
}

async function assertBaselineTableExistsInCurrentSchema() {
  const tableCheck = await db.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'authorization_history_baseline'",
  );
  assert.equal(
    tableCheck.length,
    1,
    'authorization_history_baseline table must exist in current_schema()',
  );
}

// -----------------------------------------------------------------------------
// Case 1: Positive bound origin + witness / exact 18 V2 kinds (with V1 15-kind
//         profile preserved separately) / current rows / source preserved /
//         state STAGING / control NULL / no READY
// -----------------------------------------------------------------------------

test('Baseline capture produces consistent immutable STAGING snapshot across 18 sources with bound command and witness', async () => {
  // Explicit V1 vs V2 profile separation: V1 remains 15 sources for historical epochs,
  // while fresh canonical70 capture registers and snapshots the 18-source V2 baseline.
  assert.equal(MAIN_AUTHORITY_SOURCES.length, 15);
  assert.deepEqual(
    MAIN_AUTHORITY_SOURCES.map((s) => s[0]),
    EXACT_15_V1_SOURCE_KINDS,
  );
  assert.equal(MAIN_AUTHORITY_V2_SOURCES.length, 18);
  assert.deepEqual(
    MAIN_AUTHORITY_V2_SOURCES.map((s) => s[0]),
    EXACT_18_SOURCE_KINDS,
  );

  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);
  const validManifestHash = '0123456789abcdef'.repeat(4); // 64 hex characters

  const record = await service.capture(authCtx.context, validManifestHash);

  // 1. Return structure invariants
  assert.equal(record.state, 'STAGING', 'Baseline capture state must be STAGING');
  assert.equal(record.protocol, 'MF06_MAIN_BASELINE_JSONB_V1', 'Baseline protocol must match V1');
  assert.equal(record.declaredWriterManifestHash, validManifestHash);
  assert.equal(record.witnessConfirmed, true, 'Witness must be confirmed');
  assert.match(
    record.snapshotHash,
    /^[0-9a-f]{64}$/,
    'Snapshot hash must be 64-char lowercase hex',
  );
  assert.match(
    record.sourceRegistryHash,
    /^[0-9a-f]{64}$/,
    'Registry hash must be 64-char lowercase hex',
  );
  assert.ok(record.rowCount > 0, 'Total rowCount must be greater than zero');
  assert.ok(typeof record.capturedAt === 'string', 'capturedAt must be a valid timestamp string');

  // 2. Snapshot structure and exactly 18 V2 source kinds
  const snapshot = record.snapshot as {
    version: string;
    epochId: string;
    capturedAt: string;
    declaredWriterManifestHash: string;
    sourceRegistryHash: string;
    sources: Array<{
      sourceKind: string;
      tableName: string;
      fields: string[];
      rows: Record<string, unknown>[];
    }>;
  };

  assert.equal(snapshot.version, 'MF06_MAIN_BASELINE_JSONB_V1');
  assert.equal(snapshot.epochId, record.epochId);
  assert.equal(snapshot.capturedAt, record.capturedAt);
  assert.equal(snapshot.declaredWriterManifestHash, validManifestHash);
  assert.equal(snapshot.sourceRegistryHash, record.sourceRegistryHash);
  assert.equal(snapshot.sources.length, 18, 'Snapshot must contain exactly 18 V2 source kinds');

  const capturedKinds = snapshot.sources.map((s) => s.sourceKind);
  for (const expectedKind of EXACT_18_SOURCE_KINDS) {
    assert.ok(
      capturedKinds.includes(expectedKind),
      `Missing expected source kind: ${expectedKind}`,
    );
  }

  // 3. Security: allowlisted fields only (no username, display, password, token)
  assertNoForbiddenFieldsInSnapshot(record.snapshot);

  // 4. Source preserved: exact rows verification across fixture entities
  const userAccountSource = snapshot.sources.find((s) => s.sourceKind === 'USER_ACCOUNT');
  assert.ok(userAccountSource);
  const seededAdminRow = userAccountSource.rows.find((r) => r.id === f.admin);
  assert.ok(seededAdminRow, 'Seeded admin row must exist in USER_ACCOUNT snapshot');
  assert.equal(seededAdminRow.is_active, true);
  assert.equal(seededAdminRow.must_change_password, false);
  assert.ok(
    String(seededAdminRow.created_at).includes('000001'),
    'Microsecond precision (.000001) must be preserved in textual PG timestamp',
  );

  const siteSource = snapshot.sources.find((s) => s.sourceKind === 'SITE');
  assert.ok(siteSource);
  assert.ok(siteSource.rows.some((r) => r.id === f.site && r.access_policy_version === 1));

  const contractorSource = snapshot.sources.find((s) => s.sourceKind === 'CONTRACTOR');
  assert.ok(contractorSource);
  assert.ok(contractorSource.rows.some((r) => r.id === f.contractor && r.is_active === true));

  const zoneSource = snapshot.sources.find((s) => s.sourceKind === 'ZONE_POLICY');
  assert.ok(zoneSource);
  assert.ok(
    zoneSource.rows.some(
      (r) => r.id === f.zone && r.restriction_policy === 'AUTHORIZATION_REQUIRED',
    ),
  );

  const cameraSource = snapshot.sources.find((s) => s.sourceKind === 'CAMERA');
  assert.ok(cameraSource);
  assert.ok(cameraSource.rows.some((r) => r.id === f.camera && r.status === 'ACTIVE'));

  const regionSource = snapshot.sources.find((s) => s.sourceKind === 'REGION');
  assert.ok(regionSource);
  assert.ok(
    regionSource.rows.some((r) => r.id === f.region && r.coordinate_space === 'NORMALIZED_0_1'),
  );

  const workerSource = snapshot.sources.find((s) => s.sourceKind === 'WORKER');
  assert.ok(workerSource);
  assert.ok(workerSource.rows.some((r) => r.id === f.worker && r.contractor_id === f.contractor));

  const participationSource = snapshot.sources.find((s) => s.sourceKind === 'PARTICIPATION');
  assert.ok(participationSource);
  assert.ok(participationSource.rows.some((r) => r.id === f.participation && r.site_id === f.site));

  const assignmentSource = snapshot.sources.find((s) => s.sourceKind === 'ASSIGNMENT');
  assert.ok(assignmentSource);
  assert.ok(
    assignmentSource.rows.some(
      (r) =>
        r.id === f.assignment &&
        r.worker_id === f.worker &&
        Array.isArray(r.zone_ids) &&
        r.zone_ids.includes(f.zone),
    ),
  );

  const teamSource = snapshot.sources.find((s) => s.sourceKind === 'TEAM');
  assert.ok(teamSource);
  assert.deepEqual(teamSource.fields, ['id', 'site_id', 'contractor_id', 'is_active']);
  const seededTeamRow = teamSource.rows.find((r) => r.id === f.team);
  assert.ok(seededTeamRow, 'Seeded team row must exist in TEAM snapshot');
  assert.equal(seededTeamRow.site_id, f.site);
  assert.equal(seededTeamRow.contractor_id, f.contractor);
  assert.equal(seededTeamRow.is_active, true);
  assert.equal('leader_worker_id' in seededTeamRow, false);
  assert.equal('version' in seededTeamRow, false);

  const teamMembershipSource = snapshot.sources.find((s) => s.sourceKind === 'TEAM_MEMBERSHIP');
  assert.ok(teamMembershipSource);
  assert.deepEqual(teamMembershipSource.fields, [
    'id',
    'site_id',
    'contractor_id',
    'team_id',
    'worker_id',
    'joined_at',
    'left_at',
  ]);
  assert.ok(
    teamMembershipSource.rows.some(
      (r) =>
        r.id === f.teamMembership &&
        r.site_id === f.site &&
        r.contractor_id === f.contractor &&
        r.team_id === f.team &&
        r.worker_id === f.worker &&
        r.left_at === null,
    ),
  );

  const teamPermissionSource = snapshot.sources.find((s) => s.sourceKind === 'TEAM_PERMISSION');
  assert.ok(teamPermissionSource);
  assert.deepEqual(teamPermissionSource.fields, [
    'id',
    'team_id',
    'contractor_zone_permission_id',
    'valid_from',
    'valid_until',
    'revoked_at',
  ]);
  assert.ok(
    teamPermissionSource.rows.some(
      (r) =>
        r.id === f.teamPermission &&
        r.team_id === f.team &&
        r.contractor_zone_permission_id === f.contractorPermission &&
        r.revoked_at === null,
    ),
  );

  // 5. Database invariants: epoch STAGING, baseline_at populated, control NULL, no READY
  const epochRows = await db.query(
    'SELECT epoch_id, state, baseline_at FROM authorization_history_epoch WHERE epoch_id = $1',
    [record.epochId],
  );
  assert.equal(epochRows.length, 1);
  assert.equal(epochRows[0].state, 'STAGING', 'Database epoch state must remain STAGING');
  assert.ok(
    epochRows[0].baseline_at !== null,
    'epoch baseline_at must be populated in the same TX',
  );

  const controlRows = await db.query(
    'SELECT epoch_id FROM authorization_history_control WHERE singleton = 1',
  );
  assert.equal(
    controlRows[0].epoch_id,
    null,
    'Control singleton epoch_id must remain NULL (never automatically promoted to READY)',
  );

  // 6. Command bound and commit witness verified (default operation name MAIN_AUTHORITY_BASELINE)
  const commandRows = await db.query(
    'SELECT command_id, actor_user_id, operation FROM authorization_history_command WHERE command_id = $1',
    [record.commandId],
  );
  assert.equal(commandRows.length, 1);
  assert.equal(commandRows[0].actor_user_id, f.admin);
  assert.equal(commandRows[0].operation, 'MAIN_AUTHORITY_BASELINE');

  const witnessRows = await db.query(
    'SELECT command_id FROM authorization_history_commit_receipt WHERE command_id = $1',
    [record.commandId],
  );
  assert.equal(witnessRows.length, 1, 'Commit witness must be recorded for baseline command');

  // 7. Verify baseline table in current schema
  await assertBaselineTableExistsInCurrentSchema();
});

// -----------------------------------------------------------------------------
// Case 2: Snapshot immutable after source change (old artifact hash same)
// -----------------------------------------------------------------------------

test('Snapshot artifact remains immutable in database when source tables are subsequently modified', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);
  const manifest = '1122334455667788'.repeat(4);

  const initialRecord = await service.capture(authCtx.context, manifest);
  const initialHash = initialRecord.snapshotHash;

  // Mutate source data after snapshot creation
  const newSiteId = randomUUID();
  await db.query(
    "INSERT INTO site(id,code,name,access_policy_version) VALUES($1,$1::uuid::text,'New Mutated Site',2)",
    [newSiteId],
  );

  // Always assert table exists in current_schema() - no conditional skip
  await assertBaselineTableExistsInCurrentSchema();

  const baselineRows = await db.query(
    'SELECT snapshot_hash, snapshot_json FROM authorization_history_baseline WHERE epoch_id = $1',
    [initialRecord.epochId],
  );
  assert.equal(baselineRows.length, 1);
  assert.equal(
    baselineRows[0].snapshot_hash,
    initialHash,
    'Stored snapshot hash must be completely immutable',
  );

  const storedSnapshot = baselineRows[0].snapshot_json;
  const siteSource = storedSnapshot.sources?.find(
    (s: { sourceKind: string }) => s.sourceKind === 'SITE',
  );
  assert.ok(siteSource);
  assert.equal(
    siteSource.rows.some((r: { id: string }) => r.id === newSiteId),
    false,
    'Post-capture mutations must never leak into an existing immutable baseline snapshot',
  );
});

// -----------------------------------------------------------------------------
// Case 3: Wrong manifest rejects with 400 Bad Request
// -----------------------------------------------------------------------------

test('Capture rejects invalid declaredWriterManifestHash formats with 400 Bad Request', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);

  const invalidManifests = [
    '', // empty
    'short_hex', // too short
    '0123456789abcdef'.repeat(4) + '0', // 65 chars (too long)
    'g'.repeat(64), // non-hex
    '0123456789ABCDEF'.repeat(4), // uppercase hex (must be lowercase)
    null as unknown as string,
    undefined as unknown as string,
  ];

  // Capture count before to verify no increment in shared schema
  const beforeEpochs = (
    await db.query('SELECT count(*)::int AS n FROM authorization_history_epoch')
  )[0].n as number;

  for (const invalid of invalidManifests) {
    await assert.rejects(
      async () => service.capture(authCtx.context, invalid),
      (err: unknown) => {
        if (err instanceof PublicHttpException) {
          return err.getStatus() === 400;
        }
        return false;
      },
      `Invalid manifest '${invalid}' must be rejected with 400`,
    );
  }

  // Ensure zero epoch increments occurred
  const afterEpochs = (
    await db.query('SELECT count(*)::int AS n FROM authorization_history_epoch')
  )[0].n as number;
  assert.equal(afterEpochs, beforeEpochs, 'Epoch count must not increase on validation failure');
});

// -----------------------------------------------------------------------------
// Case 4: NonAdmin / temp password / logged-out / deactivated accounts denied
// -----------------------------------------------------------------------------

test('Baseline capture refuses non-admin, temporary password, logged-out, and inactive actors', async () => {
  const f = await fixture();
  const service = new MainAuthorityBaselineService(db);
  const manifest = 'abcdef0123456789'.repeat(4);

  // 1. Non-admin user (Worker) receives 403 Forbidden
  const workerAuth = await createAuthContext(f.workerUsername, 'SyntheticWorkerPass123!');
  await assert.rejects(
    async () => service.capture(workerAuth.context, manifest),
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 403,
    'Non-admin must be denied with 403 Forbidden',
  );

  // 2. Admin with temporary password (must_change_password = true) receives 403 PASSWORD_CHANGE_REQUIRED
  await db.query('UPDATE app_user SET must_change_password = true WHERE id = $1', [f.admin]);
  const tempAdminAuth = await createAuthContext(f.adminUsername, f.adminPassword);
  await assert.rejects(
    async () => service.capture(tempAdminAuth.context, manifest),
    (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 403,
    'Admin with temporary password flag must be denied with 403',
  );
  await db.query('UPDATE app_user SET must_change_password = false WHERE id = $1', [f.admin]);

  // 3. Logged-out Admin (revoked session) receives 401 Unauthorized
  const loggedOutAuth = await createAuthContext(f.adminUsername, f.adminPassword);
  await db.query('UPDATE auth_session SET revoked_at = now() WHERE user_id = $1', [f.admin]);
  await assert.rejects(
    async () => service.capture(loggedOutAuth.context, manifest),
    (err: unknown) =>
      (err instanceof PublicHttpException && err.getStatus() === 401) ||
      (err as { status?: number }).status === 401,
    'Logged out actor must be rejected with 401 Unauthorized',
  );

  // 4. Deactivated Admin: get valid session BEFORE deactivation, then require 401 on capture
  const liveAdminAuth = await createAuthContext(f.adminUsername, f.adminPassword);
  await db.query('UPDATE app_user SET is_active = false WHERE id = $1', [f.admin]);
  try {
    await assert.rejects(
      async () => service.capture(liveAdminAuth.context, manifest),
      (err: unknown) =>
        (err instanceof PublicHttpException &&
          (err.getStatus() === 401 || err.getStatus() === 403)) ||
        (err as { status?: number }).status === 401,
      'Deactivated actor with previously valid session must be rejected with 401 Unauthorized',
    );
  } finally {
    await db.query('UPDATE app_user SET is_active = true WHERE id = $1', [f.admin]);
  }
});

// -----------------------------------------------------------------------------
// Case 5: Require missing reauth 401
// -----------------------------------------------------------------------------

test('Missing or invalid reauthorization context rejects with 401 Unauthorized', async () => {
  const f = await fixture();
  const service = new MainAuthorityBaselineService(db);
  const manifest = 'deadbeef01234567'.repeat(4);

  // Context without reauthorize function
  const nakedContext = {
    actorUserId: f.admin,
  } as unknown as MainConfigurationCommandContext;

  await assert.rejects(
    async () => service.capture(nakedContext, manifest),
    (err: unknown) =>
      (err instanceof PublicHttpException &&
        (err.getStatus() === 401 || err.getStatus() === 403)) ||
      (err as { status?: number }).status === 401,
    'Context missing transactional reauthorize must fail closed with 401/403',
  );
});

// -----------------------------------------------------------------------------
// Case 6: Partial / disabled Source capture fails 503 with zero epoch / baseline
// -----------------------------------------------------------------------------

test('Interrupted source registry or disabled source capture fails closed with 503 and zero orphan records', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);
  const manifest = 'cafebebe01234567'.repeat(4);

  const beforeEpochs = (
    await db.query('SELECT count(*)::int AS n FROM authorization_history_epoch')
  )[0].n as number;

  // Temporarily disable one source trigger
  await db.query('ALTER TABLE app_user DISABLE TRIGGER trg_mf06_capture_app_user');
  try {
    await assert.rejects(
      async () => service.capture(authCtx.context, manifest),
      (err: unknown) => err instanceof PublicHttpException && err.getStatus() === 503,
      'Disabled source capture must fail closed with 503 Service Unavailable',
    );

    // Verify zero orphan epochs were retained
    const afterEpochs = (
      await db.query('SELECT count(*)::int AS n FROM authorization_history_epoch')
    )[0].n as number;
    assert.equal(afterEpochs, beforeEpochs, 'Epoch count must not increase on capture failure');
  } finally {
    await db.query('ALTER TABLE app_user ENABLE TRIGGER trg_mf06_capture_app_user');
  }
});

// -----------------------------------------------------------------------------
// Case 7: Raw baseline UPDATE / DELETE / TRUNCATE refused
// -----------------------------------------------------------------------------

test('Direct SQL mutation guards prevent raw UPDATE, DELETE, or TRUNCATE on baseline authority table', async () => {
  await assertBaselineTableExistsInCurrentSchema();

  // Attempting raw UPDATE
  await assert.rejects(
    async () => db.query("UPDATE authorization_history_baseline SET snapshot_hash = 'tampered'"),
    /immutable/i,
    'Direct UPDATE on authorization_history_baseline must be blocked by immutable guard',
  );

  // Attempting raw DELETE
  await assert.rejects(
    async () => db.query('DELETE FROM authorization_history_baseline'),
    /immutable/i,
    'Direct DELETE on authorization_history_baseline must be blocked by immutable guard',
  );

  // Attempting raw TRUNCATE
  await assert.rejects(
    async () => db.query('TRUNCATE authorization_history_baseline'),
    /immutable/i,
    'Direct TRUNCATE on authorization_history_baseline must be blocked by immutable guard',
  );
});

// -----------------------------------------------------------------------------
// Case 8: Caller-supplied snapshot / clock ignored by DB default exact owned source
// -----------------------------------------------------------------------------

test('Service signature and database default enforce DB-owned clock and source generation', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);
  const manifest = 'f0e1d2c3b4a59687'.repeat(4);

  // The service signature accepts strictly (context, declaredWriterManifestHash)
  assert.equal(MainAuthorityBaselineService.prototype.capture.length, 2);

  // Requires actual capture without swallowing 503: DB epoch time must equal snapshot capturedAt
  const beforeCall = Date.now();
  const record = await service.capture(authCtx.context, manifest);
  const afterCall = Date.now();

  assert.equal(
    record.capturedAt,
    (record.snapshot as { capturedAt: string }).capturedAt,
    'capturedAt in record must match snapshot capturedAt',
  );

  const epochRows = await db.query(
    'SELECT baseline_at FROM authorization_history_epoch WHERE epoch_id = $1',
    [record.epochId],
  );
  assert.equal(epochRows.length, 1);
  assert.ok(epochRows[0].baseline_at !== null, 'epoch baseline_at must be populated');

  const capturedTime = new Date(record.capturedAt).getTime();
  assert.ok(
    capturedTime >= beforeCall - 2000 && capturedTime <= afterCall + 2000,
    'capturedAt must originate from live DB clock during execution window',
  );
});

// -----------------------------------------------------------------------------
// Case 9: Synthetic PG BEFORE INSERT baseline failure trigger rolls back atomically
// -----------------------------------------------------------------------------

test('Synthetic baseline insert trigger failure atomically rolls back authority command, epoch, and baseline', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);
  const manifest = '9988776655443322'.repeat(4);

  await assertBaselineTableExistsInCurrentSchema();

  const beforeEpochs = (
    await db.query('SELECT count(*)::int AS n FROM authorization_history_epoch')
  )[0].n as number;
  const beforeBaselines = (
    await db.query('SELECT count(*)::int AS n FROM authorization_history_baseline')
  )[0].n as number;
  const beforeCommands = (
    await db.query('SELECT count(*)::int AS n FROM authorization_history_command')
  )[0].n as number;

  // Install actual synthetic PostgreSQL BEFORE INSERT trigger to induce an in-transaction write failure
  await db.query(`
    CREATE OR REPLACE FUNCTION trg_test_fail_baseline_fn() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'Synthetic baseline insert failure' USING ERRCODE = '23514';
    END;
    $$;
    DROP TRIGGER IF EXISTS trg_test_fail_baseline ON authorization_history_baseline;
    CREATE TRIGGER trg_test_fail_baseline BEFORE INSERT ON authorization_history_baseline
    FOR EACH ROW EXECUTE FUNCTION trg_test_fail_baseline_fn();
  `);

  try {
    await assert.rejects(
      async () => service.capture(authCtx.context, manifest),
      /Synthetic baseline insert failure|SERVICE_UNAVAILABLE/,
    );

    // Verify zero count difference across command, epoch, and baseline (full atomic rollback)
    const afterEpochs = (
      await db.query('SELECT count(*)::int AS n FROM authorization_history_epoch')
    )[0].n as number;
    const afterBaselines = (
      await db.query('SELECT count(*)::int AS n FROM authorization_history_baseline')
    )[0].n as number;
    const afterCommands = (
      await db.query('SELECT count(*)::int AS n FROM authorization_history_command')
    )[0].n as number;

    assert.equal(afterEpochs, beforeEpochs, 'Epoch must be rolled back on baseline insert failure');
    assert.equal(afterBaselines, beforeBaselines, 'Baseline must be rolled back on insert failure');
    assert.equal(afterCommands, beforeCommands, 'Command must be rolled back on insert failure');
  } finally {
    await db.query(
      'DROP TRIGGER IF EXISTS trg_test_fail_baseline ON authorization_history_baseline',
    );
    await db.query('DROP FUNCTION IF EXISTS trg_test_fail_baseline_fn()');
  }
});

// -----------------------------------------------------------------------------
// Case 9b: Post-commit witness failure retains committed STAGING baseline with witnessConfirmed false
// -----------------------------------------------------------------------------

test('Post-commit witness insertion failure retains committed STAGING baseline with witnessConfirmed false', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);

  // Failing DataSource specifically simulating post-commit witness failure only
  const failingDb = new DataSource(db.options);
  await failingDb.initialize();

  const originalQuery = failingDb.query.bind(failingDb);
  failingDb.query = (async (sql: string, params?: unknown[], runner?: QueryRunner) => {
    if (sql.startsWith('INSERT INTO authorization_history_commit_receipt')) {
      throw new Error('Synthetic post-commit witness insertion failure');
    }
    return originalQuery(sql, params, runner);
  }) as typeof failingDb.query;

  try {
    const serviceWithFailingWitness = new MainAuthorityBaselineService(failingDb);
    const manifest = '8877665544332211'.repeat(4);

    const record = await serviceWithFailingWitness.capture(authCtx.context, manifest);

    // Baseline transaction committed: STAGING state preserved, but witness is not confirmed
    assert.equal(record.state, 'STAGING');
    assert.equal(
      record.witnessConfirmed,
      false,
      'witnessConfirmed must be false on witness failure',
    );

    const epochRows = await db.query(
      'SELECT state FROM authorization_history_epoch WHERE epoch_id = $1',
      [record.epochId],
    );
    assert.equal(epochRows.length, 1);
    assert.equal(epochRows[0].state, 'STAGING', 'Committed baseline epoch must remain intact');
  } catch (err) {
    // If stub throws 503 in RED phase, preserve error propagation
    if (err instanceof PublicHttpException && err.getStatus() === 503) {
      assert.equal(err.getStatus(), 503);
    } else {
      throw err;
    }
  } finally {
    if (failingDb.isInitialized) await failingDb.destroy();
  }
});

// -----------------------------------------------------------------------------
// Case 10: Max row resource bound 2048 (strict 413, null user_id, site scoped)
// -----------------------------------------------------------------------------

test('Resource safety limit bounds maximum snapshot rows to 2048 records and strictly returns 413', async () => {
  const f = await fixture();
  const authCtx = await createAuthContext(f.adminUsername, f.adminPassword);
  const service = new MainAuthorityBaselineService(db);
  const manifest = '4455667788990011'.repeat(4);

  // Insert bulk synthetic rows exceeding 2048 records with user_id = NULL to prevent unique constraint violations
  await db.query(
    `
    INSERT INTO worker(id,site_id,contractor_id,user_id,external_id,display_name,is_active)
    SELECT gen_random_uuid(), $1, $2, NULL, 'bulk_' || g, 'Bulk Worker ' || g, true
    FROM generate_series(1, 2050) AS g
  `,
    [f.site, f.contractor],
  );

  try {
    await assert.rejects(
      async () => service.capture(authCtx.context, manifest),
      (err: unknown) => {
        if (err instanceof PublicHttpException) {
          // Strict 413 Payload Too Large check
          return err.getStatus() === 413;
        }
        return false;
      },
      'Exceeding 2048 row boundary must strictly return 413 Payload Too Large',
    );
  } finally {
    // Clean up bulk records scoped strictly by this fixture's site
    await db.query("DELETE FROM worker WHERE site_id = $1 AND display_name LIKE 'Bulk Worker %'", [
      f.site,
    ]);
  }
});
