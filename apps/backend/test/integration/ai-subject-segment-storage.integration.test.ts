import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { TrackedSubjectStorage1795046400003 } from '../../src/database/migrations/1795046400003-TrackedSubjectStorage.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('unregistered tracked storage preserves legacy data and scoped technical history on owned PostgreSQL', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const migration = new TrackedSubjectStorage1795046400003();
  const apply = (direction: 'up' | 'down') =>
    db.transaction((m) => migration[direction](m.queryRunner!));
  const scopeHash = 'a'.repeat(64),
    bundleHash = 'b'.repeat(64),
    profileHash = 'c'.repeat(64);
  const captured = '2026-11-01T08:00:00.000Z';
  const seed = async () => {
    const s = {
      site: randomUUID(),
      camera: randomUUID(),
      generation: randomUUID(),
      session: randomUUID(),
    };
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic tracked Site')",
      [s.site],
    );
    await db.query(
      "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic tracked camera')",
      [s.camera, s.site],
    );
    await db.query(
      `INSERT INTO camera_view_revision(camera_id,revision,site_id,session_id,source_kind,width,height,view_validity,is_current,created_at)
      VALUES($1,1,$2,$3,'LIVE',640,480,'UNCONFIRMED',true,clock_timestamp())`,
      [s.camera, s.site, s.session],
    );
    await db.query(
      `INSERT INTO camera_configuration_bundle(camera_id,configuration_version,site_id,camera_external_id,view_revision,issued_at,bundle_sha256)
      VALUES($1,1,$2,$1::uuid::text,1,clock_timestamp(),$3)`,
      [s.camera, s.site, bundleHash],
    );
    await db.query(
      `INSERT INTO camera_worker_generation(id,camera_id,site_id,stream_session_id,credential_sha256,is_current,issued_at,expires_at)
      VALUES($1,$2,$3,$4,$5,true,clock_timestamp(),clock_timestamp()+interval '1 hour')`,
      [s.generation, s.camera, s.site, s.session, 'd'.repeat(64)],
    );
    return s;
  };
  type Scope = Awaited<ReturnType<typeof seed>>;
  const raw = async (
    s: Scope,
    segment: string,
    sequence: string,
    previous?: string,
    ambiguous = false,
    partition?: { frameId: string; partIndex: number; partCount: number },
  ) => {
    const id = randomUUID(),
      frameId = partition?.frameId ?? randomUUID();
    const partIndex = partition?.partIndex ?? 0,
      partCount = partition?.partCount ?? 1;
    const payload = {
      eventId: id,
      schemaVersion: '1.5.0',
      streamSessionId: s.session,
      framePartition: { frameId, sequenceNumber: sequence, partIndex, partCount },
      observations: [{ type: 'PERSON', trackId: 1 }],
      continuity: {
        profileSha256: profileHash,
        subjects: [
          {
            personObservationIndex: 0,
            segmentId: segment,
            link: previous
              ? { kind: 'CONTINUE', previousEventId: previous, previousPersonObservationIndex: 0 }
              : { kind: 'START', reason: 'INITIAL' },
          },
        ],
      },
    };
    if (ambiguous)
      payload.continuity.subjects.push({
        personObservationIndex: 0,
        segmentId: segment,
        link: {
          kind: 'CONTINUE',
          previousEventId: randomUUID(),
          previousPersonObservationIndex: 0,
        },
      });
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,processing_status,safety_route_mode,safety_route_epoch,
      tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,tracking_source_sequence,tracking_part_index,tracking_part_count,
      tracking_frame_state,tracking_pending_until,tracking_transport_ack,tracking_frame_result)
      VALUES($1,$2,$3::uuid::text,$3,$4,$5,$6,'PROCESSED','EPISODE_TRACKED','00000000-0000-4000-8000-000000000001',$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp()+interval '1 minute','{}',$15)`,
      [
        id,
        'e'.repeat(64),
        s.camera,
        s.session,
        captured,
        JSON.stringify(payload),
        scopeHash,
        s.generation,
        s.site,
        frameId,
        sequence,
        partIndex,
        partCount,
        partIndex === 0 ? 'SEALED' : 'PART_STAGED',
        partIndex === 0 ? '{}' : null,
      ],
    );
    return id;
  };
  const start = (s: Scope, id: string, event: string) =>
    db.query(
      `INSERT INTO ai_subject_segment
    (segment_id,scope_sha256,site_id,camera_id,generation_id,stream_session_id,configuration_version,view_revision,bundle_sha256,profile_sha256,source_kind,
     first_event_id,first_person_observation_index,head_event_id,head_person_observation_index,head_source_sequence,head_captured_at,state)
    VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$8,'LIVE',$9,0,$9,0,0,$10,'ACTIVE')`,
      [
        id,
        scopeHash,
        s.site,
        s.camera,
        s.generation,
        s.session,
        bundleHash,
        profileHash,
        event,
        captured,
      ],
    );
  try {
    await owned.initialize();
    const legacy = randomUUID();
    await db.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,stream_session_id,captured_at,raw_payload,processing_status)
      VALUES($1,$2,'legacy-preserved',$3,$4,'{"schemaVersion":"1.0.0","observations":[]}','PROCESSED')`,
      [legacy, 'f'.repeat(64), randomUUID(), captured],
    );
    const snapshot = () =>
      db.query(
        'SELECT event_id,payload_hash,raw_payload,admission_context,safety_route_mode,safety_route_epoch FROM ai_observation_event WHERE event_id=$1',
        [legacy],
      );
    const before = await snapshot();
    await apply('up');
    await t.test(
      'fresh application and empty reversal preserve old raw/context/route bytes',
      async () => {
        assert.deepEqual(await snapshot(), before);
        assert.equal(
          (
            await db.query(
              'SELECT tracking_scope_sha256 FROM ai_observation_event WHERE event_id=$1',
              [legacy],
            )
          )[0].tracking_scope_sha256,
          null,
        );
        await apply('down');
        assert.equal(
          (await db.query("SELECT to_regclass('ai_subject_segment') AS name"))[0].name,
          null,
        );
        assert.deepEqual(await snapshot(), before);
        await apply('up');
      },
    );
    const s = await seed(),
      other = await seed(),
      segment = randomUUID();
    const first = await raw(s, segment, '0');
    await t.test(
      'an exact sealed PERSON can acquire a head, without a safety episode',
      async () => {
        await start(s, segment, first);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM safety_episode'))[0].n, 0);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_subject_segment'))[0].n, 1);
      },
    );
    await t.test(
      'scope and PERSON constraints reject cross-Site references and scope rewrites',
      async () => {
        await assert.rejects(start(other, randomUUID(), first), { code: '23514' });
        await assert.rejects(
          db.query('UPDATE ai_subject_segment SET site_id=$2 WHERE segment_id=$1', [
            segment,
            other.site,
          ]),
          { code: '23514' },
        );
        await assert.rejects(
          db.query(
            'UPDATE ai_subject_segment SET head_person_observation_index=1 WHERE segment_id=$1',
            [segment],
          ),
          { code: '23514' },
        );
        await assert.rejects(
          db.query('UPDATE ai_observation_event SET tracking_scope_sha256=$2 WHERE event_id=$1', [
            legacy,
            scopeHash,
          ]),
          { code: '23514' },
        );
      },
    );
    await t.test('ambiguous PERSON claims cannot acquire a segment head', async () => {
      const id = randomUUID();
      const event = await raw(other, id, '0', undefined, true);
      await assert.rejects(start(other, id, event), { code: '23514' });
    });
    await t.test(
      'uint64 heads retain exact decimal values and require the previous committed head',
      async () => {
        const bad = await raw(s, segment, '1', randomUUID());
        await assert.rejects(
          db.query(
            'UPDATE ai_subject_segment SET head_event_id=$2,head_source_sequence=1 WHERE segment_id=$1',
            [segment, bad],
          ),
          { code: '23514' },
        );
        const max = await raw(s, segment, '18446744073709551615', first);
        await db.query(
          'UPDATE ai_subject_segment SET head_event_id=$2,head_source_sequence=$3 WHERE segment_id=$1',
          [segment, max, '18446744073709551615'],
        );
        assert.equal(
          (
            await db.query(
              'SELECT head_source_sequence FROM ai_subject_segment WHERE segment_id=$1',
              [segment],
            )
          )[0].head_source_sequence,
          '18446744073709551615',
        );
        await assert.rejects(raw(s, randomUUID(), '18446744073709551616'), {
          code: '23514',
          constraint: 'chk_ai_event_tracking_fields',
        });
        await assert.rejects(
          db.query(
            'UPDATE ai_subject_segment SET head_event_id=$2,head_source_sequence=0 WHERE segment_id=$1',
            [segment, first],
          ),
          { code: '23514' },
        );
      },
    );
    await t.test(
      'terminal raw data and permanent segment/tombstone history cannot be rewritten or deleted',
      async () => {
        await assert.rejects(
          db.query(
            'UPDATE ai_observation_event SET tracking_pending_until=clock_timestamp() WHERE event_id=$1',
            [first],
          ),
          { code: '23514' },
        );
        await assert.rejects(
          db.query("UPDATE ai_observation_event SET raw_payload='{}' WHERE event_id=$1", [first]),
          { code: '23514' },
        );
        await assert.rejects(
          db.query('DELETE FROM ai_observation_event WHERE event_id=$1', [first]),
          { code: '23514' },
        );
        await db.query(
          "UPDATE ai_subject_segment SET state='RETIRED',retired_at=clock_timestamp(),retirement_reason='LOST_TRACK',retirement_provenance='{}' WHERE segment_id=$1",
          [segment],
        );
        await assert.rejects(
          db.query(
            "UPDATE ai_subject_segment SET state='ACTIVE',retired_at=NULL,retirement_reason=NULL,retirement_provenance=NULL WHERE segment_id=$1",
            [segment],
          ),
          { code: '23514' },
        );
        await assert.rejects(
          db.query('DELETE FROM ai_subject_segment WHERE segment_id=$1', [segment]),
          { code: '23514' },
        );
        const tombstone = randomUUID();
        await db.query(
          `INSERT INTO ai_subject_segment(segment_id,scope_sha256,site_id,camera_id,generation_id,stream_session_id,configuration_version,view_revision,bundle_sha256,profile_sha256,source_kind,state,retired_at,retirement_reason,retirement_provenance)
        VALUES($1,$2,$3,$4,$5,$6,1,1,$7,$8,'LIVE','RETIRED',clock_timestamp(),'LOST_TRACK','{}')`,
          [
            tombstone,
            scopeHash,
            s.site,
            s.camera,
            s.generation,
            s.session,
            bundleHash,
            profileHash,
          ],
        );
        assert.equal(
          (
            await db.query(
              'SELECT first_event_id,head_event_id FROM ai_subject_segment WHERE segment_id=$1',
              [tombstone],
            )
          )[0].first_event_id,
          null,
        );
        await assert.rejects(apply('down'), /history/);
        assert.equal((await db.query('SELECT count(*)::int AS n FROM ai_subject_segment'))[0].n, 2);
        assert.deepEqual(await snapshot(), before);
      },
    );
    await t.test(
      'a nonzero original PERSON needs its matching sealed coordinator, not a fabricated part-zero PERSON',
      async () => {
        const scope = await seed(),
          subject = randomUUID(),
          frameId = randomUUID();
        const original = await raw(scope, subject, '0', undefined, false, {
          frameId,
          partIndex: 1,
          partCount: 2,
        });
        await assert.rejects(start(scope, subject, original), { code: '23514' });
        await raw(scope, randomUUID(), '0', undefined, false, {
          frameId,
          partIndex: 0,
          partCount: 2,
        });
        await start(scope, subject, original);
        await assert.rejects(
          db.query(
            "UPDATE ai_observation_event SET tracking_frame_state='PART_EXPIRED' WHERE event_id=$1",
            [original],
          ),
          { code: '23514' },
        );
        assert.equal(
          (
            await db.query('SELECT head_event_id FROM ai_subject_segment WHERE segment_id=$1', [
              subject,
            ])
          )[0].head_event_id,
          original,
        );
      },
    );
  } finally {
    await owned.dispose();
  }
});
