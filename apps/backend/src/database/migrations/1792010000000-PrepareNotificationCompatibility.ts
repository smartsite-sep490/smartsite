import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Bridges pending Main CHECK changes without rewriting already-applied history. */
export class PrepareNotificationCompatibility1792010000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error(
        'Notification compatibility requires the same transaction for every migration',
      );
    await runner.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relname='user_notification'
          AND c.relkind='r' AND NOT c.relrowsecurity AND NOT c.relforcerowsecurity) THEN
        RAISE EXCEPTION 'Owned notification table required for compatibility';
      END IF;
      IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema() AND c.relname='notification_upgrade_bridge') OR
        EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname=current_schema() AND p.proname='notification_upgrade_commit_guard') THEN
        RAISE EXCEPTION 'Notification compatibility object collision';
      END IF;
    END $$;
    LOCK TABLE user_notification IN SHARE ROW EXCLUSIVE MODE;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='user_notification'::regclass
          AND NOT tgisinternal) OR
        EXISTS (SELECT 1 FROM pg_rewrite WHERE ev_class='user_notification'::regclass) THEN
        RAISE EXCEPTION 'Notification compatibility requires review of custom triggers or rules';
      END IF;
    END $$;
    CREATE TABLE notification_upgrade_bridge (
      kind text NOT NULL CHECK(kind IN ('HEADER','ROW')),
      id uuid NOT NULL,
      transaction_id text NOT NULL,
      original jsonb,
      completed boolean NOT NULL DEFAULT false,
      PRIMARY KEY(kind,id),
      CHECK((kind='HEADER' AND id='00000000-0000-0000-0000-000000000000' AND original IS NULL) OR
        (kind='ROW' AND original IS NOT NULL AND jsonb_typeof(original)='object'
          AND (original->>'id') IS NOT DISTINCT FROM id::text AND NOT completed))
    );
    CREATE FUNCTION notification_upgrade_commit_guard() RETURNS trigger
      LANGUAGE plpgsql SET search_path FROM CURRENT AS $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM notification_upgrade_bridge WHERE kind='HEADER'
        AND transaction_id=pg_current_xact_id()::text AND completed) THEN
        RAISE EXCEPTION 'Notification compatibility bridge must complete in the same transaction';
      END IF;
      RETURN NULL;
    END $$;
    CREATE CONSTRAINT TRIGGER notification_upgrade_commit_guard
      AFTER INSERT ON notification_upgrade_bridge DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.kind='HEADER') EXECUTE FUNCTION notification_upgrade_commit_guard();
    INSERT INTO notification_upgrade_bridge(kind,id,transaction_id)
      VALUES('HEADER','00000000-0000-0000-0000-000000000000',pg_current_xact_id()::text);
    INSERT INTO notification_upgrade_bridge(kind,id,transaction_id,original)
      SELECT 'ROW',id,pg_current_xact_id()::text,to_jsonb(n) FROM user_notification n
      WHERE request_type='CHECKLIST' OR recipient_role='SITE_MANAGER';
    -- These values exist in every affected historical CHECK. Other transactions
    -- cannot observe them; the deferred guard forbids committing before restore.
    UPDATE user_notification n SET event='CHANGE_REQUESTED',request_type='CHANGE',
      recipient_role='CONTRACTOR_REPRESENTATIVE',worker_id=NULL
      FROM notification_upgrade_bridge b WHERE b.kind='ROW' AND n.id=b.id;`);
  }

  async down(): Promise<void> {
    throw new Error('Notification compatibility is forward-only; use verified backup recovery');
  }
}
