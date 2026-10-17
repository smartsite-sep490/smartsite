import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Restores every original notification before the bridge transaction may commit. */
export class CompleteNotificationCompatibility1792368000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error(
        'Notification compatibility requires the same transaction for every migration',
      );
    await runner.query(`DO $$
    DECLARE expected bigint; restored bigint;
    BEGIN
      IF (SELECT count(*) FROM notification_upgrade_bridge WHERE kind='HEADER')<>1 OR
        EXISTS (SELECT 1 FROM notification_upgrade_bridge
          WHERE transaction_id<>pg_current_xact_id()::text OR completed) THEN
        RAISE EXCEPTION 'Notification compatibility requires the same transaction and an incomplete bridge';
      END IF;
      SELECT count(*) INTO expected FROM notification_upgrade_bridge WHERE kind='ROW';
      IF EXISTS (SELECT 1 FROM notification_upgrade_bridge b
        LEFT JOIN user_notification n ON n.id=b.id WHERE b.kind='ROW' AND
        (n.id IS NULL OR n.event<>'CHANGE_REQUESTED' OR n.request_type<>'CHANGE' OR
          n.recipient_role<>'CONTRACTOR_REPRESENTATIVE' OR n.worker_id IS NOT NULL OR
          (to_jsonb(n)||jsonb_build_object('event',b.original->'event',
            'request_type',b.original->'request_type','recipient_role',b.original->'recipient_role',
            'worker_id',b.original->'worker_id')) IS DISTINCT FROM b.original)) THEN
        RAISE EXCEPTION 'Notification compatibility refused an unexpected row change';
      END IF;
      UPDATE user_notification n SET event=b.original->>'event',request_type=b.original->>'request_type',
        recipient_role=b.original->>'recipient_role',worker_id=(b.original->>'worker_id')::uuid
        FROM notification_upgrade_bridge b WHERE b.kind='ROW' AND n.id=b.id;
      GET DIAGNOSTICS restored=ROW_COUNT;
      IF restored<>expected OR EXISTS (SELECT 1 FROM notification_upgrade_bridge b
        LEFT JOIN user_notification n ON n.id=b.id
        WHERE b.kind='ROW' AND to_jsonb(n) IS DISTINCT FROM b.original) THEN
        RAISE EXCEPTION 'Notification compatibility did not restore every original field';
      END IF;
      UPDATE notification_upgrade_bridge SET completed=true WHERE kind='HEADER';
    END $$;
    SET CONSTRAINTS notification_upgrade_commit_guard IMMEDIATE;
    DROP TABLE notification_upgrade_bridge;
    DROP FUNCTION notification_upgrade_commit_guard();`);
  }

  async down(): Promise<void> {
    throw new Error('Notification compatibility is forward-only; use verified backup recovery');
  }
}
