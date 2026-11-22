import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf06RetrospectiveBinding1795046400015 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    const [{ schema }] = await runner.query('SELECT current_schema() AS schema');
    if (
      !runner.isTransactionActive ||
      schema !== runner.connection.driver.schema ||
      !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
      /^(pg_|information_schema$)/.test(schema)
    )
      throw new Error('Explicit authority schema and transaction required');

    const requests = `"${schema}".zone_entry_assessment_request`;
    const actions = `"${schema}".safety_identification_action`;
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`
      ALTER TABLE ${actions}
        ADD CONSTRAINT uq_c02_action_command_site UNIQUE(command_id,site_id);
      ALTER TABLE ${requests}
        ADD COLUMN initial_request_id uuid,
        ADD COLUMN c02_acceptance_id uuid,
        ADD COLUMN retrospective_command_id uuid,
        ADD CONSTRAINT uq_mf06_request_id_site UNIQUE(request_id,site_id),
        ADD CONSTRAINT fk_mf06_review_initial_site FOREIGN KEY(initial_request_id,site_id)
          REFERENCES ${requests}(request_id,site_id) ON DELETE RESTRICT,
        ADD CONSTRAINT fk_mf06_review_acceptance_site FOREIGN KEY(c02_acceptance_id,site_id)
          REFERENCES ${actions}(command_id,site_id) ON DELETE RESTRICT,
        ADD CONSTRAINT chk_mf06_review_binding CHECK (
          num_nonnulls(initial_request_id,c02_acceptance_id,retrospective_command_id)=0 OR
          (num_nonnulls(initial_request_id,c02_acceptance_id,retrospective_command_id)=3
            AND requested_purpose='RETROSPECTIVE_REVIEW'
            AND subject_binding_status='BOUND' AND initial_request_id<>request_id)
        );
      CREATE UNIQUE INDEX uq_mf06_review_command ON ${requests}(retrospective_command_id)
        WHERE retrospective_command_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_mf06_review_acceptance ON ${requests}(initial_request_id,c02_acceptance_id)
        WHERE c02_acceptance_id IS NOT NULL;
      CREATE FUNCTION "${schema}".mf06_retrospective_binding_guard()
        RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, "${schema}", pg_temp AS $guard$
      BEGIN
        IF NEW.initial_request_id IS NULL THEN RETURN NEW; END IF;
        IF NOT EXISTS (
          SELECT 1 FROM ${requests} initial
          WHERE initial.request_id=NEW.initial_request_id AND initial.site_id=NEW.site_id
            AND initial.requested_purpose='INITIAL_OBSERVATION_ASSESSMENT'
            AND initial.subject_binding_status='BOUND'
            AND ROW(initial.event_id,initial.payload_hash,initial.person_observation_index,
                    initial.zone_observation_index,initial.track_id,initial.camera_id,
                    initial.region_id,initial.geometry_version,initial.zone_id,initial.captured_at)
                IS NOT DISTINCT FROM
                ROW(NEW.event_id,NEW.payload_hash,NEW.person_observation_index,
                    NEW.zone_observation_index,NEW.track_id,NEW.camera_id,
                    NEW.region_id,NEW.geometry_version,NEW.zone_id,NEW.captured_at)
        ) OR NOT EXISTS (
          SELECT 1 FROM ${actions} acceptance
          WHERE acceptance.command_id=NEW.c02_acceptance_id AND acceptance.site_id=NEW.site_id
            AND acceptance.kind='ACCEPT' AND acceptance.result->'result'->>'outcome'='IDENTIFIED'
        ) THEN
          RAISE EXCEPTION 'Invalid MF06 retrospective subject or acceptance' USING ERRCODE='23514';
        END IF;
        SELECT COALESCE(initial.authority_captured_at,
          "${schema}".mf06_exact_authority_instant(event.raw_payload->>'capturedAt'))
          INTO NEW.authority_captured_at
          FROM ${requests} initial
          JOIN "${schema}".ai_observation_event event USING(event_id)
          WHERE initial.request_id=NEW.initial_request_id
            AND event.admission_context->>'classification'='LIVE';
        IF NEW.authority_captured_at IS NULL THEN
          RAISE EXCEPTION 'Exact MF06 retrospective capture time is unavailable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $guard$;
      CREATE TRIGGER trg_mf06_request_zz_retrospective_binding
        BEFORE INSERT ON ${requests} FOR EACH ROW
        EXECUTE FUNCTION "${schema}".mf06_retrospective_binding_guard();
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      'MF06 retrospective audit bindings are forward-only; restore a verified backup',
    );
  }
}
