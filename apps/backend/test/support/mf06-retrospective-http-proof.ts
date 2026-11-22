import assert from 'node:assert/strict';
import { proveInitialDenialProjection } from './mf06-initial-denial-proof.js';
import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  readC02AcceptedSubject,
  type C02AcceptedSubjectScope,
} from '../../src/modules/safety/identification/c02-accepted-subject.js';
import { Mf06AssessmentStore } from '../../src/modules/safety/assessments/mf06-assessment-store.service.js';
import { Mf06ClaimContextReader } from '../../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06JobLeaseService } from '../../src/modules/safety/assessments/mf06-job-lease.service.js';
import { Mf06ZoneEntryAssessmentWorkPort } from '../../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js';
import { seedZonePermissionActors } from './c02-identification-fixture.js';

/** Continue the registered HTTP fixture after its approved crop has been published. */
export async function proveMf06RetrospectiveHttp(input: {
  db: DataSource;
  api: string;
  siteId: string;
  regionId: string;
  passwordHash: string;
  request: { id: string; version: number };
  episodeId: string;
  eventId: string;
  personObservationIndex: number;
  frameSha256: string;
  officerToken: string;
  managerToken: string;
}) {
  const { db, api, siteId, request, episodeId, officerToken, managerToken } = input;
  const actors = await seedZonePermissionActors(db, siteId, input.regionId, input.passwordHash);
  const root = (site = siteId, id = request.id) =>
    `${api}/sites/${site}/safety-identification-requests/${id}`;
  const post = (path: string, token: string, body: unknown, site = siteId) =>
    fetch(root(site) + path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const read = (path: string, token = officerToken, site = siteId, id = request.id) =>
    fetch(root(site, id) + path, { headers: { authorization: `Bearer ${token}` } });
  const json = async (response: Response, status: number) => {
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  const initial = await db.query(
    'SELECT request_id,person_observation_index FROM zone_entry_assessment_request',
  );
  const jobs = await db.query(
    'SELECT request_id,status,attempt_count FROM zone_entry_assessment_job',
  );
  assert.equal(initial.length, 1);
  assert.equal(initial[0].person_observation_index, input.personObservationIndex);
  assert.equal(jobs[0].status, 'PENDING');
  const proposal = await json(
    await post('/respond', managerToken, {
      commandId: randomUUID(),
      expectedVersion: request.version,
      outcome: 'IDENTIFIED',
      workerId: actors.workerId,
      contractorId: actors.contractorId,
      evidenceRefs: [],
      reason: 'Propose the Worker for the exact approved frame subject',
    }),
    201,
  );
  const scope: C02AcceptedSubjectScope = {
    siteId,
    episodeId,
    requestId: request.id,
    version: proposal.request.version + 1,
    eventId: input.eventId,
    personObservationIndex: input.personObservationIndex,
    frameSha256: input.frameSha256,
  };
  const bindingFor = (patch: Partial<C02AcceptedSubjectScope> = {}) =>
    db.transaction((manager) => readC02AcceptedSubject(manager, { ...scope, ...patch }));
  assert.equal(await bindingFor(), null, 'An unaccepted proposal cannot establish C02 identity');
  const closed = await json(
    await post('/review', officerToken, {
      commandId: randomUUID(),
      expectedVersion: proposal.request.version,
      decision: 'ACCEPT',
      reason: 'Accept identity without deciding Zone authorization',
    }),
    201,
  );
  assert.equal(closed.request.status, 'CLOSED');
  assert.equal(closed.request.result.workerId, actors.workerId);
  assert.equal(closed.request.result.contractorId, actors.contractorId);
  const binding = await bindingFor();
  assert.ok(binding);
  assert.equal(binding.workerId, actors.workerId);
  assert.ok(binding.acceptanceId && binding.proposalId);
  assert.notEqual(binding.acceptanceId, binding.proposalId);
  for (const mismatch of [
    { siteId: randomUUID() },
    { episodeId: randomUUID() },
    { requestId: randomUUID() },
    { eventId: randomUUID() },
    { personObservationIndex: 0 },
    { frameSha256: 'f'.repeat(64) },
    { version: scope.version - 1 },
  ])
    assert.equal(await bindingFor(mismatch), null);
  assert.deepEqual(
    await db.query('SELECT request_id,person_observation_index FROM zone_entry_assessment_request'),
    initial,
  );
  assert.deepEqual(
    await db.query('SELECT request_id,status,attempt_count FROM zone_entry_assessment_job'),
    jobs,
  );
  assert.deepEqual(await db.query('SELECT count(*)::int AS n FROM zone_entry_assessment'), [
    { n: 0 },
  ]);

  const command = {
    episodeId,
    initialRequestId: initial[0].request_id,
    identificationVersion: scope.version,
    commandId: randomUUID(),
  };
  const enqueue = (body = command, token = officerToken, site = siteId) =>
    post('/retrospective-assessment', token, body, site);
  assert.equal((await enqueue(command, managerToken)).status, 403);
  assert.equal((await enqueue(command, officerToken, randomUUID())).status, 403);
  assert.equal(
    (
      await post('/retrospective-assessment', officerToken, {
        ...command,
        workerId: actors.workerId,
      })
    ).status,
    400,
  );
  assert.equal((await enqueue({ ...command, episodeId: randomUUID() })).status, 404);
  const optionsPath = '/retrospective-assessment-options';
  const optionsResponse = await read(optionsPath);
  const options = await json(optionsResponse, 200);
  assert.match(optionsResponse.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(options.identificationVersion, scope.version);
  assert.equal(options.episodeId, episodeId);
  assert.deepEqual(
    options.items.map((row: { initialRequestId: string }) => row.initialRequestId),
    [command.initialRequestId],
  );
  assert.ok(
    options.items[0].capturedAt && options.items[0].cameraName && options.items[0].zoneName,
  );
  assert.equal('workerId' in options.items[0], false);
  assert.equal((await read(optionsPath, managerToken)).status, 403);
  assert.equal((await read(optionsPath, officerToken, randomUUID())).status, 403);
  assert.equal((await read(optionsPath, officerToken, siteId, randomUUID())).status, 404);

  const duplicate = { ...command, commandId: randomUUID() };
  const responses = await Promise.all([enqueue(command), enqueue(duplicate)]);
  assert.ok(responses.every((response) => [202, 503].includes(response.status)));
  const winner = responses.find((response) => response.status === 202);
  assert.ok(winner);
  const accepted = await winner.json();
  assert.ok(accepted.requestId);
  for (const retry of [command, duplicate])
    assert.deepEqual(await json(await enqueue(retry), 202), accepted);
  assert.deepEqual((await json(await read(optionsPath), 200)).items, []);
  const historyPath = '/retrospective-assessments';
  const pendingResponse = await read(historyPath);
  const pending = await json(pendingResponse, 200);
  assert.match(pendingResponse.headers.get('cache-control') ?? '', /no-store/);
  assert.equal(pending.total, 1);
  assert.equal(pending.items[0].requestId, accepted.requestId);
  assert.equal(pending.items[0].initialRequestId, command.initialRequestId);
  assert.equal(pending.items[0].status, 'PENDING');
  assert.equal(pending.items[0].reasonCode, null);
  assert.equal((await read(historyPath, managerToken)).status, 403);
  assert.equal((await read(historyPath, officerToken, randomUUID())).status, 403);
  assert.equal((await read(historyPath, officerToken, siteId, randomUUID())).status, 404);
  assert.deepEqual(
    await db.query(`SELECT r.initial_request_id,r.c02_acceptance_id,j.status,j.attempt_count
    FROM zone_entry_assessment_request r JOIN zone_entry_assessment_job j USING(request_id)
    WHERE r.requested_purpose='RETROSPECTIVE_REVIEW'`),
    [
      {
        initial_request_id: command.initialRequestId,
        c02_acceptance_id: binding.acceptanceId,
        status: 'PENDING',
        attempt_count: 0,
      },
    ],
  );

  const leases = new Mf06JobLeaseService(db, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  const reader = new Mf06ClaimContextReader(db);
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const claim = await leases.claim();
    assert.ok(claim);
    const context = await reader.readForClaim(claim);
    assert.equal(context.status, 'MATCHED');
    assert.ok(context.status === 'MATCHED');
    contexts.push(context);
  }
  const original = contexts.find(
    (context) => context.request.requestId === command.initialRequestId,
  );
  const retrospective = contexts.find(
    (context) => context.request.requestId === accepted.requestId,
  );
  assert.ok(original?.authorityCapturedAt && retrospective);
  assert.equal(retrospective.authorityCapturedAt, original.authorityCapturedAt);
  assert.deepEqual(retrospective.retrospectiveIdentity, { ...binding });
  assert.equal(retrospective.subject?.personObservationIndex, input.personObservationIndex);
  assert.equal(retrospective.frameReference?.sha256, input.frameSha256);
  // Exercise real persistence without inventing a qualified authority archive.
  const work = new Mf06ZoneEntryAssessmentWorkPort(
    db,
    reader,
    {
      prepareForEvent: async () => ({ status: 'UNAVAILABLE', reason: 'CAPTURE_UNAVAILABLE' }),
      revalidate: async () => {
        throw new Error('Unavailable authority must not be revalidated');
      },
    },
    {
      prepare: async () => {
        throw new Error('Unavailable authority must not prepare face evidence');
      },
    },
    {
      revalidate: async () => {
        throw new Error('Unavailable authority must not resolve candidates');
      },
    },
    new Mf06AssessmentStore(db),
  );
  const signal = new AbortController().signal;
  const prepared = await work.prepare(retrospective.claim, signal);
  const result = await db.transaction('SERIALIZABLE', (manager) =>
    work.finalize(manager, retrospective.claim, prepared, signal),
  );
  assert.equal(result.state, 'RECORDED');
  assert.ok(result.state === 'RECORDED');
  assert.equal(result.assessment.reasonCode, 'AUTHORITY_UNAVAILABLE');
  assert.equal(result.assessment.outcome, 'UNAVAILABLE');
  assert.equal(result.assessment.authorityArtifact, null);
  const finished = await json(await read(historyPath), 200);
  assert.equal(finished.total, 1);
  assert.equal(finished.items[0].capturedAt, retrospective.authorityCapturedAt);
  assert.equal(finished.items[0].status, 'UNAVAILABLE');
  assert.equal(finished.items[0].reasonCode, 'AUTHORITY_UNAVAILABLE');
  assert.equal(finished.items[0].originalOutcome, null);
  for (const field of ['workerId', 'authorityArtifact', 'c02AcceptanceId'])
    assert.equal(field in finished.items[0], false);
  assert.deepEqual(await json(await read(historyPath + '?offset=1&limit=1'), 200), {
    items: [],
    total: 1,
  });
  assert.deepEqual(
    await db.query(
      'SELECT count(*)::int AS unread FROM safety_episode_recipient WHERE seen_revision=0',
    ),
    [{ unread: 3 }],
  );
  await proveInitialDenialProjection(db, original, api, officerToken, input.frameSha256);
}
