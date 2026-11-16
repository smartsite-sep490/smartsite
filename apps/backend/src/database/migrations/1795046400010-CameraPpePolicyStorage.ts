import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Source prototype; explicitly applied in isolated rehearsals, not a default rollout. */
export class CameraPpePolicyStorage1795046400010 implements MigrationInterface {
  name = 'CameraPpePolicyStorage1795046400010';
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('PPE policy storage requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`ALTER TABLE camera_configuration_bundle
  ADD COLUMN schema_version varchar(16) NOT NULL DEFAULT '1.0.0',
  ADD COLUMN camera_ppe_policy jsonb,
  ADD COLUMN command_id uuid,
  ADD COLUMN command_actor_id uuid,
  ADD COLUMN command_request_sha256 char(64),
  ADD CONSTRAINT chk_camera_bundle_schema_version CHECK (schema_version IN ('1.0.0','2.0.0')),
  ADD CONSTRAINT chk_camera_bundle_ppe_mode CHECK (
    (schema_version='1.0.0' AND camera_ppe_policy IS NULL)
    OR (schema_version='2.0.0' AND COALESCE(
      jsonb_typeof(camera_ppe_policy)='object'
      AND camera_ppe_policy->>'mode' IN ('EXPLICIT','DISABLED'), false))
  ),
  ADD CONSTRAINT chk_camera_bundle_command_context CHECK (
    (command_id IS NULL AND command_actor_id IS NULL AND command_request_sha256 IS NULL)
    OR (schema_version='2.0.0' AND command_id IS NOT NULL AND command_actor_id IS NOT NULL
      AND command_request_sha256 IS NOT NULL AND command_request_sha256 ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT fk_camera_bundle_command_actor FOREIGN KEY (command_actor_id)
    REFERENCES app_user(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_camera_bundle_command_id
  ON camera_configuration_bundle(command_id) WHERE command_id IS NOT NULL;
ALTER TABLE camera_configuration_bundle_region
  ADD COLUMN ppe_policy jsonb,
  ADD CONSTRAINT chk_camera_bundle_region_ppe_mode CHECK (
    ppe_policy IS NULL OR COALESCE(jsonb_typeof(ppe_policy)='object'
      AND ppe_policy->>'mode' IN ('INHERIT','EXPLICIT','DISABLED'), false)
  );
`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('PPE policy storage requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(
      'LOCK TABLE camera_configuration_bundle, camera_configuration_bundle_region IN ACCESS EXCLUSIVE MODE',
    );
    const [retained] = await runner.query(`SELECT
      EXISTS(SELECT 1 FROM camera_configuration_bundle WHERE schema_version<>'1.0.0'
        OR camera_ppe_policy IS NOT NULL OR command_id IS NOT NULL OR command_actor_id IS NOT NULL
        OR command_request_sha256 IS NOT NULL)
      OR EXISTS(SELECT 1 FROM camera_configuration_bundle_region WHERE ppe_policy IS NOT NULL) AS present`);
    if (retained.present) throw new Error('PPE policy history must be retained before rollback');
    await runner.query(`ALTER TABLE camera_configuration_bundle_region
      DROP CONSTRAINT chk_camera_bundle_region_ppe_mode, DROP COLUMN ppe_policy`);
    await runner.query('DROP INDEX uq_camera_bundle_command_id');
    await runner.query(`ALTER TABLE camera_configuration_bundle
      DROP CONSTRAINT fk_camera_bundle_command_actor,
      DROP CONSTRAINT chk_camera_bundle_command_context,
      DROP CONSTRAINT chk_camera_bundle_ppe_mode,
      DROP CONSTRAINT chk_camera_bundle_schema_version,
      DROP COLUMN command_request_sha256, DROP COLUMN command_actor_id,
      DROP COLUMN command_id, DROP COLUMN camera_ppe_policy, DROP COLUMN schema_version`);
  }
}
