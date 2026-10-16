import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import source from '../support/test-data-source.js';
import { AttendanceAbsence1792022400000 } from '../../src/database/migrations/1792022400000-AttendanceAbsence.js';
import { SafetyChecklists1792195200000 } from '../../src/database/migrations/1792195200000-SafetyChecklists.js';

test('checklist migration preserves existing absence notifications through up, down and reapply', async () => {
  await source.initialize();
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const schema = `notification_merge_${randomUUID().replaceAll('-', '')}`;
  try {
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query(`
      CREATE TABLE site(id uuid PRIMARY KEY);
      CREATE TABLE contractor(id uuid PRIMARY KEY);
      CREATE TABLE zone(id uuid PRIMARY KEY, site_id uuid);
      CREATE TABLE app_user(id uuid PRIMARY KEY);
      CREATE TABLE contractor_team(id uuid, site_id uuid, contractor_id uuid,
        UNIQUE(id,site_id,contractor_id));
      CREATE TABLE incident(id uuid PRIMARY KEY);
      CREATE TABLE safety_evidence(id uuid PRIMARY KEY,
        media_type text CONSTRAINT safety_evidence_media_type_check CHECK(media_type='image/jpeg'),
        size integer CONSTRAINT safety_evidence_size_check CHECK(size BETWEEN 1 AND 1048576));
      CREATE TABLE safety_workflow_audit(resource_type text
        CONSTRAINT safety_workflow_audit_resource_type_check CHECK(resource_type IN ('INCIDENT','SAFETY_TASK')));
      CREATE TABLE attendance_day(status text CONSTRAINT attendance_day_status_check
        CHECK(status IN ('IN_PROGRESS','NEEDS_REVIEW','CONFIRMED')));
      CREATE TABLE user_notification(
        event text CONSTRAINT chk_notification_event CHECK(event='MISSING_CHECKOUT'),
        request_type text CONSTRAINT chk_notification_request_type CHECK(request_type IN ('ATTENDANCE','SCHEDULE')),
        recipient_role text, worker_id uuid, content jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT chk_notification_role CHECK(recipient_role='WORKER' AND worker_id IS NOT NULL));
    `);
    await new AttendanceAbsence1792022400000().up(runner);
    const insertAbsence = () =>
      runner.query(
        "INSERT INTO user_notification(event,request_type,recipient_role,worker_id) VALUES('ABSENT','ATTENDANCE','WORKER',$1)",
        [randomUUID()],
      );
    await insertAbsence();
    const migration = new SafetyChecklists1792195200000();
    await migration.up(runner);
    await insertAbsence();
    for (const event of [
      'CHECKLIST_ASSIGNED',
      'CHECKLIST_SUBMITTED',
      'CHECKLIST_RETURNED',
      'CHECKLIST_RECORDED',
    ])
      await runner.query(
        "INSERT INTO user_notification(event,request_type,recipient_role,content) VALUES($1,'CHECKLIST','SAFETY_OFFICER',$2)",
        [event, { checklistId: randomUUID() }],
      );
    await runner.query("DELETE FROM user_notification WHERE request_type='CHECKLIST'");
    await migration.down(runner);
    await insertAbsence();
    await migration.up(runner);
    await insertAbsence();
    const [row] = (await runner.query(
      "SELECT count(*)::int AS count FROM user_notification WHERE event='ABSENT'",
    )) as { count: number }[];
    assert.equal(row!.count, 4);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
});
