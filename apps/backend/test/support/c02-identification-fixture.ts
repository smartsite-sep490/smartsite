import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

export async function seedZonePermissionActors(
  db: DataSource,
  siteId: string,
  regionId: string,
  passwordHash: string,
) {
  const contractorId = randomUUID(),
    representativeId = randomUUID(),
    participationId = randomUUID();
  const workerId = randomUUID(),
    assignmentId = randomUUID();
  const [{ zone_id: zoneId }] = await db.query(
    'SELECT zone_id FROM camera_observation_region WHERE id=$1',
    [regionId],
  );
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic permission contractor')",
    [contractorId],
  );
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic permission representative',$2)",
    [representativeId, passwordHash],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'CONTRACTOR_REPRESENTATIVE')",
    [randomUUID(), representativeId, siteId],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from,valid_until) VALUES($1,$2,$3,now()-interval '2 days',now()+interval '2 days')",
    [participationId, siteId, contractorId],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), representativeId, contractorId],
  );
  await db.query(
    'INSERT INTO contractor_representative_assignment(id,site_id,contractor_id,user_id) VALUES($1,$2,$3,$4)',
    [randomUUID(), siteId, contractorId, representativeId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name,contractor_id) VALUES($1,$2,$1::uuid::text,'Synthetic permission Worker',$3)",
    [workerId, siteId, contractorId],
  );
  await db.query(
    `INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id)
    VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED',now()-interval '2 days',now()+interval '2 days',$6)`,
    [assignmentId, workerId, siteId, participationId, zoneId, representativeId],
  );
  return { zoneId, representativeId, participationId, assignmentId, workerId, contractorId };
}
