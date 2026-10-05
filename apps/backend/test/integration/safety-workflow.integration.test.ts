import { Mf08SafetyWorkflow1791000000000 } from '../../src/database/migrations/1791000000000-Mf08SafetyWorkflow.js';
import { mkdtemp, rm, readdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { DurableGroupingService } from '../../src/modules/safety/alerts/durable-grouping.service.js';
import { AuthSessionEntity } from '../../src/database/entities/index.js';
import { DataSource, In } from 'typeorm';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
  SiteEntity,
  SafetyAlertEntity,
  AlertStatus,
  AlertType,
  SafetyWorkflowAuditEntity,
  CorrectiveActionSubmissionEntity,
} from '../../src/database/entities/index.js';
import { SafetyWorkflowService } from '../../src/modules/safety/safety-workflow.service.js';
import { SafetyUploadService } from '../../src/modules/safety/safety-upload.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { ZoneConfigurationService } from '../../src/modules/zones/zone-configuration.service.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import dataSource from '../support/test-data-source.js';
const fixtureSites: string[] = [],
  fixtureUsers: string[] = [];
const passwordHash = hashPassword('Mf08Test123!');
after(async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  // Dedicated ephemeral test DB only: TRUNCATE bypasses append-only history for fixture cleanup.
  await dataSource.query(
    'TRUNCATE safety_workflow_audit, safety_task, corrective_action_submission, corrective_action, safety_evidence, incident CASCADE',
  );
  await dataSource.getRepository(SafetyAlertEntity).delete({ siteId: In(fixtureSites) });
  await dataSource.getRepository(AuthSessionEntity).delete({ userId: In(fixtureUsers) });
  await dataSource.getRepository(UserRoleAssignmentEntity).delete({ userId: In(fixtureUsers) });
  await dataSource.getRepository(UserEntity).delete(fixtureUsers);
  await dataSource.getRepository(SiteEntity).delete(fixtureSites);
  await dataSource.destroy();
});
const failure = (code: string) => (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === code;

async function fixture() {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const site = randomUUID(),
    other = randomUUID();
  fixtureSites.push(site, other);
  await dataSource.getRepository(SiteEntity).save([
    { id: site, code: site, name: 'Synthetic A' },
    { id: other, code: other, name: 'Synthetic B' },
  ]);
  const users = new UsersService(dataSource, new SiteConfigurationService(dataSource));
  const ids: Record<string, string> = {};
  for (const [name, roles, scope] of [
    ['safety', [UserRole.SAFETY_OFFICER], site],
    ['security', [UserRole.SECURITY_OFFICER], site],
    ['manager', [UserRole.SITE_MANAGER], site],
    ['outsider', [UserRole.SECURITY_OFFICER], other],
    ['multi', [UserRole.SAFETY_OFFICER, UserRole.SECURITY_OFFICER, UserRole.SITE_MANAGER], site],
    ['admin', [UserRole.ADMIN], null],
    ['none', [], site],
  ] as const) {
    const id = randomUUID();
    ids[name] = id;
    fixtureUsers.push(id);
    await dataSource.getRepository(UserEntity).save({
      id,
      username: id,
      displayName: name,
      passwordHash: await passwordHash,
      isActive: true,
      mustChangePassword: false,
    });
    for (const role of roles)
      await dataSource
        .getRepository(UserRoleAssignmentEntity)
        .save({ id: randomUUID(), userId: id, role, siteId: scope });
  }
  const zones = new ZoneConfigurationService(dataSource, new SiteConfigurationService(dataSource));
  const upload = new SafetyUploadService(new ConfigService({}));
  const service = new SafetyWorkflowService(dataSource, users, zones, upload);
  const alert = await dataSource.getRepository(SafetyAlertEntity).save({
    id: randomUUID(),
    siteId: site,
    zoneId: null,
    alertType: AlertType.PPE_VIOLATION,
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    groupingKey: randomUUID(),
    status: AlertStatus.CONFIRMED,
    firstDetectedAt: new Date(),
    lastDetectedAt: new Date(),
    candidateWorkerId: 'unverified-tracker',
    detectionCount: 1,
  });
  const create = {
    commandId: randomUUID(),
    title: 'Synthetic incident',
    description: 'Observed hazard',
    severity: 'HIGH' as const,
    occurredAt: new Date().toISOString(),
    alertIds: [alert.id],
  };
  return { site, other, ids, service, alert, create };
}
test('MF08 incident end-to-end: scoping, immutable history, replay, rejection, closure and reopening', async () => {
  const f = await fixture(),
    { site, ids, service, create } = f;
  const created = await service.createIncident(site, ids.safety!, create);
  const id = created.resource.id;
  assert.equal(created.resource.alerts[0]?.candidateWorkerId, 'unverified-tracker');
  assert.equal((await service.createIncident(site, ids.safety!, create)).replayed, true);
  await assert.rejects(
    service.createIncident(site, ids.safety!, { ...create, title: 'Different' }),
    failure('CONFLICT'),
  );
  await assert.rejects(
    service.createIncident(site, ids.safety!, { ...create, commandId: randomUUID() }),
    failure('CONFLICT'),
  );
  await assert.rejects(
    service.createIncident(site, ids.admin!, { ...create, commandId: randomUUID(), alertIds: [] }),
    failure('FORBIDDEN'),
  );
  await assert.rejects(service.getIncident(site, id, ids.outsider!), failure('FORBIDDEN'));
  await assert.rejects(service.getIncident(site, id, ids.none!), failure('FORBIDDEN'));
  await assert.rejects(
    service.incidentCommand(site, id, ids.safety!, 'close', {
      commandId: randomUUID(),
      expectedVersion: 1,
      reason: 'Done',
    }),
    failure('CONFLICT'),
  );
  let detail = (
    await service.incidentCommand(site, id, ids.safety!, 'assign', {
      commandId: randomUUID(),
      expectedVersion: 1,
      assignedTo: ids.security!,
      description: 'Install barrier',
    })
  ).resource;
  const action = detail.actions[0]!;
  await assert.rejects(
    service.incidentCommand(site, id, ids.safety!, 'assign', {
      commandId: randomUUID(),
      expectedVersion: detail.version,
      assignedTo: ids.outsider!,
      description: 'No',
    }),
    failure('FORBIDDEN'),
  );
  await assert.rejects(
    service.incidentCommand(
      site,
      id,
      ids.multi!,
      'start',
      { commandId: randomUUID(), expectedVersion: 1 },
      action.id,
    ),
    failure('FORBIDDEN'),
  );
  detail = (
    await service.incidentCommand(
      site,
      id,
      ids.security!,
      'start',
      { commandId: randomUUID(), expectedVersion: 1 },
      action.id,
    )
  ).resource;
  assert.equal(detail.actions[0]?.status, 'IN_PROGRESS');
  detail = (
    await service.incidentCommand(
      site,
      id,
      ids.security!,
      'submit',
      { commandId: randomUUID(), expectedVersion: 2, resultDescription: 'Barrier installed' },
      action.id,
    )
  ).resource;
  assert.equal(detail.actions[0]?.status, 'SUBMITTED');
  await assert.rejects(
    service.incidentCommand(
      site,
      id,
      ids.security!,
      'submit',
      { commandId: randomUUID(), expectedVersion: 3, resultDescription: 'Duplicate' },
      action.id,
    ),
    failure('CONFLICT'),
  );
  const submission = detail.actions[0]!.submissions[0]!;
  await assert.rejects(
    dataSource.getRepository(CorrectiveActionSubmissionEntity).save({
      id: randomUUID(),
      correctiveActionId: action.id,
      submittedBy: ids.security,
      resultDescription: 'Duplicate pending',
      evidenceId: null,
      submittedAt: new Date(),
      status: 'PENDING',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
    }),
  );
  await assert.rejects(
    dataSource.getRepository(CorrectiveActionSubmissionEntity).update(submission.id, {
      status: 'APPROVED',
      reviewedBy: ids.safety,
      reviewedAt: new Date(),
      reviewNote: null,
    }),
  );
  detail = (
    await service.incidentCommand(
      site,
      id,
      ids.safety!,
      'review',
      {
        commandId: randomUUID(),
        expectedVersion: 3,
        submissionId: submission.id,
        decision: 'REJECTED',
        reason: 'Incomplete',
      },
      action.id,
    )
  ).resource;
  assert.equal(detail.actions[0]?.status, 'IN_PROGRESS');
  detail = (
    await service.incidentCommand(
      site,
      id,
      ids.security!,
      'submit',
      { commandId: randomUUID(), expectedVersion: 4, resultDescription: 'Barrier repaired' },
      action.id,
    )
  ).resource;
  assert.equal(detail.actions[0]?.submissions.length, 2);
  const latest = detail.actions[0]!.submissions.find((s) => s.status === 'PENDING')!;
  detail = (
    await service.incidentCommand(
      site,
      id,
      ids.safety!,
      'review',
      {
        commandId: randomUUID(),
        expectedVersion: 5,
        submissionId: latest.id,
        decision: 'APPROVED',
        reason: 'Checked',
      },
      action.id,
    )
  ).resource;
  assert.equal(detail.status, 'VERIFIED');
  const closed = (
    await service.incidentCommand(site, id, ids.safety!, 'close', {
      commandId: randomUUID(),
      expectedVersion: detail.version,
      reason: 'All hazards fixed',
    })
  ).resource;
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.actions[0]?.status, 'CLOSED');
  const grouping = new DurableGroupingService(
    new ConfigService(validateEnvironment({ NODE_ENV: 'test' })),
  );
  const observed = await dataSource.transaction((manager) =>
    grouping.groupCandidate(
      manager,
      site,
      {
        alertType: 'PPE_VIOLATION',
        candidateSubtype: 'PPE_HARD_HAT_MISSING',
        groupingKey: f.alert.groupingKey,
        cameraId: randomUUID(),
        streamSessionId: randomUUID(),
        trackId: 1,
        details: {},
      },
      new Date(),
    ),
  );
  assert.notEqual(observed.id, f.alert.id);
  assert.equal(observed.status, AlertStatus.PENDING_REVIEW);
  const reopened = (
    await service.incidentCommand(site, id, ids.safety!, 'reopen', {
      commandId: randomUUID(),
      expectedVersion: closed.version,
      reason: 'New hazard',
      assignedTo: ids.security!,
      description: 'Fix new hazard',
    })
  ).resource;
  assert.equal(reopened.status, 'REOPENED');
  assert.equal(reopened.actions.length, 2);
  await assert.rejects(
    service.incidentCommand(site, id, ids.safety!, 'close', {
      commandId: randomUUID(),
      expectedVersion: reopened.version,
      reason: 'Cannot reuse old results',
    }),
    failure('CONFLICT'),
  );
  assert.ok(reopened.audit.some((a) => a.action === 'review' && a.reason === 'Incomplete'));
  await assert.rejects(
    dataSource
      .getRepository(CorrectiveActionSubmissionEntity)
      .update(submission.id, { reviewNote: 'edit history' }),
  );
  await assert.rejects(
    dataSource
      .getRepository(SafetyWorkflowAuditEntity)
      .update(reopened.audit[0]!.id, { reason: 'edit audit' }),
  );
  await dataSource.getRepository(UserEntity).update(ids.security!, { isActive: false });
  await assert.rejects(service.getIncident(site, id, ids.security!), failure('FORBIDDEN'));
});
test('MF08 SafetyTask remains separate, retains returned results and prevents self-verification', async () => {
  const { site, ids, service } = await fixture();
  const create = {
    commandId: randomUUID(),
    kind: 'SAFETY_PATROL' as const,
    assignedTo: ids.safety!,
    description: 'Inspect walkways',
  };
  let task = (await service.createTask(site, ids.manager!, create)).resource;
  await assert.rejects(
    service.createTask(site, ids.safety!, { ...create, commandId: randomUUID() }),
    failure('FORBIDDEN'),
  );
  await assert.rejects(service.getTask(site, task.id, ids.security!), failure('FORBIDDEN'));
  task = (
    await service.taskCommand(site, task.id, ids.safety!, 'start', {
      commandId: randomUUID(),
      expectedVersion: 1,
    })
  ).resource;
  task = (
    await service.taskCommand(site, task.id, ids.safety!, 'submit', {
      commandId: randomUUID(),
      expectedVersion: 2,
      resultDescription: 'Walkway checked',
    })
  ).resource;
  task = (
    await service.taskCommand(site, task.id, ids.manager!, 'return', {
      commandId: randomUUID(),
      expectedVersion: 3,
      reason: 'Check again',
    })
  ).resource;
  assert.equal(task.resultSummary, 'Walkway checked');
  task = (
    await service.taskCommand(site, task.id, ids.safety!, 'submit', {
      commandId: randomUUID(),
      expectedVersion: 4,
      resultDescription: 'Walkway rechecked',
    })
  ).resource;
  task = (
    await service.taskCommand(site, task.id, ids.manager!, 'verify', {
      commandId: randomUUID(),
      expectedVersion: 5,
      reason: 'Confirmed',
    })
  ).resource;
  assert.equal(task.status, 'VERIFIED');
  assert.equal(task.audit.filter((a) => a.action === 'submit').length, 2);
  await assert.rejects(
    service.taskCommand(site, task.id, ids.manager!, 'cancel', {
      commandId: randomUUID(),
      expectedVersion: 6,
      reason: 'Cancel',
    }),
    failure('CONFLICT'),
  );
  let self = (
    await service.createTask(site, ids.manager!, {
      ...create,
      commandId: randomUUID(),
      assignedTo: ids.multi!,
    })
  ).resource;
  self = (
    await service.taskCommand(site, self.id, ids.multi!, 'start', {
      commandId: randomUUID(),
      expectedVersion: 1,
    })
  ).resource;
  self = (
    await service.taskCommand(site, self.id, ids.multi!, 'submit', {
      commandId: randomUUID(),
      expectedVersion: 2,
      resultDescription: 'Done',
    })
  ).resource;
  await assert.rejects(
    service.taskCommand(site, self.id, ids.multi!, 'verify', {
      commandId: randomUUID(),
      expectedVersion: 3,
      reason: 'Self',
    }),
    failure('FORBIDDEN'),
  );
});
test('MF08 row locks admit only one concurrent version and alert linking rolls back fully', async () => {
  const { site, ids, service, create, alert } = await fixture();
  const manual = { ...create, commandId: randomUUID(), alertIds: [] };
  const incident = (await service.createIncident(site, ids.safety!, manual)).resource;
  const results = await Promise.allSettled(
    [1, 2].map((i) =>
      service.incidentCommand(site, incident.id, ids.safety!, 'assign', {
        commandId: randomUUID(),
        expectedVersion: 1,
        assignedTo: ids.security!,
        description: 'Action ' + i,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const second = (
    await service.createIncident(site, ids.safety!, { ...manual, commandId: randomUUID() })
  ).resource;
  await assert.rejects(
    service.incidentCommand(site, second.id, ids.safety!, 'link', {
      commandId: randomUUID(),
      expectedVersion: 1,
      alertIds: [alert.id, randomUUID()],
    }),
    failure('NOT_FOUND'),
  );
  assert.equal(
    (await dataSource.getRepository(SafetyAlertEntity).findOneByOrFail({ id: alert.id }))
      .incidentId,
    null,
  );
  const commands = [incident.id, second.id].map((id, i) =>
    service.incidentCommand(site, id, ids.safety!, 'link', {
      commandId: randomUUID(),
      expectedVersion: i ? 1 : 2,
      alertIds: [alert.id],
    }),
  );
  const links = await Promise.allSettled(commands);
  assert.equal(links.filter((r) => r.status === 'fulfilled').length, 1);
});

test('MF08 authenticated HTTP multipart, no-store, Site boundaries and file cleanup', async () => {
  const f = await fixture(),
    { site, other, ids, service } = f;
  const root = await mkdtemp(join(tmpdir(), 'mf08-http-'));
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    SAFETY_UPLOAD_LOCAL_ROOT: root,
    HTTP_RATE_LIMIT_LIMIT: '1000',
  });
  const config = new ConfigService<ReturnType<typeof validateEnvironment>, true>(environment);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(dataSource)
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const url = (await app.getUrl()) + '/api/v1';
  const post = (path: string, token: string, input: unknown) =>
    fetch(url + path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  const get = (path: string, token: string) =>
    fetch(url + path, { headers: { Authorization: 'Bearer ' + token } });
  const jpeg = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
  try {
    const password = 'Mf08Test123!';
    const tokens: Record<string, string> = {};
    for (const name of ['safety', 'security', 'outsider', 'admin']) {
      const response = await fetch(url + '/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ids[name], password, clientType: 'MOBILE' }),
      });
      assert.equal(response.status, 200);
      tokens[name] = (await response.json()).accessToken;
    }
    assert.equal((await get('/sites/' + site + '/incidents', tokens.outsider!)).status, 403);
    assert.equal(
      (await get('/sites/' + site + '/safety-assignees?role=SECURITY_OFFICER', tokens.safety!))
        .status,
      200,
    );
    assert.equal((await get('/users', tokens.safety!)).status, 403);
    const creation = await post('/sites/' + site + '/incidents', tokens.safety!, {
      ...f.create,
      alertIds: [],
    });
    assert.equal(creation.status, 201);
    const id = (await creation.json()).resource.id;
    const assigned = await post(
      '/sites/' + site + '/incidents/' + id + '/actions',
      tokens.safety!,
      {
        commandId: randomUUID(),
        expectedVersion: 1,
        assignedTo: ids.security,
        description: 'HTTP action',
      },
    );
    assert.equal(assigned.status, 201);
    const action = (await assigned.json()).resource.actions[0];
    const path = '/sites/' + site + '/incidents/' + id + '/actions/' + action.id;
    assert.equal(
      (
        await post(path + '/start', tokens.security!, {
          commandId: randomUUID(),
          expectedVersion: 1,
        })
      ).status,
      201,
    );
    const send = (bytes: Uint8Array, type: string, commandId = randomUUID()) => {
      const form = new FormData();
      form.set('commandId', commandId);
      form.set('expectedVersion', '2');
      form.set('resultDescription', 'Synthetic result');
      form.set('file', new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), 'synthetic.jpg');
      return fetch(url + path + '/submissions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + tokens.security },
        body: form,
      });
    };
    assert.equal((await send(jpeg, 'image/png')).status, 415);
    assert.equal((await send(Buffer.alloc(1048577), 'image/jpeg')).status, 413);
    const commandId = randomUUID(),
      submitted = await send(jpeg, 'image/jpeg', commandId);
    assert.equal(submitted.status, 201);
    const response = await submitted.json();
    assert.ok(submitted.headers.get('cache-control')?.includes('no-store'));
    assert.equal(JSON.stringify(response).includes('storageKey'), false);
    assert.equal((await send(jpeg, 'image/jpeg', commandId)).status, 201);
    assert.equal((await readdir(root)).length, 1);
    const evidenceId = response.resource.actions[0].submissions[0].evidence.id;
    const evidencePath = '/sites/' + site + '/incidents/' + id + '/evidence/' + evidenceId;
    assert.equal((await get(evidencePath, tokens.outsider!)).status, 403);
    assert.equal(
      (
        await get(
          '/sites/' + other + '/incidents/' + id + '/evidence/' + evidenceId,
          tokens.outsider!,
        )
      ).status,
      404,
    );
    const read = await get(evidencePath, tokens.security!);
    assert.equal(read.status, 200);
    assert.ok(read.headers.get('cache-control')?.includes('no-store'));
    assert.equal(read.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), jpeg);
    const files = await readdir(root);
    await unlink(join(root, files[0]!));
    assert.equal((await get(evidencePath, tokens.safety!)).status, 503);
    const draft = (
      await service.createIncident(site, ids.safety!, {
        ...f.create,
        commandId: randomUUID(),
        alertIds: [],
      })
    ).resource;
    const added = (
      await service.incidentCommand(site, draft.id, ids.safety!, 'assign', {
        commandId: randomUUID(),
        expectedVersion: 1,
        assignedTo: ids.security,
        description: 'Rollback upload',
      })
    ).resource;
    const next = added.actions[0]!;
    await service.incidentCommand(
      site,
      draft.id,
      ids.security!,
      'start',
      { commandId: randomUUID(), expectedVersion: 1 },
      next.id,
    );
    const store = module.get(SafetyUploadService),
      original = store.save.bind(store);
    store.save = async (file) => ({
      ...(await original(file)),
      sha256: 'invalid-hash-for-db-regression',
    });
    const configured = module.get(SafetyWorkflowService);
    await assert.rejects(
      configured.incidentCommand(
        site,
        draft.id,
        ids.security!,
        'submit',
        { commandId: randomUUID(), expectedVersion: 2, resultDescription: 'Rollback' },
        next.id,
        { buffer: jpeg, mimetype: 'image/jpeg', size: jpeg.length },
      ),
    );
    store.save = original;
    assert.equal((await readdir(root)).length, 0);
    assert.equal(
      await dataSource
        .getRepository(CorrectiveActionSubmissionEntity)
        .countBy({ correctiveActionId: next.id }),
      0,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('MF08 migration reverses and re-applies inside an isolated PostgreSQL transaction', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const migration = new Mf08SafetyWorkflow1791000000000();
    await migration.down(runner);
    assert.equal(
      (
        await runner.query(
          "SELECT count(*) AS n FROM information_schema.columns WHERE table_name='safety_alert' AND column_name='incident_id'",
        )
      )[0].n,
      '0',
    );
    await migration.up(runner);
    assert.equal(
      (
        await runner.query(
          "SELECT count(*) AS n FROM information_schema.columns WHERE table_name='safety_alert' AND column_name='incident_id'",
        )
      )[0].n,
      '1',
    );
    const indexes = await runner.query(
      "SELECT indexname FROM pg_indexes WHERE tablename='corrective_action_submission'",
    );
    assert.ok(
      indexes.some(
        (row: { indexname: string }) => row.indexname === 'uq_action_pending_submission',
      ),
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
});

test('MF08 retry after role removal filters a recorded snapshot to current own actions', async () => {
  const { site, ids, service, create } = await fixture();
  let incident = (await service.createIncident(site, ids.safety!, { ...create, alertIds: [] }))
    .resource;
  incident = (
    await service.incidentCommand(site, incident.id, ids.safety!, 'assign', {
      commandId: randomUUID(),
      expectedVersion: incident.version,
      assignedTo: ids.security,
      description: 'Other officer work',
    })
  ).resource;
  const otherAction = incident.actions[0]!;
  incident = (
    await service.incidentCommand(site, incident.id, ids.safety!, 'assign', {
      commandId: randomUUID(),
      expectedVersion: incident.version,
      assignedTo: ids.multi,
      description: 'Own work',
    })
  ).resource;
  const own = incident.actions.find((a) => a.assignedTo === ids.multi)!;
  await service.incidentCommand(
    site,
    incident.id,
    ids.security!,
    'start',
    { commandId: randomUUID(), expectedVersion: 1 },
    otherAction.id,
  );
  await service.incidentCommand(
    site,
    incident.id,
    ids.security!,
    'submit',
    {
      commandId: randomUUID(),
      expectedVersion: 2,
      resultDescription: 'Other officer private result',
    },
    otherAction.id,
  );
  const input = { commandId: randomUUID(), expectedVersion: 1 };
  const first = await service.incidentCommand(
    site,
    incident.id,
    ids.multi!,
    'start',
    input,
    own.id,
  );
  assert.equal(first.resource.actions.length, 2);
  await dataSource
    .getRepository(UserRoleAssignmentEntity)
    .delete({ userId: ids.multi, role: In([UserRole.SAFETY_OFFICER, UserRole.SITE_MANAGER]) });
  const replay = await service.incidentCommand(
    site,
    incident.id,
    ids.multi!,
    'start',
    input,
    own.id,
  );
  assert.equal(replay.replayed, true);
  assert.deepEqual(
    replay.resource.actions.map((a) => a.id),
    [own.id],
  );
  assert.equal(JSON.stringify(replay.resource).includes('Other officer private result'), false);
  assert.equal(
    replay.resource.audit.some((a) => a.changes.actionId === otherAction.id),
    false,
  );
});
