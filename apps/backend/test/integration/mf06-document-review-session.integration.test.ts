import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import type { ReviewWorkerDocumentCommand, WorkerDocumentResponse } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import type { AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import {
  ContractorOperationsService,
  type WorkforceActor,
} from '../../src/modules/workforce/directory/contractor-operations.service.js';
import type { ReviewWorkerDocumentDto } from '../../src/modules/workforce/documents/worker-documents.commands.js';
import { WorkerDocumentsController } from '../../src/modules/workforce/documents/worker-documents.controller.js';
import { WorkerDocumentsService } from '../../src/modules/workforce/documents/worker-documents.service.js';
import type { StorageService } from '../../src/integrations/storage/storage.service.js';
import type { DocumentOcrService } from '../../src/modules/workforce/documents/document-ocr.service.js';
import type { DocumentNotificationsService } from '../../src/modules/workforce/documents/document-notifications.service.js';

type WidenedReview = (
  actor: WorkforceActor,
  siteId: string,
  workerId: string,
  documentId: string,
  input: ReviewWorkerDocumentCommand,
  context?: MainConfigurationCommandContext,
) => Promise<WorkerDocumentResponse>;

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
before(async () => {
  console.log(`ownedDocumentReviewSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

const rejectInput: ReviewWorkerDocumentCommand = {
  expectedVersion: 1,
  approve: false,
  reviewNote: 'Synthetic rejection note',
};

async function snapshotState(siteId: string, actorId: string) {
  const [site] = await db.query('SELECT access_policy_version::int AS v FROM site WHERE id=$1', [
    siteId,
  ]);
  const [gaps] = await db.query('SELECT count(*)::int AS n FROM authorization_history_gap');
  const [revisions] = await db.query(
    'SELECT count(*)::int AS n FROM authorization_history_revision',
  );
  const [commands] = await db.query(
    'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id=$1',
    [actorId],
  );
  const [audits] = await db.query('SELECT count(*)::int AS n FROM audit_log WHERE site_id=$1', [
    siteId,
  ]);
  return {
    policyVersion: site.v as number,
    gapCount: gaps.n as number,
    revisionCount: revisions.n as number,
    commandCount: commands.n as number,
    auditCount: audits.n as number,
  };
}

async function fixture() {
  const actorId = randomUUID(),
    siteId = randomUUID(),
    workerId = randomUUID(),
    documentId = randomUUID();
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Safety Officer','not-a-password',true,false)",
    [actorId],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
    [randomUUID(), actorId, siteId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name,is_active) VALUES($1,$2,$1::uuid::text,'Synthetic Worker',true)",
    [workerId, siteId],
  );
  const storedObject = {
    key: `synthetic/${documentId}.pdf`,
    sha256: 'a'.repeat(64),
    size: 32,
    mediaType: 'application/pdf',
  };
  const ocrResult = { status: 'UNAVAILABLE', issuedOn: null, expiresOn: null, warnings: [] };
  await db.query(
    "INSERT INTO worker_document(id,worker_id,kind,status,original_name,file,ocr,uploaded_by,version) VALUES($1,$2,'SAFETY_CARD','PENDING','synthetic.pdf',$3::jsonb,$4::jsonb,$5,1)",
    [documentId, workerId, JSON.stringify(storedObject), JSON.stringify(ocrResult), actorId],
  );
  let notificationCount = 0;
  const service = new WorkerDocumentsService(
    db,
    new ContractorOperationsService(db),
    {} as StorageService,
    {} as DocumentOcrService,
    {
      noticeDays: 30,
      record: async () => void notificationCount++,
    } as unknown as DocumentNotificationsService,
  );
  const actor: WorkforceActor = {
    id: actorId,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SAFETY_OFFICER, siteId }],
  };
  let baseline = await snapshotState(siteId, actorId);
  const review: WidenedReview = (service.review as WidenedReview).bind(service);
  return {
    actorId,
    siteId,
    workerId,
    documentId,
    actor,
    review,
    notifications: () => notificationCount,
    baseline: () => baseline,
    refreshBaseline: async () => {
      baseline = await snapshotState(siteId, actorId);
    },
    currentState: () => snapshotState(siteId, actorId),
    assertUnchanged: async () => {
      const [doc] = await db.query(
        'SELECT status,version,reviewed_by,review_note FROM worker_document WHERE id=$1',
        [documentId],
      );
      assert.deepEqual(doc, {
        status: 'PENDING',
        version: 1,
        reviewed_by: null,
        review_note: null,
      });
      assert.deepEqual(await snapshotState(siteId, actorId), baseline);
      assert.equal(notificationCount, 0);
    },
  };
}

test('WorkerDocumentsController.review forwards original request into sixth command context reauthorize callback', async () => {
  const request = {
    user: { id: randomUUID(), mustChangePassword: false },
    headers: { authorization: 'Bearer synthetic-token' },
  } as unknown as AuthenticatedRequest;
  const fakeManager = {};
  let authCalls = 0;
  const fakeAuth = {
    authenticateRequest: async (actualRequest: unknown, actualManager: unknown) => {
      assert.equal(actualRequest, request);
      assert.equal(actualManager, fakeManager);
      authCalls++;
    },
  };
  let reviewed = 0;
  const fakeService = {
    review: async (...args: unknown[]) => {
      assert.equal(args.length, 6);
      const context = args[5] as MainConfigurationCommandContext | undefined;
      assert.ok(context);
      assert.equal(context.actorUserId, request.user!.id);
      assert.equal(typeof context.reauthorize, 'function');
      await context.reauthorize!(fakeManager as never);
      reviewed++;
      return { id: args[3] };
    },
  };
  const controller = Reflect.construct(WorkerDocumentsController, [
    fakeService,
    fakeAuth,
  ]) as WorkerDocumentsController;
  await controller.review(
    request,
    'site-id',
    'worker-id',
    'doc-id',
    rejectInput as ReviewWorkerDocumentDto,
  );
  assert.equal(reviewed, 1);
  assert.equal(authCalls, 1);
});

test('Allowed Safety review rejects pending document and attributes SITE policy revision to WORKER_DOCUMENT_REVIEW without journal gap', async () => {
  const f = await fixture();
  let reauthCalls = 0;
  const result = await f.review(f.actor, f.siteId, f.workerId, f.documentId, rejectInput, {
    actorUserId: f.actorId,
    reauthorize: async (manager) => {
      assert.equal(manager.queryRunner?.isTransactionActive, true);
      reauthCalls++;
    },
  });
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.version, 2);
  assert.equal(result.reviewNote, rejectInput.reviewNote);
  assert.equal(reauthCalls, 1);
  assert.equal(f.notifications(), 1);
  const afterState = await f.currentState();
  assert.equal(afterState.policyVersion, f.baseline().policyVersion + 1);
  assert.equal(afterState.gapCount, f.baseline().gapCount);
  assert.equal(afterState.auditCount, f.baseline().auditCount + 1);
  const attributed = await db.query(
    'SELECT r.source_kind,c.actor_user_id,c.operation FROM authorization_history_revision r JOIN authorization_history_command c ON c.command_id=r.command_id WHERE c.actor_user_id=$1',
    [f.actorId],
  );
  assert.deepEqual(attributed, [
    { source_kind: 'SITE', actor_user_id: f.actorId, operation: 'WORKER_DOCUMENT_REVIEW' },
  ]);
});

test('Revoked original session during transactional reauthorize rejects with 401 and rolls back document, policy, audit and history mutations', async () => {
  const f = await fixture();
  let reauthCalls = 0;
  await assert.rejects(
    f.review(f.actor, f.siteId, f.workerId, f.documentId, rejectInput, {
      actorUserId: f.actorId,
      reauthorize: async (manager) => {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        reauthCalls++;
        throw new UnauthorizedException();
      },
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 401,
  );
  assert.equal(reauthCalls, 1);
  await f.assertUnchanged();
});

test('Removing current Site SAFETY_OFFICER role after early actor snapshot rejects with 403 and performs no mutation', async () => {
  const f = await fixture();
  await db.query(
    "DELETE FROM user_role_assignment WHERE user_id=$1 AND role='SAFETY_OFFICER' AND site_id=$2",
    [f.actorId, f.siteId],
  );
  await f.refreshBaseline();
  await assert.rejects(
    f.review(f.actor, f.siteId, f.workerId, f.documentId, rejectInput, {
      actorUserId: f.actorId,
      reauthorize: async (manager) => assert.equal(manager.queryRunner?.isTransactionActive, true),
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
  );
  await f.assertUnchanged();
});

test('Actor and command context mismatch fails closed with 403 without reauthorizing or creating orphan history', async () => {
  const f = await fixture();
  const mismatchedActorId = randomUUID();
  await assert.rejects(
    f.review(f.actor, f.siteId, f.workerId, f.documentId, rejectInput, {
      actorUserId: mismatchedActorId,
      reauthorize: async () => assert.fail('Mismatched actor context must not reauthorize'),
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
  );
  await f.assertUnchanged();
  const [orphans] = await db.query(
    'SELECT count(*)::int AS n FROM authorization_history_command WHERE actor_user_id IN ($1,$2)',
    [f.actorId, mismatchedActorId],
  );
  assert.equal(orphans.n, 0);
});

test('Malformed Site ID is rejected before session or database role lookup', async () => {
  const f = await fixture();
  await assert.rejects(
    f.review(f.actor, 'not-a-uuid', f.workerId, f.documentId, rejectInput, {
      actorUserId: f.actorId,
      reauthorize: async () => assert.fail('Invalid Site must be rejected before reauthorization'),
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 400,
  );
  await f.assertUnchanged();
});
