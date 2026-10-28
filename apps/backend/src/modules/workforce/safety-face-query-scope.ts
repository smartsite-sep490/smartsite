import type { DataSource } from 'typeorm';

/** Use the configured schema for both selection and final lookup, never pooled search_path. */
export function getSafetyFaceTables(driver: DataSource['driver'] | undefined) {
  const schema = driver?.schema;
  if (
    driver?.options?.type !== 'postgres' ||
    typeof schema !== 'string' ||
    !schema ||
    Buffer.byteLength(schema, 'utf8') > 63 ||
    schema.includes('\0') ||
    /^(pg_|information_schema$)/i.test(schema)
  )
    return null;
  const prefix = `"${schema.replaceAll('"', '""')}"`;
  return {
    profileTable: `${prefix}."face_profile"`,
    workerTable: `${prefix}."worker"`,
    consentTable: `${prefix}."safety_face_consent"`,
    revocationTable: `${prefix}."safety_face_consent_revocation"`,
  };
}
