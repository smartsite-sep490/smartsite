import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf06RetrospectiveResult1795046400016 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const [{ schema }] = await runner.query('SELECT current_schema() AS schema');
    if (
      !runner.isTransactionActive ||
      schema !== runner.connection.driver.schema ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
      /^(pg_|information_schema$)/.test(schema)
    )
      throw new Error('Explicit authority schema and transaction required');

    const target = `"${schema}"`;
    const assessments = `${target}.zone_entry_assessment`;
    const requests = `${target}.zone_entry_assessment_request`;
    const actions = `${target}.safety_identification_action`;
    await runner.query("SET LOCAL lock_timeout='5s'");
    const checks: { conname: string }[] = await runner.query(
      `SELECT conname FROM pg_catalog.pg_constraint
        WHERE conrelid=$1::regclass AND contype='c'
          AND pg_catalog.pg_get_constraintdef(oid) LIKE '%profile_revision IS NOT NULL%'
          AND pg_catalog.pg_get_constraintdef(oid) LIKE '%UNAUTHORIZED%'`,
      [assessments],
    );
    if (checks.length !== 1) throw new Error('Canonical MF06 identity constraint unavailable');
    const predecessor = checks[0]!.conname.replaceAll('"', '""');
    await runner.query(`
      ALTER TABLE ${assessments}
        ADD COLUMN c02_acceptance_id uuid,
        DROP CONSTRAINT "${predecessor}",
        ADD CONSTRAINT chk_mf06_assessment_identity_evidence CHECK (
          CASE WHEN reason_code IN ('AUTHORIZED','UNAUTHORIZED') THEN
            worker_id IS NOT NULL AND frame_sha256 IS NOT NULL AND provenance<>'UNAVAILABLE' AND (
              (c02_acceptance_id IS NULL AND profile_revision IS NOT NULL AND crop_sha256 IS NOT NULL)
              OR (c02_acceptance_id IS NOT NULL AND profile_revision IS NULL AND crop_sha256 IS NULL)
            )
          ELSE c02_acceptance_id IS NULL END
        );
      CREATE FUNCTION ${target}.mf06_c02_result_guard()
        RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, ${target}, pg_temp AS $guard$
      BEGIN
        IF NEW.reason_code NOT IN ('AUTHORIZED','UNAUTHORIZED') THEN RETURN NEW; END IF;
        IF NOT EXISTS (
          SELECT 1 FROM ${requests} r
          LEFT JOIN ${actions} a ON (a.command_id,a.site_id)=(r.c02_acceptance_id,r.site_id)
          WHERE r.request_id=NEW.request_id AND r.site_id=NEW.site_id
            AND r.c02_acceptance_id IS NOT DISTINCT FROM NEW.c02_acceptance_id
            AND (r.c02_acceptance_id IS NULL OR
                 (r.requested_purpose='RETROSPECTIVE_REVIEW' AND a.kind='ACCEPT'
                  AND a.result->'result'->>'outcome'='IDENTIFIED'
                  AND a.result->'result'->>'workerId'=NEW.worker_id::text))
        ) THEN
          RAISE EXCEPTION 'MF06 assessment identity source mismatch' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $guard$;
      CREATE TRIGGER trg_mf06_c02_result BEFORE INSERT ON ${assessments}
        FOR EACH ROW EXECUTE FUNCTION ${target}.mf06_c02_result_guard();
    `);
  }

  async down(): Promise<void> {
    throw new Error('MF06 C02 result provenance is forward-only; restore a verified backup');
  }
}
